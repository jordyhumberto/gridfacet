import { faceNormal, makePiece, type Piece, type Vec3 } from './piece';

const FACE_TOLERANCE = 1e-3;

/** Distancia del punto (sobre el plano de la cara) a la cara: 0 si cae dentro del polígono, si no la distancia a su borde más cercano. */
function distanceToFace(face: Vec3[], unit: Vec3, point: Vec3): number {
  // Se mira en 2D quitando el eje en el que la normal pesa más.
  const drop = Math.abs(unit[0]) >= Math.abs(unit[1]) && Math.abs(unit[0]) >= Math.abs(unit[2]) ? 0 : Math.abs(unit[1]) >= Math.abs(unit[2]) ? 1 : 2;
  const [i, j] = [0, 1, 2].filter((k) => k !== drop);
  let inside = false;
  let edge = Infinity;
  for (let k = 0, m = face.length - 1; k < face.length; m = k++) {
    const a = face[k];
    const b = face[m];
    if (a[j] > point[j] !== b[j] > point[j] && point[i] < ((b[i] - a[i]) * (point[j] - a[j])) / (b[j] - a[j]) + a[i]) inside = !inside;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const length2 = dx * dx + dy * dy + dz * dz;
    const t = length2 < 1e-18 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy + (point[2] - a[2]) * dz) / length2));
    edge = Math.min(edge, Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t), point[2] - (a[2] + dz * t)));
  }
  return inside ? 0 : edge;
}

/**
 * Cara de la pieza que contiene `point` y mira hacia `normal`; sirve para saber qué cara se tocó con el ratón.
 * Varias caras pueden estar en el mismo plano (una cara partida con Trazar segmento, o hecha de triángulos con «+ Vértice»): gana la que tiene el punto dentro
 * (o la más cercana), no la primera de la lista.
 */
export function faceAt(piece: Piece, point: Vec3, normal: Vec3): Vec3[] | undefined {
  let best: Vec3[] | undefined;
  let bestOutside = Infinity;
  let bestDot = 0.999;
  for (const face of piece.faces) {
    const n = faceNormal(face);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length === 0) continue;
    const u: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    const alignment = u[0] * normal[0] + u[1] * normal[1] + u[2] * normal[2];
    const offset = (point[0] - face[0][0]) * u[0] + (point[1] - face[0][1]) * u[1] + (point[2] - face[0][2]) * u[2];
    if (alignment <= 0.999 || Math.abs(offset) >= FACE_TOLERANCE) continue;
    const outside = distanceToFace(face, u, point);
    // Con el punto dentro de dos caras (sobre el borde que comparten) manda la que mejor mira hacia `normal`.
    const nearer = outside < bestOutside - 1e-9 || (Math.abs(outside - bestOutside) <= 1e-9 && alignment > bestDot);
    if (nearer || !best) {
      best = face;
      bestOutside = outside;
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
