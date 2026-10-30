import { boundsOf } from './transform';
import { clipPiece, faceNormal, makePiece, volume, type Piece, type Vec3 } from './piece';

const OVERLAP = 1e-4;
/** Volumen compartido (celdas cúbicas) por debajo del cual dos piezas solo se tocan. */
const SHARED_VOLUME = 1e-6;
/** Las piezas se suben en pasos de media placa (1/6 de celda), el paso vertical más fino de la rejilla. */
const LIFT_STEP = 1 / 6;

const boxCache = new WeakMap<Piece, { min: number[]; max: number[] }>();
function boxOf(piece: Piece): { min: number[]; max: number[] } {
  let box = boxCache.get(piece);
  if (!box) {
    box = boundsOf([piece])!;
    boxCache.set(piece, box);
  }
  return box;
}

/** Si `part`, subida `lift`, comparte volumen con `other`: se recorta contra cada cara de `other` (ambas son convexas). */
function intersects(part: Piece, lift: number, other: Piece): boolean {
  let rest: Piece | null = lift === 0 ? part : makePiece(part.faces.map((face) => face.map((p): Vec3 => [p[0], p[1] + lift, p[2]])), part.color);
  for (const face of other.faces) {
    const n = faceNormal(face);
    const length = Math.hypot(n[0], n[1], n[2]) || 1;
    const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    rest = clipPiece(rest, { n: unit, d: unit[0] * face[0][0] + unit[1] * face[0][1] + unit[2] * face[0][2] });
    if (!rest) return false;
  }
  return volume(rest) > SHARED_VOLUME;
}

/**
 * Cuánto hay que subir (en celdas, múltiplo de media placa) las piezas nuevas para que no se metan en las existentes:
 * al apoyarse sobre un desnivel, el cubo de 1 × 1 cubre también celdas más altas que la que se apunta.
 * Las cajas envolventes descartan lo lejano y el recorte exacto confirma el choque, así que una pieza pegada a una cara
 * inclinada o entre otras muy juntas no sube sin motivo.
 */
export function clearanceLift(parts: Piece[], others: Iterable<Piece>): number {
  const box = boundsOf(parts);
  if (!box) return 0;
  const list = [...others];
  let lift = 0;
  for (let guard = 0; guard < 64; guard++) {
    const blocker = list.find((other) => {
      const o = boxOf(other);
      return (
        box.min[0] < o.max[0] - OVERLAP && o.min[0] < box.max[0] - OVERLAP &&
        box.min[2] < o.max[2] - OVERLAP && o.min[2] < box.max[2] - OVERLAP &&
        box.min[1] + lift < o.max[1] - OVERLAP && o.min[1] < box.max[1] + lift - OVERLAP &&
        parts.some((part) => intersects(part, lift, other))
      );
    });
    if (!blocker) return lift;
    const needed = boxOf(blocker).max[1] - box.min[1];
    lift = Math.ceil(needed / LIFT_STEP - 1e-6) * LIFT_STEP;
  }
  return lift;
}

/** Pasos con los que se mueve una pieza menor que una celda dentro de una cara: cada tamaño propio se divide en este número. */
export const FREE_STEPS = 4;
/** A qué distancia (en celdas) de una arista o línea de la rejilla se imanta una pieza pequeña. */
export const MAGNET = 0.1;

/**
 * Dónde empieza (por su lado menor) una pieza de largo `size` que sigue al cursor sobre un eje: se mueve en pasos
 * de `size / FREE_STEPS` y se imanta a las `lines` cercanas con su borde o con su centro. Se queda dentro de [lo, hi] si se dan.
 */
export function snapSpan(cursor: number, size: number, lines: Iterable<number>, lo = -Infinity, hi = Infinity): number {
  const step = size / FREE_STEPS;
  const wanted = cursor - size / 2;
  let best = Math.round(wanted / step) * step;
  let bestDist = MAGNET;
  for (const line of lines) {
    for (const start of [line, line - size, line - size / 2]) {
      const dist = Math.abs(start - wanted);
      if (dist < bestDist) {
        bestDist = dist;
        best = start;
      }
    }
  }
  if (hi - lo >= size) best = Math.min(Math.max(best, lo), hi - size);
  return Math.round(best * 1e6) / 1e6;
}

/**
 * Líneas sobre un eje a las que puede imantarse una pieza que se coloca cerca de `around`: los bordes de las piezas próximas
 * y las líneas de la rejilla (cada celda en X/Z, cada placa en Y).
 */
export function magnetLines(pieces: Iterable<Piece>, axis: 0 | 1 | 2, around: [number, number, number], reach: number): number[] {
  const lines: number[] = [];
  for (const piece of pieces) {
    const box = boxOf(piece);
    if ([0, 1, 2].every((i) => around[i] > box.min[i] - reach && around[i] < box.max[i] + reach)) lines.push(box.min[axis], box.max[axis]);
  }
  const pitch = axis === 1 ? 1 / 3 : 1;
  const first = Math.floor((around[axis] - reach) / pitch);
  for (let k = first; k <= first + Math.ceil((2 * reach) / pitch) + 1; k++) lines.push(k * pitch);
  return lines;
}

const TOUCH = 1e-4;

/**
 * Límites de la superficie plana que continúa bajo el cursor: las caras de todas las piezas que están en el mismo plano
 * (de cara al mismo lado) y se tocan entre sí, empezando por las que contienen `point`. Cuatro cubos juntos forman una
 * sola pared, no cuatro. Solo para caras alineadas con un eje; devuelve null si no hay ninguna bajo el cursor.
 */
export function flatSurface(pieces: Iterable<Piece>, axis: 0 | 1 | 2, sign: 1 | -1, point: Vec3): { min: number[]; max: number[] } | null {
  const offset = point[axis];
  const [t1, t2] = [0, 1, 2].filter((i) => i !== axis);
  const faces: { min: [number, number]; max: [number, number] }[] = [];
  for (const piece of pieces) {
    for (const face of piece.faces) {
      if (!face.every((p) => Math.abs(p[axis] - offset) < TOUCH)) continue;
      const n = faceNormal(face);
      if (n[axis] * sign <= 0) continue;
      faces.push({
        min: [Math.min(...face.map((p) => p[t1])), Math.min(...face.map((p) => p[t2]))],
        max: [Math.max(...face.map((p) => p[t1])), Math.max(...face.map((p) => p[t2]))],
      });
    }
  }
  const joined = new Set<number>();
  faces.forEach((f, i) => {
    if (point[t1] >= f.min[0] - TOUCH && point[t1] <= f.max[0] + TOUCH && point[t2] >= f.min[1] - TOUCH && point[t2] <= f.max[1] + TOUCH) joined.add(i);
  });
  if (joined.size === 0) return null;
  const queue = [...joined];
  while (queue.length > 0) {
    const a = faces[queue.pop()!];
    faces.forEach((b, i) => {
      if (joined.has(i)) return;
      if (a.min[0] <= b.max[0] + TOUCH && b.min[0] <= a.max[0] + TOUCH && a.min[1] <= b.max[1] + TOUCH && b.min[1] <= a.max[1] + TOUCH) {
        joined.add(i);
        queue.push(i);
      }
    });
  }
  const min = [0, 0, 0];
  const max = [0, 0, 0];
  min[t1] = Math.min(...[...joined].map((i) => faces[i].min[0]));
  max[t1] = Math.max(...[...joined].map((i) => faces[i].max[0]));
  min[t2] = Math.min(...[...joined].map((i) => faces[i].min[1]));
  max[t2] = Math.max(...[...joined].map((i) => faces[i].max[1]));
  return { min, max };
}
