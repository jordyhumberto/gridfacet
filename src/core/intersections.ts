import { faceNormal, type Piece, type Vec3 } from './piece';

const EPS = 1e-7;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Punto donde el segmento a→b atraviesa la cara (polígono convexo, antihorario visto desde fuera), si lo hace por dentro. */
function segmentThroughFace(a: Vec3, b: Vec3, face: Vec3[]): Vec3 | null {
  const n = faceNormal(face);
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length === 0) return null;
  const u: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  const sa = dot(u, sub(a, face[0]));
  const sb = dot(u, sub(b, face[0]));
  if (!((sa > EPS && sb < -EPS) || (sa < -EPS && sb > EPS))) return null;
  const t = sa / (sa - sb);
  const p: Vec3 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let i = 0; i < face.length; i++) {
    const edge = sub(face[(i + 1) % face.length], face[i]);
    if (dot(cross(edge, sub(p, face[i])), u) < -EPS) return null;
  }
  return p;
}

/** Cruces entre las aristas de `a` y las caras de `b`, y al revés. */
function pairPoints(a: Piece, b: Piece, found: Map<string, Vec3>): void {
  for (const [owner, other] of [[a, b], [b, a]] as const) {
    for (const face of owner.faces) {
      for (let i = 0; i < face.length; i++) {
        const p0 = face[i];
        const p1 = face[(i + 1) % face.length];
        for (const target of other.faces) {
          const p = segmentThroughFace(p0, p1, target);
          if (p) found.set(p.map((v) => Math.round(v * 1e5)).join(','), p);
        }
      }
    }
  }
}

/** Puntos de cruce entre una pieza y cada una de las demás (no entre las demás entre sí). */
export function intersectionPointsWith(target: Piece, others: Piece[]): Vec3[] {
  const found = new Map<string, Vec3>();
  for (const other of others) if (other !== target) pairPoints(target, other, found);
  return [...found.values()];
}

/**
 * Puntos donde las aristas de una pieza atraviesan las caras de otra: los vértices que tendría la unión
 * de las piezas y que no existen en ninguna de ellas por separado.
 */
export function intersectionPoints(pieces: Piece[]): Vec3[] {
  const found = new Map<string, Vec3>();
  for (const owner of pieces) {
    for (const other of pieces) {
      if (owner === other) continue;
      for (const face of owner.faces) {
        for (let i = 0; i < face.length; i++) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          for (const target of other.faces) {
            const p = segmentThroughFace(a, b, target);
            if (p) found.set(p.map((v) => Math.round(v * 1e5)).join(','), p);
          }
        }
      }
    }
  }
  return [...found.values()];
}
