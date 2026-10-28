import type { Piece } from './piece';

const EPS = 1e-6;

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

function boxOf(piece: Piece): Box {
  const min: Box['min'] = [Infinity, Infinity, Infinity];
  const max: Box['max'] = [-Infinity, -Infinity, -Infinity];
  for (const face of piece.faces) {
    for (const p of face) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
  }
  return { min, max };
}

/** Dos piezas se tocan si sus cajas se solapan en volumen o comparten al menos una cara (no basta una arista ni una esquina). */
function touches(a: Box, b: Box): boolean {
  let overlapping = 0;
  for (let i = 0; i < 3; i++) {
    const overlap = Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);
    if (overlap < -EPS) return false;
    if (overlap > EPS) overlapping++;
  }
  return overlapping >= 2;
}

/** Piezas de `all` unidas a las de `start` por contacto, directo o a través de otras; incluye las de partida. */
export function connectedPieces(start: Piece[], all: Piece[]): Piece[] {
  const boxes = new Map<number, Box>();
  const cells = new Map<string, Piece[]>();
  const cellsOf = (box: Box): string[] => {
    const keys: string[] = [];
    const lo = box.min.map((v) => Math.floor(v - EPS));
    const hi = box.max.map((v) => Math.floor(v + EPS));
    for (let x = lo[0]; x <= hi[0]; x++) {
      for (let y = lo[1]; y <= hi[1]; y++) {
        for (let z = lo[2]; z <= hi[2]; z++) keys.push(`${x},${y},${z}`);
      }
    }
    return keys;
  };
  for (const piece of all) {
    const box = boxOf(piece);
    boxes.set(piece.id, box);
    for (const key of cellsOf(box)) {
      const bucket = cells.get(key);
      if (bucket) bucket.push(piece);
      else cells.set(key, [piece]);
    }
  }

  const seen = new Set<number>(start.map((piece) => piece.id));
  const queue = [...start];
  for (let head = 0; head < queue.length; head++) {
    const box = boxes.get(queue[head].id) ?? boxOf(queue[head]);
    for (const key of cellsOf(box)) {
      for (const other of cells.get(key) ?? []) {
        if (seen.has(other.id)) continue;
        if (!touches(box, boxes.get(other.id)!)) continue;
        seen.add(other.id);
        queue.push(other);
      }
    }
  }
  return queue;
}

/** Tamaño de la caja que encierra las piezas: ancho (X), alto (Y) y fondo (Z). */
export function sizeOf(pieces: Piece[]): [number, number, number] | null {
  if (pieces.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const piece of pieces) {
    const box = boxOf(piece);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], box.min[i]);
      max[i] = Math.max(max[i], box.max[i]);
    }
  }
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}
