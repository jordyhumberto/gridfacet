import { keepGroup, makePiece, type Piece, type Vec3 } from './piece';
import { CLEAR, blankTexture, textureSizeFor, uvOf, type FaceTexture } from './texture';

/** Textura de la cara: la que ya tiene o una en blanco del tamaño que le toca. */
export function textureOfFace(piece: Piece, faceIndex: number): FaceTexture {
  const existing = piece.faceTextures?.[faceIndex];
  if (existing) return { w: existing.w, h: existing.h, pixels: [...existing.pixels] };
  const { w, h } = textureSizeFor(piece.faces[faceIndex]);
  return blankTexture(w, h);
}

/** Casilla de la textura bajo un punto de la cara, o null si cae fuera de ella. */
export function texelAt(face: Vec3[], texture: FaceTexture, point: Vec3): { x: number; y: number } | null {
  const [s, t] = uvOf(face, point);
  if (s < -1e-6 || s > 1 + 1e-6 || t < -1e-6 || t > 1 + 1e-6) return null;
  return { x: Math.min(texture.w - 1, Math.max(0, Math.floor(s * texture.w))), y: Math.min(texture.h - 1, Math.max(0, Math.floor(t * texture.h))) };
}

/** Pone `value` en un cuadrado de `size` × `size` casillas con (x, y) cerca del centro; lo que cae fuera de la textura se ignora. Devuelve cuántas casillas cambiaron. */
export function stamp(texture: FaceTexture, x: number, y: number, size: number, value: number): number {
  const half = Math.floor((size - 1) / 2);
  let changed = 0;
  for (let j = y - half; j < y - half + size; j++) {
    for (let i = x - half; i < x - half + size; i++) {
      if (i < 0 || j < 0 || i >= texture.w || j >= texture.h) continue;
      const at = j * texture.w + i;
      if (texture.pixels[at] === value) continue;
      texture.pixels[at] = value;
      changed++;
    }
  }
  return changed;
}

/** Rellena la región de casillas del mismo valor que (x, y), sin cruzar en diagonal. Devuelve cuántas casillas cambiaron. */
export function floodFill(texture: FaceTexture, x: number, y: number, value: number): number {
  const target = texture.pixels[y * texture.w + x];
  if (target === value) return 0;
  const stack = [[x, y]];
  let changed = 0;
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    if (i < 0 || j < 0 || i >= texture.w || j >= texture.h) continue;
    const at = j * texture.w + i;
    if (texture.pixels[at] !== target) continue;
    texture.pixels[at] = value;
    changed++;
    stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
  }
  return changed;
}

/** Color de lo que se ve en una casilla: el píxel pintado o, si está sin pintar, el color de la cara. */
export function visibleColor(texture: FaceTexture, x: number, y: number, faceColor: number): number {
  const value = texture.pixels[y * texture.w + x];
  return value === CLEAR ? faceColor : value;
}

/** Copia de la pieza con la textura de una cara cambiada (id nuevo, mismo grupo y capa). */
export function withFaceTexture(piece: Piece, faceIndex: number, texture: FaceTexture): Piece {
  const textures = piece.faces.map((_, i) => (i === faceIndex ? texture : (piece.faceTextures?.[i] ?? null)));
  return keepGroup(makePiece(piece.faces, piece.color, piece.faceColors, textures), piece);
}

/** Pinta con `stamp` a lo largo de la recta de casilla a casilla (Bresenham), para que un arrastre rápido no deje huecos. */
export function stampLine(texture: FaceTexture, x0: number, y0: number, x1: number, y1: number, size: number, value: number): number {
  let changed = 0;
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    changed += stamp(texture, x, y, size, value);
    if (x === x1 && y === y1) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += sx;
    }
    if (doubled <= dx) {
      error += dx;
      y += sy;
    }
  }
  return changed;
}
