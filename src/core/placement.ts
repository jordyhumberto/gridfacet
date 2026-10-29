import { boundsOf } from './transform';
import type { Piece } from './piece';

const OVERLAP = 1e-4;
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

/**
 * Cuánto hay que subir (en celdas, múltiplo de media placa) las piezas nuevas para que no se metan en las existentes:
 * al apoyarse sobre un desnivel, el cubo de 1 × 1 cubre también celdas más altas que la que se apunta.
 * Compara cajas envolventes, así que es conservador con las piezas inclinadas.
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
        box.min[1] + lift < o.max[1] - OVERLAP && o.min[1] < box.max[1] + lift - OVERLAP
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
