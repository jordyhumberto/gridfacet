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
/** Decide si una casilla (i, j) del pincel centrado en (x, y) se pinta. */
export type BrushMask = (i: number, j: number, x: number, y: number) => boolean;

export function stamp(texture: FaceTexture, x: number, y: number, size: number, value: number, mask?: BrushMask): number {
  const half = Math.floor((size - 1) / 2);
  let changed = 0;
  for (let j = y - half; j < y - half + size; j++) {
    for (let i = x - half; i < x - half + size; i++) {
      if (i < 0 || j < 0 || i >= texture.w || j >= texture.h) continue;
      if (mask && !mask(i, j, x, y)) continue;
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
  return keepGroup(makePiece(piece.faces, piece.color, piece.faceColors, textures, piece.faceFlags), piece);
}

/** Pinta con `stamp` a lo largo de la recta de casilla a casilla (Bresenham), para que un arrastre rápido no deje huecos. */
export function stampLine(texture: FaceTexture, x0: number, y0: number, x1: number, y1: number, size: number, value: number, mask?: BrushMask): number {
  let changed = 0;
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    changed += stamp(texture, x, y, size, value, mask);
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

/** Casillas alternas como un tablero de ajedrez: el tramado (dither) que da la ilusión de un tono intermedio con solo dos colores. */
export const checker: BrushMask = (i, j) => (i + j) % 2 === 0;

/** Pincel redondo de lado `size`: recorta las esquinas del cuadrado (con 1 o 2 px no hay nada que redondear). */
export function roundMask(size: number): BrushMask | undefined {
  if (size <= 2) return undefined;
  const half = Math.floor((size - 1) / 2);
  const limit = (size / 2) ** 2 - 0.5;
  return (i, j, x, y) => {
    const cx = x - half + (size - 1) / 2;
    const cy = y - half + (size - 1) / 2;
    return (i - cx) ** 2 + (j - cy) ** 2 <= limit;
  };
}

/** Junta dos máscaras: una casilla se pinta si pasa las dos. */
const both = (a: BrushMask | undefined, b: BrushMask | undefined): BrushMask | undefined => (a && b ? (i, j, x, y) => a(i, j, x, y) && b(i, j, x, y) : (a ?? b));

/** Cómo pinta el pincel: forma y espejo dentro de la cara (se repite el trazo reflejado en horizontal y/o vertical). */
export interface BrushOptions {
  round?: boolean;
  mirrorX?: boolean;
  mirrorY?: boolean;
}

/** Herramientas que se arrastran de un punto a otro y se previsualizan hasta soltar. */
export const SHAPE_TOOLS = ['line', 'rect', 'rectfill', 'ellipse', 'ellipsefill'] as const;
export type ShapeTool = (typeof SHAPE_TOOLS)[number];
export const isShapeTool = (tool: string): tool is ShapeTool => (SHAPE_TOOLS as readonly string[]).includes(tool);

type Cell = { x: number; y: number };
/** Rectángulo de casillas, con los dos extremos incluidos. */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

/** Rectángulo entre dos casillas, con las esquinas en orden. */
export const rectBetween = (a: Cell, b: Cell): Rect => ({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });

/** Copia de la textura con el contenido de la región (o de toda ella) desplazado; lo que sale de la textura se pierde y lo que deja libre queda sin pintar. */
export function moveRegion(texture: FaceTexture, region: Rect | null, dx: number, dy: number, copy = false): FaceTexture {
  const r = region ?? { x0: 0, y0: 0, x1: texture.w - 1, y1: texture.h - 1 };
  const x0 = Math.max(0, r.x0);
  const y0 = Math.max(0, r.y0);
  const x1 = Math.min(texture.w - 1, r.x1);
  const y1 = Math.min(texture.h - 1, r.y1);
  const pixels = [...texture.pixels];
  if (!copy) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels[y * texture.w + x] = CLEAR;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= texture.w || ty >= texture.h) continue;
      const value = texture.pixels[y * texture.w + x];
      // Al copiar, lo sin pintar no borra lo que hay debajo.
      if (copy && value === CLEAR) continue;
      pixels[ty * texture.w + tx] = value;
    }
  }
  return { w: texture.w, h: texture.h, pixels };
}

/** Dibuja una forma entre dos casillas opuestas (línea, rectángulo o elipse, con borde del grosor del pincel o rellena). Devuelve cuántas casillas cambiaron. */
export function drawShape(texture: FaceTexture, tool: ShapeTool, a: Cell, b: Cell, size: number, value: number, mask?: BrushMask): number {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  let changed = 0;
  if (tool === 'line') return stampLine(texture, a.x, a.y, b.x, b.y, size, value, mask);
  if (tool === 'rectfill') {
    for (let y = y0; y <= y1; y++) changed += stampLine(texture, x0, y, x1, y, 1, value);
    return changed;
  }
  if (tool === 'rect') {
    changed += stampLine(texture, x0, y0, x1, y0, size, value, mask);
    changed += stampLine(texture, x0, y1, x1, y1, size, value, mask);
    changed += stampLine(texture, x0, y0, x0, y1, size, value, mask);
    changed += stampLine(texture, x1, y0, x1, y1, size, value, mask);
    return changed;
  }
  // Elipse inscrita en el rectángulo de las dos casillas.
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2 + 0.5;
  const ry = (y1 - y0) / 2 + 0.5;
  const inside = (x: number, y: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      // El contorno son las casillas de dentro con alguna vecina fuera; con pincel grande se engrosa hacia dentro.
      if (tool === 'ellipse') {
        const edge = [1, 2, 3, 4].slice(0, Math.max(1, size)).some((d) => !inside(x + d, y) || !inside(x - d, y) || !inside(x, y + d) || !inside(x, y - d));
        if (!edge) continue;
      }
      changed += stamp(texture, x, y, 1, value);
    }
  }
  return changed;
}

/** Reflejos que pide el espejo: siempre el original (sin reflejar) y, según las opciones, los reflejados. */
function mirrorsOf(options: BrushOptions): [boolean, boolean][] {
  const out: [boolean, boolean][] = [[false, false]];
  if (options.mirrorX) out.push([true, false]);
  if (options.mirrorY) out.push([false, true]);
  if (options.mirrorX && options.mirrorY) out.push([true, true]);
  return out;
}

function mirrored(cell: Cell, texture: FaceTexture, mx: boolean, my: boolean): Cell {
  return { x: mx ? texture.w - 1 - cell.x : cell.x, y: my ? texture.h - 1 - cell.y : cell.y };
}

/** Rehace la textura de trabajo como la base más la forma entre las dos casillas (así la forma sigue al puntero sin dejar rastro). Devuelve 1 si cambió algo. */
export function reshape(work: FaceTexture, base: FaceTexture, tool: ShapeTool, a: Cell, b: Cell, size: number, value: number, options: BrushOptions = {}): number {
  const next: FaceTexture = { w: base.w, h: base.h, pixels: [...base.pixels] };
  const mask = roundMask(options.round ? size : 0);
  for (const [mx, my] of mirrorsOf(options)) drawShape(next, tool, mirrored(a, base, mx, my), mirrored(b, base, mx, my), size, value, mask);
  if (next.pixels.every((p, i) => p === work.pixels[i])) return 0;
  work.pixels = next.pixels;
  return 1;
}

/** Cambia por el nuevo color todas las casillas del mismo color visible que la de (x, y), esté pintada o sin pintar. Devuelve cuántas cambiaron. */
export function replaceColor(texture: FaceTexture, x: number, y: number, value: number): number {
  const target = texture.pixels[y * texture.w + x];
  if (target === value) return 0;
  let changed = 0;
  for (let i = 0; i < texture.pixels.length; i++) {
    if (texture.pixels[i] !== target) continue;
    texture.pixels[i] = value;
    changed++;
  }
  return changed;
}

/** Lo que una herramienta recuerda de un trazo en curso: dónde empezó, la textura de antes y la última casilla. */
export interface StrokeState {
  start: Cell | null;
  last: Cell | null;
  base: FaceTexture | null;
  /** Región elegida que mueve la herramienta Mover; sin ella se mueve toda la cara. */
  selection?: Rect | null;
  /** Mover deja el original en su sitio (se pulsa Ctrl al arrastrar). */
  copy?: boolean;
  /** Cuánto se ha movido el contenido desde que empezó el trazo (lo rellena Mover). */
  shift?: Cell;
  /** Estados de los trazos reflejados (espejo en la cara): uno por reflejo, en el orden de `mirrorsOf`. */
  mirrors?: StrokeState[];
}

/** Aplica la herramienta elegida a la casilla bajo el puntero, dentro de un trazo. Devuelve cuántas casillas cambiaron. */
export function paintCell(texture: FaceTexture, state: StrokeState, tool: string, cell: Cell, size: number, color: number, options: BrushOptions = {}): number {
  const freehand = tool !== 'move' && tool !== 'select' && tool !== 'replace' && !isShapeTool(tool);
  if (!(options.mirrorX || options.mirrorY) || !freehand) return paintOne(texture, state, tool, cell, size, color, options);
  // Trazo a mano con espejo: el mismo trazo se repite reflejado, cada reflejo con su propio recorrido.
  const [, ...others] = mirrorsOf(options);
  state.mirrors ??= others.map(() => ({ start: null, last: null, base: null }));
  let changed = paintOne(texture, state, tool, cell, size, color, options);
  others.forEach(([mx, my], k) => {
    changed += paintOne(texture, state.mirrors![k], tool, mirrored(cell, texture, mx, my), size, color, options);
  });
  return changed;
}

function paintOne(texture: FaceTexture, state: StrokeState, tool: string, cell: Cell, size: number, color: number, options: BrushOptions): number {
  const round = options.round ? roundMask(size) : undefined;
  const from = state.last ?? cell;
  const first = state.last === null;
  state.last = cell;
  if (tool === 'fill') return floodFill(texture, cell.x, cell.y, color);
  if (tool === 'replace') return first ? replaceColor(texture, cell.x, cell.y, color) : 0;
  if (isShapeTool(tool)) {
    if (!state.start || !state.base) {
      state.start = cell;
      state.base = { w: texture.w, h: texture.h, pixels: [...texture.pixels] };
    }
    return reshape(texture, state.base, tool, state.start, cell, size, color, options);
  }
  if (tool === 'move') {
    if (!state.start || !state.base) {
      state.start = cell;
      state.base = { w: texture.w, h: texture.h, pixels: [...texture.pixels] };
    }
    const dx = cell.x - state.start.x;
    const dy = cell.y - state.start.y;
    state.shift = { x: dx, y: dy };
    const next = moveRegion(state.base, state.selection ?? null, dx, dy, state.copy ?? false);
    if (next.pixels.every((p, i) => p === texture.pixels[i])) return 0;
    texture.pixels = next.pixels;
    return 1;
  }
  if (tool === 'select') return 0;
  if (tool === 'dither') return stampLine(texture, from.x, from.y, cell.x, cell.y, size, color, both(checker, round));
  return stampLine(texture, from.x, from.y, cell.x, cell.y, size, tool === 'eraser' ? CLEAR : color, round);
}

/** Lo último que se copió con Copiar: un trozo de textura que se pega en cualquier cara. */
export const pixelClipboard: { value: FaceTexture | null } = { value: null };

/** Trozo de la textura bajo la región (o toda ella), como textura propia. */
export function copyRegion(texture: FaceTexture, region: Rect | null): FaceTexture {
  const r = region ?? { x0: 0, y0: 0, x1: texture.w - 1, y1: texture.h - 1 };
  const x0 = Math.max(0, r.x0);
  const y0 = Math.max(0, r.y0);
  const x1 = Math.min(texture.w - 1, r.x1);
  const y1 = Math.min(texture.h - 1, r.y1);
  const w = Math.max(0, x1 - x0 + 1);
  const h = Math.max(0, y1 - y0 + 1);
  const pixels: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels.push(texture.pixels[y * texture.w + x]);
  return { w, h, pixels };
}

/** Copia de la textura con el trozo pegado con su esquina en (x, y); lo sin pintar del trozo no borra nada y lo que sale de la textura se pierde. Devuelve también la región que ocupa. */
export function pasteRegion(texture: FaceTexture, clip: FaceTexture, x: number, y: number): { texture: FaceTexture; rect: Rect } {
  const pixels = [...texture.pixels];
  for (let j = 0; j < clip.h; j++) {
    for (let i = 0; i < clip.w; i++) {
      const tx = x + i;
      const ty = y + j;
      const value = clip.pixels[j * clip.w + i];
      if (value === CLEAR || tx < 0 || ty < 0 || tx >= texture.w || ty >= texture.h) continue;
      pixels[ty * texture.w + tx] = value;
    }
  }
  return { texture: { w: texture.w, h: texture.h, pixels }, rect: { x0: x, y0: y, x1: x + clip.w - 1, y1: y + clip.h - 1 } };
}

/** Cambios que se aplican de una vez a una región (o a toda la cara). */
export type PixelEdit = 'flipH' | 'flipV' | 'rotate' | 'outline' | 'lighten' | 'darken';

const channel = (c: number, shift: number): number => (c >> shift) & 255;
const toward = (c: number, target: number, amount: number): number => Math.round(c + (target - c) * amount);

/** Un color más claro o más oscuro un paso (se mezcla un 20 % con blanco o con negro). */
export function shadeColor(color: number, lighter: boolean): number {
  const target = lighter ? 255 : 0;
  return (toward(channel(color, 16), target, 0.2) << 16) | (toward(channel(color, 8), target, 0.2) << 8) | toward(channel(color, 0), target, 0.2);
}

/**
 * Aplica un cambio a la región (o a toda la textura) y devuelve la textura nueva, o null si no cambia nada o no se puede
 * (girar pide una región cuadrada). `color` es el del contorno.
 */
export function editRegion(texture: FaceTexture, region: Rect | null, edit: PixelEdit, color: number): FaceTexture | null {
  const r = region ?? { x0: 0, y0: 0, x1: texture.w - 1, y1: texture.h - 1 };
  const x0 = Math.max(0, r.x0);
  const y0 = Math.max(0, r.y0);
  const x1 = Math.min(texture.w - 1, r.x1);
  const y1 = Math.min(texture.h - 1, r.y1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return null;
  const at = (x: number, y: number): number => y * texture.w + x;
  const pixels = [...texture.pixels];
  if (edit === 'flipH') {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels[at(x, y)] = texture.pixels[at(x1 - (x - x0), y)];
  } else if (edit === 'flipV') {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) pixels[at(x, y)] = texture.pixels[at(x, y1 - (y - y0))];
  } else if (edit === 'rotate') {
    if (w !== h) return null;
    // Un cuarto de vuelta en el sentido de las agujas del reloj.
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pixels[at(x0 + (h - 1 - j), y0 + i)] = texture.pixels[at(x0 + i, y0 + j)];
  } else if (edit === 'outline') {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (texture.pixels[at(x, y)] !== CLEAR) continue;
        const next = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]].some(([i, j]) => i >= x0 && i <= x1 && j >= y0 && j <= y1 && texture.pixels[at(i, j)] !== CLEAR);
        if (next) pixels[at(x, y)] = color;
      }
    }
  } else {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (texture.pixels[at(x, y)] !== CLEAR) pixels[at(x, y)] = shadeColor(texture.pixels[at(x, y)], edit === 'lighten');
  }
  return pixels.every((p, i) => p === texture.pixels[i]) ? null : { w: texture.w, h: texture.h, pixels };
}
