import earcut from 'earcut';
import { faceNormal, type Vec3 } from './piece';
import type { SurfaceFace } from './union';

const KEY = 1e6;
const PLANE_KEY = 1e5;
const ON_EDGE = 1e-7;
const MIN_AREA = 1e-9;

const vertexKey = (p: Vec3): string => `${Math.round(p[0] * KEY)},${Math.round(p[1] * KEY)},${Math.round(p[2] * KEY)}`;

interface Vertex {
  key: string;
  p: Vec3;
  u: number;
  v: number;
}

interface Edge {
  a: Vertex;
  b: Vertex;
}

interface Group {
  normal: Vec3;
  /** Ejes que forman el plano 2D de trabajo. */
  axes: [number, number];
  /** +1 si (u, v) conserva el sentido antihorario visto desde fuera, -1 si lo invierte. */
  orient: 1 | -1;
  polys: Vec3[][];
}

function groupKey(face: SurfaceFace, normal: Vec3): string {
  const d = normal[0] * face.face[0][0] + normal[1] * face.face[0][1] + normal[2] * face.face[0][2];
  const q = (x: number) => Math.round(x * PLANE_KEY);
  return `${q(normal[0])},${q(normal[1])},${q(normal[2])},${q(d)}|${face.color}`;
}

function makeGroup(normal: Vec3): Group {
  const abs = normal.map(Math.abs);
  const k = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
  const axes: [number, number] = [[1, 2], [2, 0], [0, 1]][k] as [number, number];
  return { normal, axes, orient: normal[k] >= 0 ? 1 : -1, polys: [] };
}

/** Parte un lado en los vértices del grupo que caen sobre él, para que las aristas compartidas coincidan. */
function splitEdge(a: Vertex, b: Vertex, sorted: Vertex[]): Vertex[] {
  const minU = Math.min(a.u, b.u) - ON_EDGE;
  const maxU = Math.max(a.u, b.u) + ON_EDGE;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].u < minU) lo = mid + 1;
    else hi = mid;
  }

  const abU = b.u - a.u;
  const abV = b.v - a.v;
  const len2 = abU * abU + abV * abV;
  const len = Math.sqrt(len2);
  const between: { t: number; vertex: Vertex }[] = [];
  for (let i = lo; i < sorted.length && sorted[i].u <= maxU; i++) {
    const p = sorted[i];
    if (p === a || p === b) continue;
    const apU = p.u - a.u;
    const apV = p.v - a.v;
    const t = (apU * abU + apV * abV) / len2;
    if (t <= 1e-9 || t >= 1 - 1e-9) continue;
    if (Math.abs(abU * apV - abV * apU) / len < ON_EDGE) between.push({ t, vertex: p });
  }
  between.sort((x, y) => x.t - y.t);
  return [a, ...between.map((x) => x.vertex), b];
}

/** Contorno de la región cubierta por los polígonos del grupo, como lazos de vértices. */
function boundaryLoops(group: Group): Vertex[][] {
  const [iu, iv] = group.axes;
  const vertices = new Map<string, Vertex>();
  const vertexOf = (p: Vec3): Vertex => {
    const key = vertexKey(p);
    let vertex = vertices.get(key);
    if (!vertex) {
      vertex = { key, p, u: p[iu], v: p[iv] };
      vertices.set(key, vertex);
    }
    return vertex;
  };

  const polys = group.polys.map((poly) => poly.map(vertexOf));
  const sorted = [...vertices.values()].sort((x, y) => x.u - y.u);

  // Un lado compartido aparece una vez en cada sentido; al anularse queda solo el contorno.
  const edges = new Map<string, Edge>();
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const chain = splitEdge(poly[i], poly[(i + 1) % poly.length], sorted);
      for (let k = 0; k + 1 < chain.length; k++) {
        const a = chain[k];
        const b = chain[k + 1];
        if (!edges.delete(`${b.key}>${a.key}`)) edges.set(`${a.key}>${b.key}`, { a, b });
      }
    }
  }

  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges.values()) {
    const list = outgoing.get(edge.a.key);
    if (list) list.push(edge);
    else outgoing.set(edge.a.key, [edge]);
  }

  const loops: Vertex[][] = [];
  for (const start of edges.values()) {
    if (!outgoing.get(start.a.key)?.includes(start)) continue;
    const loop: Vertex[] = [];
    let current: Edge | undefined = start;
    while (current) {
      const list = outgoing.get(current.a.key)!;
      list.splice(list.indexOf(current), 1);
      loop.push(current.a);
      if (current.b === start.a) break;
      current = pickNext(current, outgoing.get(current.b.key) ?? [], group.orient);
    }
    if (current) loops.push(loop);
  }
  return loops;
}

/** En un vértice con varias salidas, sigue el giro más cerrado hacia el interior para no cruzar regiones. */
function pickNext(incoming: Edge, candidates: Edge[], orient: 1 | -1): Edge | undefined {
  const dU = incoming.b.u - incoming.a.u;
  const dV = incoming.b.v - incoming.a.v;
  let best: Edge | undefined;
  let bestAngle = -Infinity;
  for (const candidate of candidates) {
    const cU = candidate.b.u - candidate.a.u;
    const cV = candidate.b.v - candidate.a.v;
    const angle = orient * Math.atan2(dU * cV - dV * cU, dU * cU + dV * cV);
    if (angle > bestAngle) {
      bestAngle = angle;
      best = candidate;
    }
  }
  return best;
}

function signedArea(loop: Vertex[], orient: number): number {
  let sum = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    sum += a.u * b.v - b.u * a.v;
  }
  return (orient * sum) / 2;
}

function isStraight(prev: Vertex, v: Vertex, next: Vertex): boolean {
  const ax = v.u - prev.u;
  const ay = v.v - prev.v;
  const bx = next.u - v.u;
  const by = next.v - v.v;
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  return dot > 0 && Math.abs(cross) <= 1e-7 * Math.hypot(ax, ay) * Math.hypot(bx, by);
}

function contains(loop: Vertex[], u: number, v: number): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.v > v !== b.v > v && u < ((b.u - a.u) * (v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

function triangulate(loops: Vertex[][], group: Group): Vec3[][] {
  const outers: { loop: Vertex[]; area: number; holes: Vertex[][] }[] = [];
  const holes: Vertex[][] = [];
  for (const loop of loops) {
    const area = signedArea(loop, group.orient);
    if (Math.abs(area) < MIN_AREA) continue;
    if (area > 0) outers.push({ loop, area, holes: [] });
    else holes.push(loop);
  }

  for (const hole of holes) {
    let owner: (typeof outers)[number] | undefined;
    for (const outer of outers) {
      const inside = hole.some((v) => contains(outer.loop, v.u, v.v) && !outer.loop.includes(v));
      if (inside && (!owner || outer.area < owner.area)) owner = outer;
    }
    owner?.holes.push(hole);
  }

  const triangles: Vec3[][] = [];
  for (const { loop, holes: inner } of outers) {
    const ring = [loop, ...inner];
    const flat: number[] = [];
    const holeStarts: number[] = [];
    const points: Vertex[] = [];
    ring.forEach((r, k) => {
      if (k > 0) holeStarts.push(points.length);
      for (const v of r) {
        flat.push(v.u, v.v);
        points.push(v);
      }
    });
    const indices = earcut(flat, holeStarts, 2);
    for (let i = 0; i < indices.length; i += 3) {
      let tri: Vec3[] = [points[indices[i]].p, points[indices[i + 1]].p, points[indices[i + 2]].p];
      const n = faceNormal(tri);
      const length = Math.hypot(n[0], n[1], n[2]);
      if (length < MIN_AREA) continue;
      if (n[0] * group.normal[0] + n[1] * group.normal[1] + n[2] * group.normal[2] < 0) tri = [tri[0], tri[2], tri[1]];
      triangles.push(tri);
    }
  }
  return triangles;
}

/**
 * Une los polígonos coplanares y del mismo color en regiones, y las triangula. Una fila de cubos
 * pasa de una cara por cubo a una sola cara larga. Los vértices que quedan en línea recta se quitan
 * solo si lo están en todas las caras que los usan, para no abrir grietas entre caras vecinas.
 */
export function mergeCoplanar(faces: SurfaceFace[]): SurfaceFace[] {
  const groups = new Map<string, { group: Group; color: number }>();
  for (const face of faces) {
    const n = faceNormal(face.face);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < MIN_AREA) continue;
    const normal: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    const key = groupKey(face, normal);
    let entry = groups.get(key);
    if (!entry) {
      entry = { group: makeGroup(normal), color: face.color };
      groups.set(key, entry);
    }
    entry.group.polys.push(face.face);
  }

  const withLoops = [...groups.values()].map(({ group, color }) => ({ group, color, loops: boundaryLoops(group) }));

  // Un vértice sobra solo si es recto en todos los lazos donde aparece.
  const redundant = new Map<string, boolean>();
  for (const { loops } of withLoops) {
    for (const loop of loops) {
      loop.forEach((v, i) => {
        const straight = isStraight(loop[(i + loop.length - 1) % loop.length], v, loop[(i + 1) % loop.length]);
        redundant.set(v.key, (redundant.get(v.key) ?? true) && straight);
      });
    }
  }

  const result: SurfaceFace[] = [];
  for (const { group, color, loops } of withLoops) {
    const simplified = loops.map((loop) => loop.filter((v) => !redundant.get(v.key))).filter((loop) => loop.length >= 3);
    for (const face of triangulate(simplified, group)) result.push({ face, color });
  }
  return result;
}
