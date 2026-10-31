import { intersectionPointsWith } from './intersections';
import { faceNormal, type Piece, type Vec3 } from './piece';

export interface Edge {
  a: Vec3;
  b: Vec3;
}

export interface CandidateOptions {
  /** En cuántas partes iguales se divide cada arista (y el lado mayor de cada cara). */
  divisions: number;
  /** También una cuadrícula de puntos dentro de cada cara. */
  faces: boolean;
}

const EPS = 1e-6;
const MAX_POINTS = 8000;

const keyOf = (p: Vec3): string => p.map((v) => Math.round(v * 1e5)).join(',');

/** Aristas distintas de una pieza (cada una aparece en dos caras). */
export function uniqueEdges(piece: Piece): Edge[] {
  const seen = new Map<string, Edge>();
  for (const face of piece.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const [ka, kb] = [keyOf(a), keyOf(b)];
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (!seen.has(key)) seen.set(key, { a, b });
    }
  }
  return [...seen.values()];
}

function boxOf(piece: Piece): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of piece.faces) {
    for (const p of face) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
  }
  return { min, max };
}

function overlap(a: Piece, b: Piece): boolean {
  const [x, y] = [boxOf(a), boxOf(b)];
  return [0, 1, 2].every((i) => x.min[i] <= y.max[i] + EPS && y.min[i] <= x.max[i] + EPS);
}

/** Cuadrícula de puntos estrictamente dentro de una cara convexa, alineada con los ejes del suelo cuando es posible. */
function faceGrid(face: Vec3[], divisions: number): Vec3[] {
  const n = faceNormal(face);
  const length = Math.hypot(n[0], n[1], n[2]);
  if (length === 0) return [];
  const w: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
  const helper: Vec3 = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cu: Vec3 = [helper[1] * w[2] - helper[2] * w[1], helper[2] * w[0] - helper[0] * w[2], helper[0] * w[1] - helper[1] * w[0]];
  const lu = Math.hypot(cu[0], cu[1], cu[2]);
  const u: Vec3 = [cu[0] / lu, cu[1] / lu, cu[2] / lu];
  const v: Vec3 = [w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0]];
  const origin = face[0];
  const flat = face.map((p) => {
    const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
    return [d[0] * u[0] + d[1] * u[1] + d[2] * u[2], d[0] * v[0] + d[1] * v[1] + d[2] * v[2]] as [number, number];
  });
  const us = flat.map((p) => p[0]);
  const vs = flat.map((p) => p[1]);
  const [minU, maxU, minV, maxV] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const step = Math.max(maxU - minU, maxV - minV) / divisions;
  if (!(step > EPS)) return [];

  const points: Vec3[] = [];
  for (let x = minU + step; x < maxU - EPS; x += step) {
    for (let y = minV + step; y < maxV - EPS; y += step) {
      let inside = true;
      for (let i = 0; i < flat.length && inside; i++) {
        const a = flat[i];
        const b = flat[(i + 1) % flat.length];
        const edgeLength = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Antihorario: el punto debe quedar a la izquierda de cada arista, con un pequeño margen.
        if (((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / edgeLength < EPS * 10) inside = false;
      }
      if (inside) points.push([origin[0] + u[0] * x + v[0] * y, origin[1] + u[1] * x + v[1] * y, origin[2] + u[2] * x + v[2] * y]);
    }
  }
  return points;
}

/**
 * Posiciones válidas para añadir un vértice a las piezas elegidas: subdivisiones de sus aristas, una cuadrícula opcional
 * en sus caras y los puntos donde cruzan a otras piezas. Los extremos de las aristas no se incluyen (ya son vértices).
 */
export function candidatePoints(targets: Piece[], all: Piece[], options: CandidateOptions): { points: Vec3[]; edges: Edge[] } {
  const found = new Map<string, Vec3>();
  const edges: Edge[] = [];
  const add = (p: Vec3) => {
    if (found.size < MAX_POINTS) found.set(keyOf(p), p);
  };

  for (const piece of targets) {
    for (const edge of uniqueEdges(piece)) {
      edges.push(edge);
      for (let k = 1; k < options.divisions; k++) {
        const t = k / options.divisions;
        add([edge.a[0] + (edge.b[0] - edge.a[0]) * t, edge.a[1] + (edge.b[1] - edge.a[1]) * t, edge.a[2] + (edge.b[2] - edge.a[2]) * t]);
      }
      // Una arista acortada por un corte ya no se divide en las mismas partes que antes: además se ofrecen puntos a pasos fijos
      // (1 / divisiones de celda) medidos desde cada extremo, para poder repetir la misma distancia en el otro lado.
      const length = Math.hypot(edge.b[0] - edge.a[0], edge.b[1] - edge.a[1], edge.b[2] - edge.a[2]);
      const step = 1 / options.divisions;
      if (options.divisions >= 2 && length > step + EPS) {
        for (let d = step; d < length - EPS; d += step) {
          for (const [from, to] of [[edge.a, edge.b], [edge.b, edge.a]] as const) {
            const t = d / length;
            add([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
          }
        }
      }
    }
    if (options.faces) for (const face of piece.faces) for (const p of faceGrid(face, options.divisions)) add(p);
    const others = all.filter((other) => other !== piece && overlap(piece, other));
    if (others.length > 0) for (const p of intersectionPointsWith(piece, others)) add(p);
  }
  return { points: [...found.values()], edges };
}
