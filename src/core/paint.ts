import type { Change } from './cut';
import { faceColorOf, faceNormal, keepGroup, makePiece, type Piece, type Vec3 } from './piece';

/** Una cara concreta de una pieza. */
export interface FaceRef {
  piece: Piece;
  index: number;
}

/** Pinta las caras indicadas (o, con `index` -1, todas las de la pieza). Cada pieza cambiada se reemplaza por una copia pintada. */
export function paintChange(targets: FaceRef[], color: number): Change {
  const byPiece = new Map<Piece, Set<number>>();
  for (const { piece, index } of targets) {
    const set = byPiece.get(piece) ?? new Set<number>();
    if (index < 0) piece.faces.forEach((_, i) => set.add(i));
    else set.add(index);
    byPiece.set(piece, set);
  }
  const removed: Piece[] = [];
  const added: Piece[] = [];
  for (const [piece, indexes] of byPiece) {
    const colors = piece.faces.map((_, i) => (indexes.has(i) ? color : faceColorOf(piece, i)));
    if (colors.every((c, i) => c === faceColorOf(piece, i))) continue;
    removed.push(piece);
    // Si todas las caras quedan iguales, el color pasa a ser el de la pieza entera.
    const uniform = colors.every((c) => c === colors[0]);
    added.push(keepGroup(makePiece(piece.faces, uniform ? colors[0] : piece.color, colors), piece));
  }
  return { added, removed };
}

const centroid = (face: Vec3[]): Vec3 => {
  const c: Vec3 = [0, 0, 0];
  for (const p of face) for (let i = 0; i < 3; i++) c[i] += p[i] / face.length;
  return c;
};

/** Caras de `pieces` cuyo centro cae en `point` y miran hacia `normal` (para repetir la pintura en los reflejos). */
export function facesAt(pieces: Piece[], point: Vec3, normal: Vec3): FaceRef[] {
  const found: FaceRef[] = [];
  const wanted = Math.hypot(...normal) || 1;
  for (const piece of pieces) {
    piece.faces.forEach((face, index) => {
      const c = centroid(face);
      if (Math.hypot(c[0] - point[0], c[1] - point[1], c[2] - point[2]) > 1e-5) return;
      const n = faceNormal(face);
      const l = Math.hypot(...n) || 1;
      const alignment = (n[0] * normal[0] + n[1] * normal[1] + n[2] * normal[2]) / (l * wanted);
      if (alignment > 0.999) found.push({ piece, index });
    });
  }
  return found;
}
