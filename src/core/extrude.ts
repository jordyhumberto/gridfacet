import { faceNormal, makePiece, type Piece, type Vec3 } from './piece';

const FACE_TOLERANCE = 1e-3;

/** Cara de la pieza que contiene `point` y mira hacia `normal`; sirve para saber qué cara se tocó con el ratón. */
export function faceAt(piece: Piece, point: Vec3, normal: Vec3): Vec3[] | undefined {
  let best: Vec3[] | undefined;
  let bestDot = 0.999;
  for (const face of piece.faces) {
    const n = faceNormal(face);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length === 0) continue;
    const u: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    const alignment = u[0] * normal[0] + u[1] * normal[1] + u[2] * normal[2];
    const offset = (point[0] - face[0][0]) * u[0] + (point[1] - face[0][1]) * u[1] + (point[2] - face[0][2]) * u[2];
    if (alignment > bestDot && Math.abs(offset) < FACE_TOLERANCE) {
      best = face;
      bestDot = alignment;
    }
  }
  return best;
}

/** Normal unitaria de una cara. */
export function unitNormal(face: Vec3[]): Vec3 {
  const n = faceNormal(face);
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/** Prisma que hace crecer una cara `distance` hacia fuera; es convexo si la cara lo es. */
export function extrudeFace(face: Vec3[], color: number, distance: number): Piece {
  const n = unitNormal(face);
  const lift = (p: Vec3): Vec3 => [p[0] + n[0] * distance, p[1] + n[1] * distance, p[2] + n[2] * distance];
  const top = face.map(lift);
  const faces: Vec3[][] = [top, [...face].reverse()];
  for (let i = 0; i < face.length; i++) {
    const j = (i + 1) % face.length;
    faces.push([face[i], face[j], top[j], top[i]]);
  }
  return makePiece(faces, color);
}
