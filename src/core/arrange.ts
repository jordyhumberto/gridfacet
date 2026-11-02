import type { Change } from './cut';
import type { Piece } from './piece';
import { boundsOf, scaleChange, translatePiece, type Axis } from './transform';

const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** Cada grupo cuenta como una sola parte; las piezas sueltas, una cada una. */
export function partsOf(pieces: Piece[]): Piece[][] {
  const groups = new Map<number, Piece[]>();
  const parts: Piece[][] = [];
  for (const piece of pieces) {
    if (piece.group === undefined) {
      parts.push([piece]);
      continue;
    }
    let part = groups.get(piece.group);
    if (!part) {
      part = [];
      groups.set(piece.group, part);
      parts.push(part);
    }
    part.push(piece);
  }
  return parts;
}

function shift(part: Piece[], axis: Axis, delta: number): Piece[] {
  const d: [number, number, number] = [0, 0, 0];
  d[AXIS_INDEX[axis]] = delta;
  return part.map((piece) => translatePiece(piece, d[0], d[1], d[2]));
}

/** Pone las partes a ras por su lado menor, por su centro o por su lado mayor sobre un eje. */
export function alignChange(pieces: Piece[], axis: Axis, edge: 'min' | 'center' | 'max'): Change {
  const parts = partsOf(pieces);
  const i = AXIS_INDEX[axis];
  const boxes = parts.map((part) => boundsOf(part)!);
  if (parts.length < 2) return { added: [], removed: [] };
  const lo = Math.min(...boxes.map((b) => b.min[i]));
  const hi = Math.max(...boxes.map((b) => b.max[i]));
  const added: Piece[] = [];
  const removed: Piece[] = [];
  parts.forEach((part, k) => {
    const b = boxes[k];
    const delta = edge === 'min' ? lo - b.min[i] : edge === 'max' ? hi - b.max[i] : (lo + hi) / 2 - (b.min[i] + b.max[i]) / 2;
    if (Math.abs(delta) < 1e-9) return;
    removed.push(...part);
    added.push(...shift(part, axis, delta));
  });
  return { added, removed };
}

/** Reparte tres o más partes con huecos iguales sobre un eje; la primera y la última no se mueven. */
export function distributeChange(pieces: Piece[], axis: Axis): Change {
  const parts = partsOf(pieces);
  if (parts.length < 3) return { added: [], removed: [] };
  const i = AXIS_INDEX[axis];
  const items = parts.map((part) => ({ part, box: boundsOf(part)! })).sort((a, b) => a.box.min[i] - b.box.min[i]);
  const first = items[0].box.min[i];
  const last = items[items.length - 1].box.max[i];
  const sizes = items.reduce((sum, { box }) => sum + (box.max[i] - box.min[i]), 0);
  const gap = (last - first - sizes) / (items.length - 1);
  const added: Piece[] = [];
  const removed: Piece[] = [];
  let cursor = first;
  for (const { part, box } of items) {
    const delta = cursor - box.min[i];
    if (Math.abs(delta) > 1e-9) {
      removed.push(...part);
      added.push(...shift(part, axis, delta));
    }
    cursor += box.max[i] - box.min[i] + gap;
  }
  return { added, removed };
}

/** Baja o sube la selección entera hasta que su parte más baja toque el suelo (y = 0). */
export function groundChange(pieces: Piece[]): Change {
  const box = boundsOf(pieces);
  if (!box || Math.abs(box.min[1]) < 1e-9) return { added: [], removed: [] };
  return { removed: pieces, added: pieces.map((piece) => translatePiece(piece, 0, -box.min[1], 0)) };
}

/** Escala la selección por igual en los tres ejes hasta que su dimensión mayor mida `longest` celdas. */
export function resizeLongestChange(pieces: Piece[], longest: number): Change {
  const box = boundsOf(pieces);
  if (!box || !(longest > 0)) return { added: [], removed: [] };
  const current = Math.max(...[0, 1, 2].map((k) => box.max[k] - box.min[k]));
  if (current < 1e-9 || Math.abs(current - longest) < 1e-9) return { added: [], removed: [] };
  const f = longest / current;
  return scaleChange(pieces, [f, f, f]);
}
