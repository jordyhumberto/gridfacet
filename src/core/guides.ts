import { faceNormal, type Piece, type Vec3 } from './piece';

/** A qué distancia del cursor (en celdas) cuenta una cara como "la que apunta". */
const PLANE_RANGE = 0.3;
/** Cuánto se puede salir el cursor del borde de una cara y seguir contando como sobre ella. */
const FACE_MARGIN = 0.3;
/** Hasta dónde llegan, alrededor del cursor, las piezas vecinas cuyas aristas se proyectan sobre la cara. */
const PROJECT_REACH = 1.5;
/** Máximo de rectas proyectadas por cara: las más cercanas al cursor. */
const MAX_PROJECTED = 48;
/** Solo cuentan las piezas a esta distancia (celdas) del cursor: en una escena grande, recorrerlas todas haría lento cada movimiento del ratón. */
const GUIDE_REACH = 4;
const EPS = 1e-6;

export type Segment = [Vec3, Vec3];

export interface Guides {
  /** Vértices virtuales: donde se cruzan las aristas prolongadas de las piezas apoyadas en el mismo plano y las proyectadas de las vecinas. */
  points: Vec3[];
  /** Las aristas prolongadas de las piezas apoyadas en el mismo plano, recortadas a la cara sobre la que está el cursor. */
  lines: Segment[];
  /** Las aristas de las piezas vecinas (de otros planos) proyectadas sobre esa cara, recortadas a ella. */
  projected: Segment[];
  /** Puntos de la rejilla de marcado cerca del cursor (subdivisiones de aristas y cuadrícula de las caras). Los rellena quien llama. */
  grid: Vec3[];
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

const edgeCache = new WeakMap<Piece, Segment[]>();
const boxCache = new WeakMap<Piece, { min: Vec3; max: Vec3 }>();

/** Aristas distintas de la pieza. */
function edgesOf(piece: Piece): Segment[] {
  let edges = edgeCache.get(piece);
  if (!edges) {
    const seen = new Set<string>();
    edges = [];
    for (const face of piece.faces) {
      for (let i = 0; i < face.length; i++) {
        const [a, b] = [face[i], face[(i + 1) % face.length]];
        const [ka, kb] = [keyOf(a), keyOf(b)];
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }
    edgeCache.set(piece, edges);
  }
  return edges;
}

function boxOf(piece: Piece): { min: Vec3; max: Vec3 } {
  let box = boxCache.get(piece);
  if (!box) {
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const face of piece.faces) for (const p of face) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], p[i]), (max[i] = Math.max(max[i], p[i])));
    box = { min, max };
    boxCache.set(piece, box);
  }
  return box;
}

/**
 * Vértices virtuales bajo el cursor, en cada plano de cara cercano (también de una pieza sola):
 * - Las piezas apoyadas en un mismo plano (un cubo pequeño sobre la pared de otro) tienen aristas que, prolongadas por ese
 *   plano, se cruzan entre sí y con el borde de la pared.
 * - Las aristas de las piezas vecinas que no están en ese plano (un cubito sobre el borde, un escalón al lado) se proyectan
 *   sobre él en perpendicular; sus proyecciones, sus extremos y sus cruces con las demás rectas también son puntos que marcar.
 * Ninguno es vértice de una pieza, pero son los puntos que hace falta poder marcar para cortar o rellenar.
 */
export function guideVertices(hit: Vec3, pieces: Piece[]): Guides {
  const groups: PlaneGroup[] = [];
  for (const piece of pieces) {
    const box = boxOf(piece);
    if ([0, 1, 2].some((i) => hit[i] < box.min[i] - GUIDE_REACH || hit[i] > box.max[i] + GUIDE_REACH)) continue;
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

  const near = pieces.filter((piece) => {
    const box = boxOf(piece);
    return [0, 1, 2].every((i) => hit[i] > box.min[i] - PROJECT_REACH && hit[i] < box.max[i] + PROJECT_REACH);
  });

  const points = new Map<string, Vec3>();
  const lines: Segment[] = [];
  const projected: Segment[] = [];
  for (const group of groups) collect(group, near, hit, points, lines, projected);
  return { points: [...points.values()], lines, projected, grid: [] };
}

type Line2 = { p: [number, number]; r: [number, number] };

/** Distancia de un punto de la cara a un segmento de ella. */
function segmentDistance(e: Line2, cursor: [number, number]): number {
  const len2 = e.r[0] * e.r[0] + e.r[1] * e.r[1] || 1;
  const t = Math.max(0, Math.min(1, ((cursor[0] - e.p[0]) * e.r[0] + (cursor[1] - e.p[1]) * e.r[1]) / len2));
  return Math.hypot(e.p[0] + e.r[0] * t - cursor[0], e.p[1] + e.r[1] * t - cursor[1]);
}

function collect(group: PlaneGroup, near: Piece[], hit: Vec3, points: Map<string, Vec3>, lines: Segment[], projectedOut: Segment[]): void {
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
    const xs = poly.map((q) => q[0]);
    const ys = poly.map((q) => q[1]);
    return { poly, orient: area < 0 ? -1 : 1, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
  });

  // La caja de cada polígono descarta de entrada casi todos: con muchas caras en el plano, probar cada punto contra todas sería lento.
  const inside = (p: [number, number], margin: number) =>
    polygons.some(({ poly, orient, box }) =>
      p[0] >= box[0] - margin && p[0] <= box[2] + margin && p[1] >= box[1] - margin && p[1] <= box[3] + margin &&
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
  const edges: Line2[] = [];
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

  // Las rectas del grupo que quedan lejos del cursor no aportan cruces que marcar: sin este límite, un plano con muchas piezas cuesta cada vez más.
  const nearEdges = edges.filter((e) => segmentDistance(e, cursor) < GUIDE_REACH);
  edges.length = 0;
  edges.push(...nearEdges);

  // Aristas de las piezas vecinas proyectadas en perpendicular sobre el plano. Las que ya están en él se descartan (ya son rectas del grupo).
  const flat = (p: Vec3) => Math.abs(dot(n, p) - group.d) < 1e-4;
  const shadows: Line2[] = [];
  const shadowPoints: Vec3[] = [];
  const shadowSeen = new Set<string>();
  for (const piece of near) {
    // Las piezas que tienen una cara en este plano ya aportan sus aristas como rectas del grupo.
    if (group.pieces.has(piece)) continue;
    for (const [a, b] of edgesOf(piece)) {
      if (flat(a) && flat(b)) continue;
      const [pa, pb] = [to2(a), to2(b)];
      const r: [number, number] = [pb[0] - pa[0], pb[1] - pa[1]];
      for (const end of [pa, pb]) {
        const point = to3(end[0], end[1]);
        if (!inside(end, EPS)) continue;
        const key = keyOf(point);
        if (!shadowSeen.has(`p${key}`)) {
          shadowSeen.add(`p${key}`);
          shadowPoints.push(point);
        }
      }
      if (Math.hypot(r[0], r[1]) < 1e-5) continue;
      const [ka, kb] = [keyOf(to3(pa[0], pa[1])), keyOf(to3(pb[0], pb[1]))];
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (shadowSeen.has(key)) continue;
      shadowSeen.add(key);
      shadows.push({ p: pa, r });
    }
  }
  // Las más cercanas al cursor: la distancia del cursor al segmento.
  const nearShadows = shadows
    .map((e) => ({ e, dist: segmentDistance(e, cursor) }))
    .filter(({ dist }) => dist < PROJECT_REACH)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_PROJECTED)
    .map(({ e }) => e);

  const all = [...edges, ...nearShadows];
  // Los vértices de verdad ya los ofrece quien llama: solo se devuelven los virtuales.
  const real = new Set<string>();
  for (const piece of near) for (const face of piece.faces) for (const p of face) real.add(keyOf(p));
  const add = (point: Vec3): void => {
    const key = keyOf(point);
    if (!real.has(key)) points.set(key, point);
  };
  for (const point of shadowPoints) add(point);
  // Cruces entre rectas (del grupo o proyectadas) que caen dentro de alguna cara del grupo.
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const [e, f] = [all[i], all[j]];
      const denom = e.r[0] * f.r[1] - e.r[1] * f.r[0];
      if (Math.abs(denom) < EPS * Math.hypot(...e.r) * Math.hypot(...f.r)) continue;
      const t = ((f.p[0] - e.p[0]) * f.r[1] - (f.p[1] - e.p[1]) * f.r[0]) / denom;
      const p: [number, number] = [e.p[0] + e.r[0] * t, e.p[1] + e.r[1] * t];
      if (!inside(p, EPS)) continue;
      // Con una recta proyectada solo cuentan los cruces cerca del cursor: de lo contrario habría puntos por toda la cara.
      if (j >= edges.length && Math.hypot(p[0] - cursor[0], p[1] - cursor[1]) > PROJECT_REACH) continue;
      add(to3(p[0], p[1]));
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
  const clip = (e: Line2): Segment | null => {
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
    if (!clipped || !(hi - lo > EPS) || !Number.isFinite(lo + hi)) return null;
    return [to3(e.p[0] + e.r[0] * lo, e.p[1] + e.r[1] * lo), to3(e.p[0] + e.r[0] * hi, e.p[1] + e.r[1] * hi)];
  };
  // Los bordes de una cara sola no son guías: ya se ven.
  if (group.pieces.size >= 2) {
    for (const e of edges) {
      const segment = clip(e);
      if (segment) lines.push(segment);
    }
  }
  for (const e of nearShadows) {
    const segment = clip(e);
    if (segment) projectedOut.push(segment);
  }
}
