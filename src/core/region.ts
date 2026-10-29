import { unitNormal } from './extrude';
import { boundsOf } from './transform';
import type { Piece, Vec3 } from './piece';

const PLANE_EPS = 1e-4;
const TOUCH_EPS = 1e-4;

export interface FaceOf {
  piece: Piece;
  face: Vec3[];
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** ¿El punto cae dentro del poliedro convexo (con un margen mínimo)? */
function inside(piece: Piece, point: Vec3): boolean {
  return piece.faces.every((face) => {
    const n = unitNormal(face);
    return dot(n, point) <= dot(n, face[0]) + 1e-6;
  });
}

/** Una cara está tapada si justo delante de su centro hay otra pieza. */
function covered(face: FaceOf, n: Vec3, pieces: Piece[]): boolean {
  const c: Vec3 = [0, 0, 0];
  for (const p of face.face) for (let i = 0; i < 3; i++) c[i] += p[i] / face.face.length;
  const probe: Vec3 = [c[0] + n[0] * 1e-3, c[1] + n[1] * 1e-3, c[2] + n[2] * 1e-3];
  return pieces.some((other) => {
    if (other.id === face.piece.id) return false;
    const box = boundsOf([other])!;
    if ([0, 1, 2].some((i) => probe[i] < box.min[i] || probe[i] > box.max[i])) return false;
    return inside(other, probe);
  });
}

/**
 * Toda la cara a la que pertenece `start`: las caras de otras piezas que están en su mismo plano, miran hacia el mismo lado,
 * quedan a la vista y enlazan con ella por un borde, directa o a través de otras. Así un muro de 3 × 3 cubos se trata como una sola cara.
 */
export function coplanarRegion(start: FaceOf, pieces: Piece[]): FaceOf[] {
  const n = unitNormal(start.face);
  const d = dot(n, start.face[0]);
  // Base del plano para medir en 2D.
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const raw: Vec3 = [helper[1] * n[2] - helper[2] * n[1], helper[2] * n[0] - helper[0] * n[2], helper[0] * n[1] - helper[1] * n[0]];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  const u: Vec3 = [raw[0] / length, raw[1] / length, raw[2] / length];
  const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];

  const candidates: FaceOf[] = [];
  for (const piece of pieces) {
    for (const face of piece.faces) {
      if (piece.id === start.piece.id && face === start.face) continue;
      if (dot(unitNormal(face), n) < 0.9999) continue;
      if (!face.every((p) => Math.abs(dot(n, p) - d) < PLANE_EPS)) continue;
      candidates.push({ piece, face });
    }
  }
  const range = (face: Vec3[]) => {
    const us = face.map((p) => dot(u, p));
    const vs = face.map((p) => dot(v, p));
    return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
  };
  const ranges = new Map<Vec3[], ReturnType<typeof range>>();
  const rangeOf = (face: Vec3[]) => {
    let r = ranges.get(face);
    if (!r) ranges.set(face, (r = range(face)));
    return r;
  };
  // Dos caras enlazan si sus cajas se tocan o solapan con longitud en algún eje (no solo por una esquina).
  const linked = (a: Vec3[], b: Vec3[]): boolean => {
    const [ra, rb] = [rangeOf(a), rangeOf(b)];
    const ou = Math.min(ra.u1, rb.u1) - Math.max(ra.u0, rb.u0);
    const ov = Math.min(ra.v1, rb.v1) - Math.max(ra.v0, rb.v0);
    return ou >= -TOUCH_EPS && ov >= -TOUCH_EPS && (ou > TOUCH_EPS || ov > TOUCH_EPS);
  };

  const region: FaceOf[] = [start];
  const rest = candidates.filter((c) => !covered(c, n, pieces));
  for (let i = 0; i < region.length; i++) {
    for (let j = rest.length - 1; j >= 0; j--) {
      if (!linked(region[i].face, rest[j].face)) continue;
      region.push(rest[j]);
      rest.splice(j, 1);
    }
  }
  return region;
}
