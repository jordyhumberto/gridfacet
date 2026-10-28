import type { Change } from './cut';
import { clipPiece, faceNormal, planeFromPoints, type Piece, type Plane, type Vec3 } from './piece';

const EPS = 1e-6;

export interface PieceEdge {
  a: Vec3;
  b: Vec3;
  /** Las dos caras que comparten la arista. */
  faces: [Vec3[], Vec3[]];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: Vec3): Vec3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const key = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

/** Aristas de la pieza con sus dos caras (las que solo tienen una cara, que no deberían existir en un cuerpo cerrado, se ignoran). */
export function pieceEdges(piece: Piece): PieceEdge[] {
  const seen = new Map<string, { a: Vec3; b: Vec3; faces: Vec3[][] }>();
  for (const face of piece.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const [ka, kb] = [key(a), key(b)];
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = seen.get(id);
      if (entry) entry.faces.push(face);
      else seen.set(id, { a, b, faces: [face] });
    }
  }
  return [...seen.values()].filter((e) => e.faces.length === 2) as PieceEdge[];
}

function distanceToSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const d = sub(b, a);
  const len2 = dot(d, d);
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / len2));
  const q = add(a, scale(d, t));
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** La arista de la pieza más cercana a `point`, si está a menos de `maxDistance`. */
export function nearestEdge(piece: Piece, point: Vec3, maxDistance = Infinity): PieceEdge | null {
  let best: PieceEdge | null = null;
  let bestDist = maxDistance;
  for (const edge of pieceEdges(piece)) {
    const dist = distanceToSegment(point, edge.a, edge.b);
    if (dist < bestDist) {
      bestDist = dist;
      best = edge;
    }
  }
  return best;
}

/** La arista de `piece` con esos extremos (en cualquier orden), si existe. */
export function edgeBetween(piece: Piece, a: Vec3, b: Vec3): PieceEdge | null {
  const match = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4;
  return pieceEdges(piece).find((e) => (match(e.a, a) && match(e.b, b)) || (match(e.a, b) && match(e.b, a))) ?? null;
}

/** Hacia dónde se aleja la cara de la arista, en el plano de la cara. */
function inward(face: Vec3[], a: Vec3, edgeDir: Vec3): Vec3 {
  const center: Vec3 = [0, 0, 0];
  for (const p of face) for (let i = 0; i < 3; i++) center[i] += p[i] / face.length;
  const toCenter = sub(center, a);
  return unit(sub(toCenter, scale(edgeDir, dot(toCenter, edgeDir))));
}

/** Plano del chaflán: pasa por los puntos a distancia `size` de la arista sobre cada una de sus dos caras. */
export function bevelPlane(edge: PieceEdge, size: number): Plane | null {
  const dir = unit(sub(edge.b, edge.a));
  const p1 = add(edge.a, scale(inward(edge.faces[0], edge.a, dir), size));
  const p2 = add(edge.a, scale(inward(edge.faces[1], edge.a, dir), size));
  const plane = planeFromPoints(p1, p2, add(p1, sub(edge.b, edge.a)));
  if (Number.isNaN(plane.n[0])) return null;
  // La normal debe mirar hacia fuera del cuerpo: el mismo lado que las normales de las dos caras.
  const outward = add(unit(faceNormal(edge.faces[0])), unit(faceNormal(edge.faces[1])));
  return dot(plane.n, outward) >= 0 ? plane : { n: scale(plane.n, -1), d: -plane.d };
}

/** Corta la arista en chaflán: la pieza se reemplaza por otra sin esa esquina. */
export function bevelChange(piece: Piece, edge: PieceEdge, size: number): Change {
  const plane = bevelPlane(edge, size);
  if (!plane || !(size > EPS)) return { added: [], removed: [] };
  const result = clipPiece(piece, plane);
  if (!result) return { added: [], removed: [] };
  if (piece.group !== undefined) result.group = piece.group;
  return { added: [result], removed: [piece] };
}
