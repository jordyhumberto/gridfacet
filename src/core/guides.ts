import { faceNormal, type Piece, type Vec3 } from './piece';

/** A qué distancia del cursor (en celdas) cuenta una cara como "la que apunta". */
const PLANE_RANGE = 0.3;
/** Cuánto se puede salir el cursor del borde de una cara y seguir contando como sobre ella. */
const FACE_MARGIN = 0.3;
const EPS = 1e-6;

export type Segment = [Vec3, Vec3];

export interface Guides {
  /** Vértices virtuales: donde se cruzan las aristas prolongadas de las piezas apoyadas en el mismo plano. */
  points: Vec3[];
  /** Esas aristas prolongadas, recortadas a la cara sobre la que está el cursor. */
  lines: Segment[];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const keyOf = (p: Vec3): string => p.map((v) => Math.round(v * 1e4)).join(',');

interface PlaneFace {
  face: Vec3[];
}

interface PlaneGroup {
  n: Vec3;
  d: number;
  faces: PlaneFace[];
  pieces: Set<Piece>;
}

/** Normal con signo canónico, para que dos caras opuestas sobre el mismo plano caigan en el mismo grupo. */
function canonical(n: Vec3, d: number): { n: Vec3; d: number } {
  const lead = Math.abs(n[0]) > 1e-6 ? n[0] : Math.abs(n[1]) > 1e-6 ? n[1] : n[2];
  return lead < 0 ? { n: [-n[0], -n[1], -n[2]], d: -d } : { n, d };
}

/**
 * Vértices virtuales bajo el cursor. Las piezas apoyadas en un mismo plano (un cubo pequeño sobre la pared de otro)
 * tienen aristas que, prolongadas por ese plano, se cruzan entre sí y con el borde de la pared: esos cruces no son
 * vértices de ninguna pieza, pero son los puntos que hace falta poder marcar para cortar o rellenar.
 */
export function guideVertices(hit: Vec3, pieces: Piece[]): Guides {
  const groups: PlaneGroup[] = [];
  for (const piece of pieces) {
    for (const face of piece.faces) {
      const raw = unit(faceNormal(face));
      const { n, d } = canonical(raw, dot(raw, face[0]));
      if (Math.abs(dot(n, hit) - d) > PLANE_RANGE) continue;
      // Mismo plano si la normal coincide y la distancia al origen también (con margen: las caras inclinadas no salen exactas).
      let group = groups.find((g) => dot(g.n, n) > 1 - 1e-7 && Math.abs(g.d - d) < 1e-4);
      if (!group) groups.push((group = { n, d, faces: [], pieces: new Set() }));
      group.faces.push({ face });
      group.pieces.add(piece);
    }
  }

  const points = new Map<string, Vec3>();
  const lines: Segment[] = [];
  for (const group of groups) {
    if (group.pieces.size < 2) continue;
    collect(group, hit, points, lines);
  }
  return { points: [...points.values()], lines };
}

function collect(group: PlaneGroup, hit: Vec3, points: Map<string, Vec3>, lines: Segment[]): void {
  const { n } = group;
  const helper: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(helper, n));
  const v = cross(n, u);
  const origin = group.faces[0].face[0];
  const to2 = (p: Vec3): [number, number] => {
    const d = sub(p, origin);
    return [dot(d, u), dot(d, v)];
  };
  const to3 = (x: number, y: number): Vec3 => [origin[0] + u[0] * x + v[0] * y, origin[1] + u[1] * x + v[1] * y, origin[2] + u[2] * x + v[2] * y];

  const polygons = group.faces.map(({ face }) => {
    const poly = face.map(to2);
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const [a, b] = [poly[i], poly[(i + 1) % poly.length]];
      area += a[0] * b[1] - b[0] * a[1];
    }
    return { poly, orient: area < 0 ? -1 : 1 };
  });

  const inside = (p: [number, number], margin: number) =>
    polygons.some(({ poly, orient }) =>
      poly.every((a, i) => {
        const b = poly[(i + 1) % poly.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return (orient * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))) / len >= -margin;
      }),
    );

  // El cursor tiene que estar sobre alguna cara del grupo (o casi).
  const cursor = to2(hit);
  if (!inside(cursor, FACE_MARGIN)) return;

  // Aristas distintas del grupo, como rectas del plano.
  const seen = new Set<string>();
  const edges: { p: [number, number]; r: [number, number] }[] = [];
  for (const { face } of group.faces) {
    for (let i = 0; i < face.length; i++) {
      const [a, b] = [face[i], face[(i + 1) % face.length]];
      const [ka, kb] = [keyOf(a), keyOf(b)];
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const [pa, pb] = [to2(a), to2(b)];
      edges.push({ p: pa, r: [pb[0] - pa[0], pb[1] - pa[1]] });
    }
  }

  // Cruces entre rectas que caen dentro de alguna cara del grupo.
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [e, f] = [edges[i], edges[j]];
      const denom = e.r[0] * f.r[1] - e.r[1] * f.r[0];
      if (Math.abs(denom) < EPS * Math.hypot(...e.r) * Math.hypot(...f.r)) continue;
      const t = ((f.p[0] - e.p[0]) * f.r[1] - (f.p[1] - e.p[1]) * f.r[0]) / denom;
      const p: [number, number] = [e.p[0] + e.r[0] * t, e.p[1] + e.r[1] * t];
      if (!inside(p, EPS)) continue;
      const point = to3(p[0], p[1]);
      points.set(keyOf(point), point);
    }
  }

  // Las rectas, recortadas a la cara que contiene el cursor para dibujarlas sin pasarse.
  const host = polygons.find(({ poly, orient }) =>
    poly.every((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const side = orient * ((b[0] - a[0]) * (cursor[1] - a[1]) - (b[1] - a[1]) * (cursor[0] - a[0]));
      return side >= -FACE_MARGIN * Math.hypot(b[0] - a[0], b[1] - a[1]);
    }),
  );
  if (!host) return;
  for (const e of edges) {
    let [lo, hi] = [-Infinity, Infinity];
    let clipped = true;
    host.poly.forEach((a, i) => {
      const b = host.poly[(i + 1) % host.poly.length];
      // Semiplano a la izquierda de a→b (según orientación): c(p) = orient·cross(b−a, p−a) ≥ 0.
      const w: [number, number] = [b[0] - a[0], b[1] - a[1]];
      const c0 = host.orient * (w[0] * (e.p[1] - a[1]) - w[1] * (e.p[0] - a[0]));
      const c1 = host.orient * (w[0] * e.r[1] - w[1] * e.r[0]);
      if (Math.abs(c1) < 1e-12) {
        if (c0 < -EPS) clipped = false;
        return;
      }
      const t = -c0 / c1;
      if (c1 > 0) lo = Math.max(lo, t);
      else hi = Math.min(hi, t);
    });
    if (!clipped || !(hi - lo > EPS) || !Number.isFinite(lo + hi)) continue;
    lines.push([to3(e.p[0] + e.r[0] * lo, e.p[1] + e.r[1] * lo), to3(e.p[0] + e.r[0] * hi, e.p[1] + e.r[1] * hi)]);
  }
}
