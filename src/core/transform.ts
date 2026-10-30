import type { Change } from './cut';
import { keepGroup, makePiece, type Piece, type Vec3 } from './piece';

/** Paso más fino al mover, en horizontal y en vertical: un cuarto de celda. */
export const STEP_XZ = 0.25;
export const STEP_Y = 0.25;

function mapPiece(piece: Piece, map: (p: Vec3) => Vec3): Piece {
  return keepGroup(makePiece(piece.faces.map((face) => face.map(map)), piece.color, piece.faceColors), piece);
}

export function translatePiece(piece: Piece, dx: number, dy: number, dz: number): Piece {
  return mapPiece(piece, (p) => [p[0] + dx, p[1] + dy, p[2] + dz]);
}

/** Gira la pieza en múltiplos de 90° alrededor de la vertical que pasa por (cx, cz). */
export function rotatePieceY(piece: Piece, quarterTurns: number, cx: number, cz: number): Piece {
  const q = ((quarterTurns % 4) + 4) % 4;
  return mapPiece(piece, (p) => {
    const dx = p[0] - cx;
    const dz = p[2] - cz;
    const [rx, rz] = [[dx, dz], [dz, -dx], [-dx, -dz], [-dz, dx]][q];
    return [cx + rx, p[1], cz + rz];
  });
}

export function moveChange(pieces: Piece[], dx: number, dy: number, dz: number): Change {
  return { removed: pieces, added: pieces.map((piece) => translatePiece(piece, dx, dy, dz)) };
}

/** Centro del conjunto en X/Z, llevado a la malla de media celda para que el giro no desalinee las piezas. */
export function rotationCenter(pieces: Piece[]): [number, number] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const piece of pieces) {
    for (const face of piece.faces) {
      for (const p of face) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minZ = Math.min(minZ, p[2]);
        maxZ = Math.max(maxZ, p[2]);
      }
    }
  }
  const snap = (v: number) => Math.round(v / STEP_XZ) * STEP_XZ;
  return [snap((minX + maxX) / 2), snap((minZ + maxZ) / 2)];
}

export function rotateChange(pieces: Piece[], quarterTurns: number): Change {
  const [cx, cz] = rotationCenter(pieces);
  return { removed: pieces, added: pieces.map((piece) => rotatePieceY(piece, quarterTurns, cx, cz)) };
}

/** Caja que encierra las piezas, o null si no hay ninguna. */
export function boundsOf(pieces: Piece[]): { min: Vec3; max: Vec3 } | null {
  if (pieces.length === 0) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const piece of pieces) {
    for (const face of piece.faces) {
      for (const p of face) {
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], p[i]);
          max[i] = Math.max(max[i], p[i]);
        }
      }
    }
  }
  return { min, max };
}

/** Escala el conjunto respecto al centro de su caja; los factores deben ser positivos para no invertir las caras. */
export function scaleChange(pieces: Piece[], factors: Vec3): Change {
  const box = boundsOf(pieces);
  if (!box || factors.some((f) => !(f > 0))) return { added: [], removed: [] };
  const center = box.min.map((v, i) => (v + box.max[i]) / 2) as Vec3;
  const map = (p: Vec3): Vec3 => [0, 1, 2].map((i) => center[i] + (p[i] - center[i]) * factors[i]) as Vec3;
  return { removed: pieces, added: pieces.map((piece) => mapPiece(piece, map)) };
}

/** Mueve el conjunto para que el centro de su caja quede en `target`. */
export function centerChange(pieces: Piece[], target: Vec3): Change {
  const box = boundsOf(pieces);
  if (!box) return { added: [], removed: [] };
  const [dx, dy, dz] = [0, 1, 2].map((i) => target[i] - (box.min[i] + box.max[i]) / 2);
  return moveChange(pieces, dx, dy, dz);
}

/** Gira el conjunto un ángulo cualquiera (en grados) alrededor de un eje que pasa por el centro de su caja. */
export function rotateFreeChange(pieces: Piece[], axis: 'x' | 'y' | 'z', degrees: number): Change {
  const box = boundsOf(pieces);
  if (!box || degrees === 0) return { added: [], removed: [] };
  const c = box.min.map((v, i) => (v + box.max[i]) / 2) as Vec3;
  const a = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  const map = (p: Vec3): Vec3 => {
    const [x, y, z] = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
    if (axis === 'y') return [c[0] + x * cos + z * sin, p[1], c[2] - x * sin + z * cos];
    if (axis === 'x') return [p[0], c[1] + y * cos - z * sin, c[2] + y * sin + z * cos];
    return [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos, p[2]];
  };
  return { removed: pieces, added: pieces.map((piece) => mapPiece(piece, map)) };
}

export type Axis = 'x' | 'y' | 'z';
const AXIS_INDEX: Record<Axis, number> = { x: 0, y: 1, z: 2 };

/** Centro del conjunto en un eje, llevado a una malla de media paso para que el espejo caiga sobre la rejilla de movimiento. */
export function mirrorCenter(pieces: Piece[], axis: Axis): number {
  const i = AXIS_INDEX[axis];
  let min = Infinity;
  let max = -Infinity;
  for (const piece of pieces) for (const face of piece.faces) for (const p of face) {
    min = Math.min(min, p[i]);
    max = Math.max(max, p[i]);
  }
  const grid = (axis === 'y' ? STEP_Y : STEP_XZ) / 2;
  return Math.round((min + max) / 2 / grid) * grid;
}

/** Refleja la pieza respecto al plano `axis = center`; se invierte el orden de cada cara para que sus normales sigan hacia fuera. */
export function mirrorPiece(piece: Piece, axis: Axis, center: number): Piece {
  const i = AXIS_INDEX[axis];
  const flip = (p: Vec3): Vec3 => {
    const q: Vec3 = [p[0], p[1], p[2]];
    q[i] = 2 * center - p[i];
    return q;
  };
  return keepGroup(makePiece(piece.faces.map((face) => face.map(flip).reverse()), piece.color, piece.faceColors), piece);
}

export function mirrorChange(pieces: Piece[], axis: Axis): Change {
  const center = mirrorCenter(pieces, axis);
  return { removed: pieces, added: pieces.map((piece) => mirrorPiece(piece, axis, center)) };
}
