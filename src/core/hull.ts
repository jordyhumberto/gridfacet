import type { Vec3 } from './piece';

const EPS = 1e-7;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Quita los puntos repetidos. */
function unique(points: Vec3[]): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) if (!out.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < EPS)) out.push(p);
  return out;
}

/** Casco convexo 2D (cadena monótona), antihorario, sin puntos colineales. */
function hull2D(points: { p: [number, number]; i: number }[]): number[] {
  const sorted = [...points].sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  const turn = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const build = (list: typeof sorted) => {
    const out: typeof sorted = [];
    for (const point of list) {
      while (out.length >= 2 && turn(out[out.length - 2].p, out[out.length - 1].p, point.p) <= EPS) out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...build(sorted), ...build([...sorted].reverse())].map((point) => point.i);
}

/**
 * Cuerpo convexo más pequeño que contiene los puntos: caras antihorarias vistas desde fuera.
 * Devuelve null si los puntos son coplanares y no encierran volumen.
 */
export function convexHull(input: Vec3[]): Vec3[][] | null {
  const points = unique(input);
  if (points.length < 4) return null;
  const faces: Vec3[][] = [];
  const seen = new Set<string>();

  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      for (let k = j + 1; k < points.length; k++) {
        let n = cross(sub(points[j], points[i]), sub(points[k], points[i]));
        const length = Math.hypot(n[0], n[1], n[2]);
        if (length < EPS) continue;
        n = [n[0] / length, n[1] / length, n[2] / length];
        const d = dot(n, points[i]);
        let above = 0;
        let below = 0;
        const onPlane: number[] = [];
        points.forEach((p, index) => {
          const s = dot(n, p) - d;
          if (s > EPS) above++;
          else if (s < -EPS) below++;
          else onPlane.push(index);
        });
        if (above > 0 && below > 0) continue;
        if (above === 0 && below === 0) return null;
        // La normal debe apuntar hacia el lado vacío.
        if (below === 0) {
          n = [-n[0], -n[1], -n[2]];
        }
        const key = onPlane.join(',');
        if (seen.has(key)) continue;
        seen.add(key);

        const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const u0 = cross(helper, n);
        const ul = Math.hypot(u0[0], u0[1], u0[2]);
        const u: Vec3 = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
        const v = cross(n, u);
        const flat = onPlane.map((index) => ({ p: [dot(points[index], u), dot(points[index], v)] as [number, number], i: index }));
        const ring = hull2D(flat);
        if (ring.length >= 3) faces.push(ring.map((index) => points[index]));
      }
    }
  }
  return faces.length >= 4 ? faces : null;
}
