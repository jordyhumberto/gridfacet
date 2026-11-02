import { faceNormal, type Vec3 } from './piece';

/** Píxel sin pintar: deja ver el color de la cara. */
export const CLEAR = -1;

/** Resolución de las texturas: píxeles por celda, y tope por lado para que una cara enorme no pese de más. */
export const TEXELS_PER_CELL = 16;
export const MAX_TEXTURE_SIDE = 128;

/** Píxeles de una cara, por filas de arriba abajo. Cada valor es `CLEAR` o un color 0xRRGGBB. */
export interface FaceTexture {
  w: number;
  h: number;
  pixels: number[];
}

/** Marco de una cara: el origen es su primer vértice, `u` sigue su primera arista y `v` va de `u` hacia dentro del plano (n × u). */
export interface FaceFrame {
  o: Vec3;
  u: Vec3;
  v: Vec3;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function faceFrame(face: Vec3[]): FaceFrame {
  const o = face[0];
  const u = unit(sub(face[1], o));
  const v = unit(cross(unit(faceNormal(face)), u));
  let uMin = Infinity;
  let uMax = -Infinity;
  let vMin = Infinity;
  let vMax = -Infinity;
  for (const p of face) {
    const d = sub(p, o);
    uMin = Math.min(uMin, dot(d, u));
    uMax = Math.max(uMax, dot(d, u));
    vMin = Math.min(vMin, dot(d, v));
    vMax = Math.max(vMax, dot(d, v));
  }
  return { o, u, v, uMin, uMax, vMin, vMax };
}

/** Posición de un punto del plano de la cara dentro de su textura: `s` de izquierda a derecha y `t` de arriba abajo, ambos de 0 a 1. */
export function uvOf(face: Vec3[], p: Vec3): [number, number] {
  const f = faceFrame(face);
  const d = sub(p, f.o);
  const s = (dot(d, f.u) - f.uMin) / ((f.uMax - f.uMin) || 1);
  const t = (f.vMax - dot(d, f.v)) / ((f.vMax - f.vMin) || 1);
  return [s, t];
}

/** Lo contrario de `uvOf`: el punto del plano de la cara que corresponde a (s, t). */
export function pointOf(face: Vec3[], s: number, t: number): Vec3 {
  const f = faceFrame(face);
  const a = f.uMin + s * (f.uMax - f.uMin);
  const b = f.vMax - t * (f.vMax - f.vMin);
  return [f.o[0] + f.u[0] * a + f.v[0] * b, f.o[1] + f.u[1] * a + f.v[1] * b, f.o[2] + f.u[2] * a + f.v[2] * b];
}

/** Tamaño en píxeles de la textura de una cara: `TEXELS_PER_CELL` por celda sobre su caja, al menos 1 y como mucho `MAX_TEXTURE_SIDE`. */
export function textureSizeFor(face: Vec3[]): { w: number; h: number } {
  const f = faceFrame(face);
  const side = (extent: number): number => Math.min(MAX_TEXTURE_SIDE, Math.max(1, Math.round(extent * TEXELS_PER_CELL)));
  return { w: side(f.uMax - f.uMin), h: side(f.vMax - f.vMin) };
}

export function blankTexture(w: number, h: number): FaceTexture {
  return { w, h, pixels: new Array<number>(w * h).fill(CLEAR) };
}

/** Píxel de la textura bajo (s, t); fuera de 0–1 se ajusta al borde. */
export function sampleTexture(texture: FaceTexture, s: number, t: number): number {
  const x = Math.min(texture.w - 1, Math.max(0, Math.floor(s * texture.w)));
  const y = Math.min(texture.h - 1, Math.max(0, Math.floor(t * texture.h)));
  return texture.pixels[y * texture.w + x];
}

/** Una textura sin ningún píxel pintado no hace falta guardarla. */
export const isBlank = (texture: FaceTexture): boolean => texture.pixels.every((p) => p === CLEAR);

/**
 * Pasa la textura de la cara `from` a la cara `to`, que es la misma cara después de un cambio que no conserva el orden
 * de los vértices (un espejo). `toFrom` lleva un punto de `to` a donde estaba en `from`. Se remuestrea con el vecino más cercano.
 */
export function remapTexture(texture: FaceTexture, from: Vec3[], to: Vec3[], toFrom: (p: Vec3) => Vec3): FaceTexture {
  const { w, h } = textureSizeFor(to);
  const out = blankTexture(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [s, t] = uvOf(from, toFrom(pointOf(to, (x + 0.5) / w, (y + 0.5) / h)));
      out.pixels[y * w + x] = sampleTexture(texture, s, t);
    }
  }
  return out;
}

/** Texturas por cara en el mismo orden que las caras; `null` donde no hay. Devuelve undefined si no queda ninguna pintada. */
export function normalizeTextures(textures: (FaceTexture | null | undefined)[] | undefined): (FaceTexture | null)[] | undefined {
  if (!textures) return undefined;
  const clean = textures.map((t) => (t && !isBlank(t) ? t : null));
  return clean.some((t) => t !== null) ? clean : undefined;
}

/** Texturas en forma compacta para guardar: pares [cuántos, valor] seguidos (tandas del mismo píxel), por filas. */
export interface PackedTexture {
  w: number;
  h: number;
  runs: number[];
}

export function packTexture(texture: FaceTexture): PackedTexture {
  const runs: number[] = [];
  let i = 0;
  while (i < texture.pixels.length) {
    let j = i;
    while (j < texture.pixels.length && texture.pixels[j] === texture.pixels[i]) j++;
    runs.push(j - i, texture.pixels[i]);
    i = j;
  }
  return { w: texture.w, h: texture.h, runs };
}

/** Lo contrario de `packTexture`; devuelve null si los datos no cuadran con el tamaño o traen colores inválidos. */
export function unpackTexture(raw: unknown): FaceTexture | null {
  if (!raw || typeof raw !== 'object') return null;
  const { w, h, runs } = raw as Partial<PackedTexture>;
  if (!Number.isInteger(w) || !Number.isInteger(h) || !w || !h || w < 1 || h < 1 || w > MAX_TEXTURE_SIDE || h > MAX_TEXTURE_SIDE) return null;
  if (!Array.isArray(runs) || runs.length % 2 !== 0) return null;
  const pixels: number[] = [];
  for (let k = 0; k < runs.length; k += 2) {
    const count = runs[k];
    const value = runs[k + 1];
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(value) || value < CLEAR || value > 0xffffff) return null;
    if (pixels.length + count > w * h) return null;
    for (let n = 0; n < count; n++) pixels.push(value);
  }
  return pixels.length === w * h ? { w, h, pixels } : null;
}
