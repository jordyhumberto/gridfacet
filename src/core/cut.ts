import earcut from 'earcut';
import { clipPiece, faceNormal, type Piece, type Plane, type Vec3 } from './piece';

/** Piezas que desaparecen y piezas que aparecen en una operación. */
export interface Change {
  added: Piece[];
  removed: Piece[];
  /** Puntos de referencia que aparecen o desaparecen con la operación. */
  marksAdded?: Vec3[];
  marksRemoved?: Vec3[];
}

const SIDE_EPS = 1e-7;

export function flipPlane(plane: Plane): Plane {
  return { n: plane.n.map((x) => -x) as Vec3, d: -plane.d };
}

/** Verdadero si el plano atraviesa el interior de la pieza (hay vértices a ambos lados). */
export function crossesPlane(piece: Piece, plane: Plane): boolean {
  let above = false;
  let below = false;
  for (const face of piece.faces) {
    for (const p of face) {
      const s = plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d;
      if (s > SIDE_EPS) above = true;
      if (s < -SIDE_EPS) below = true;
      if (above && below) return true;
    }
  }
  return false;
}

/**
 * Corta con el plano las piezas que atraviesa y conserva el lado n·p <= d.
 * Las piezas que el plano no cruza no se tocan; con `region` (polígono sobre el plano) tampoco las que la región no alcanza. Con `keepBoth` la otra mitad también queda como pieza.
 */
export function cutPieces(pieces: Piece[], plane: Plane, keepBoth: boolean, region?: Vec3[]): Change {
  const change: Change = { added: [], removed: [] };
  const opposite = flipPlane(plane);
  for (const piece of pieces) {
    if (!crossesPlane(piece, plane)) continue;
    if (region && !regionTouchesPiece(piece, plane, region)) continue;
    change.removed.push(piece);
    const kept = clipPiece(piece, plane);
    if (kept) change.added.push(kept);
    if (keepBoth) {
      const other = clipPiece(piece, opposite);
      if (other) change.added.push(other);
    }
  }
  return change;
}

const AREA_EPS = 1e-6;

type Vec2 = [number, number];

/** Plano de un polígono cerrado (normal por el método de Newell); los puntos deben ser casi coplanares. */
export function planeOfPolygon(points: Vec3[]): Plane {
  const n = faceNormal(points);
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  return { n: unit, d: unit[0] * points[0][0] + unit[1] * points[0][1] + unit[2] * points[0][2] };
}

export function projectToPlane(p: Vec3, plane: Plane): Vec3 {
  const s = plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d;
  return [p[0] - plane.n[0] * s, p[1] - plane.n[1] * s, p[2] - plane.n[2] * s];
}

/** Dos ejes ortogonales dentro del plano, para trabajar en 2D. */
function planeBasis(n: Vec3): { u: Vec3; v: Vec3 } {
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cu: Vec3 = [helper[1] * n[2] - helper[2] * n[1], helper[2] * n[0] - helper[0] * n[2], helper[0] * n[1] - helper[1] * n[0]];
  const lu = Math.hypot(cu[0], cu[1], cu[2]);
  const u: Vec3 = [cu[0] / lu, cu[1] / lu, cu[2] / lu];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  return { u, v };
}

const to2D = (p: Vec3, u: Vec3, v: Vec3): Vec2 => [
  p[0] * u[0] + p[1] * u[1] + p[2] * u[2],
  p[0] * v[0] + p[1] * v[1] + p[2] * v[2],
];

const area2D = (poly: Vec2[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** Sutherland–Hodgman: recorta un polígono por un triángulo antihorario. */
function clipByTriangle(subject: Vec2[], tri: Vec2[]): Vec2[] {
  let out = subject;
  for (let i = 0; i < 3 && out.length > 0; i++) {
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    const side = (p: Vec2) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out;
}

/** Sección de la pieza con el plano (polígono convexo en 2D, antihorario). */
function sectionPolygon(piece: Piece, plane: Plane, u: Vec3, v: Vec3): Vec2[] {
  const points: Vec2[] = [];
  const signed = (p: Vec3) => plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2] - plane.d;
  for (const face of piece.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const sa = signed(a);
      const sb = signed(b);
      if (Math.abs(sa) < SIDE_EPS) points.push(to2D(a, u, v));
      if ((sa > SIDE_EPS && sb < -SIDE_EPS) || (sa < -SIDE_EPS && sb > SIDE_EPS)) {
        const t = sa / (sa - sb);
        points.push(to2D([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], u, v));
      }
    }
  }
  if (points.length < 3) return [];
  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  points.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  return points;
}

/** Triángulos (en 3D) que cubren un polígono plano, aunque no sea convexo. */
export function triangulateRegion(region: Vec3[], plane: Plane): Vec3[][] {
  const { u, v } = planeBasis(plane.n);
  const flat = region.flatMap((p) => to2D(p, u, v));
  const indices = earcut(flat, undefined, 2);
  const triangles: Vec3[][] = [];
  for (let i = 0; i < indices.length; i += 3) triangles.push([region[indices[i]], region[indices[i + 1]], region[indices[i + 2]]]);
  return triangles;
}

/** Verdadero si la región dibujada solapa la sección que el plano hace en la pieza. */
export function regionTouchesPiece(piece: Piece, plane: Plane, region: Vec3[]): boolean {
  const { u, v } = planeBasis(plane.n);
  const section = sectionPolygon(piece, plane, u, v);
  if (section.length < 3) return false;
  for (const triangle of triangulateRegion(region, plane)) {
    const tri = triangle.map((p) => to2D(p, u, v));
    if (area2D(tri) < 0) tri.reverse();
    const overlap = clipByTriangle(section, tri);
    if (overlap.length >= 3 && Math.abs(area2D(overlap)) > AREA_EPS) return true;
  }
  return false;
}
