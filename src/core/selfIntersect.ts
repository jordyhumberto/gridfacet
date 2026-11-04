import { triangulateFace } from './convex';
import type { Piece, Vec3 } from './piece';

const key = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

const EPS = 1e-6;
/** Grosor mínimo: dos superficies paralelas, de frente una a otra y más cerca que esto, cuentan como pegadas (el cuerpo se ha quedado en una lámina). */
const THIN = 0.02;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

type Tri = { p: [Vec3, Vec3, Vec3]; face: number; n: Vec3; min: Vec3; max: Vec3 };

function trianglesOf(piece: Piece): Tri[] {
  const out: Tri[] = [];
  piece.faces.forEach((face, f) => {
    for (const [a, b, c] of triangulateFace(face)) {
      const p: [Vec3, Vec3, Vec3] = [face[a], face[b], face[c]];
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
      const length = Math.hypot(...n);
      if (length < 1e-12) continue;
      const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
      const min: Vec3 = [0, 1, 2].map((k) => Math.min(p[0][k], p[1][k], p[2][k])) as Vec3;
      const max: Vec3 = [0, 1, 2].map((k) => Math.max(p[0][k], p[1][k], p[2][k])) as Vec3;
      out.push({ p, face: f, n: unit, min, max });
    }
  });
  return out;
}

/** ¿El segmento a→b atraviesa por dentro el triángulo (sin tocar su plano en los extremos)? */
function pierces(a: Vec3, b: Vec3, t: Tri): boolean {
  const sa = dot(t.n, sub(a, t.p[0]));
  const sb = dot(t.n, sub(b, t.p[0]));
  if (!((sa > EPS && sb < -EPS) || (sa < -EPS && sb > EPS))) return false;
  const k = sa / (sa - sb);
  const q: Vec3 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  for (let i = 0; i < 3; i++) {
    const edge = sub(t.p[(i + 1) % 3], t.p[i]);
    if (dot(cross(edge, sub(q, t.p[i])), t.n) < EPS) return false;
  }
  return true;
}

/** ¿Dos triángulos en el mismo plano se solapan con superficie (no solo se tocan por un borde)? */
function overlapFlat(a: Tri, b: Tri): boolean {
  const axes: Vec3[] = [];
  for (const t of [a, b]) {
    for (let i = 0; i < 3; i++) axes.push(cross(t.n, sub(t.p[(i + 1) % 3], t.p[i])));
  }
  for (const axis of axes) {
    const length = Math.hypot(...axis);
    if (length < 1e-12) continue;
    const range = (t: Tri): [number, number] => {
      const d = t.p.map((q) => dot(q, axis) / length);
      return [Math.min(...d), Math.max(...d)];
    };
    const [a0, a1] = range(a);
    const [b0, b1] = range(b);
    if (a1 - b0 < EPS || b1 - a0 < EPS) return false;
  }
  return true;
}

function coplanar(a: Tri, b: Tri): boolean {
  if (dot(cross(a.n, b.n), cross(a.n, b.n)) > 1e-10) return false;
  return b.p.every((q) => Math.abs(dot(a.n, sub(q, a.p[0]))) < EPS);
}

/** ¿Son paralelos, miran en sentidos opuestos y están a menos del grosor mínimo? */
function pressed(a: Tri, b: Tri): boolean {
  if (dot(a.n, b.n) > -0.9999) return false;
  return b.p.every((q) => Math.abs(dot(a.n, sub(q, a.p[0]))) < THIN);
}

/**
 * ¿La pieza se atraviesa o se aplasta contra sí misma? Pasa cuando dos partes de su superficie se cruzan o quedan una sobre otra
 * (por ejemplo, la cara de arriba baja hasta la de abajo y el cuerpo se queda en una lámina). Dos caras que solo comparten un borde no cuentan.
 */
export function collapses(piece: Piece): boolean {
  const tris = trianglesOf(piece);
  const faceCount = new Map<string, number>();
  for (const face of piece.faces) for (const k of new Set(face.map(key))) faceCount.set(k, (faceCount.get(k) ?? 0) + 1);
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      const a = tris[i];
      const b = tris[j];
      if (a.face === b.face) continue;
      if ([0, 1, 2].some((k) => a.max[k] < b.min[k] - THIN || b.max[k] < a.min[k] - THIN)) continue;
      if (coplanar(a, b) || pressed(a, b)) {
        // Comparten un vértice que solo tocan dos caras: es una aleta (un punto de arista sacado fuera), no un cuerpo aplastado. Aplastar de verdad es poner partes lejanas una sobre otra.
        if (a.p.some((p) => b.p.some((q) => key(p) === key(q) && (faceCount.get(key(p)) ?? 0) <= 2))) continue;
        // Mirando en sentidos opuestos y encima una de otra: dos láminas pegadas; mirando igual: caras que se pisan.
        if (overlapFlat(a, b)) return true;
        continue;
      }
      for (let k = 0; k < 3; k++) {
        if (pierces(a.p[k], a.p[(k + 1) % 3], b) || pierces(b.p[k], b.p[(k + 1) % 3], a)) return true;
      }
    }
  }
  return false;
}
