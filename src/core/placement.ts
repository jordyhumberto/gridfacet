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
