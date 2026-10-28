import { faceColorOf, faceNormal, type Piece, type Vec3 } from './piece';

export interface SurfaceFace {
  face: Vec3[];
  color: number;
}

interface HalfSpace {
  n: Vec3;
  d: number;
}

const EPS = 1e-7;
const MIN_AREA = 1e-9;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function unit(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Planos de las caras de un poliedro convexo; el interior queda donde n·p <= d. */
function planesOf(piece: Piece): HalfSpace[] {
  return piece.faces.map((face) => {
    const n = unit(faceNormal(face));
    return { n, d: dot(n, face[0]) };
  });
}

interface Box {
  min: Vec3;
  max: Vec3;
}

function boxOf(piece: Piece): Box {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const face of piece.faces) {
    for (const p of face) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
  }
  return { min, max };
}

/** Las cajas se tocan o se cruzan; basta para descartar piezas lejanas. */
function boxesTouch(a: Box, b: Box): boolean {
  for (let k = 0; k < 3; k++) {
    if (a.min[k] > b.max[k] + EPS || b.min[k] > a.max[k] + EPS) return false;
  }
  return true;
}

const GRID_CELL = 2;

/** Para cada pieza, las piezas cuyas cajas se tocan o cruzan. Una rejilla evita comparar todas con todas. */
function findNeighbors(boxes: Box[]): number[][] {
  const grid = new Map<string, number[]>();
  const cellRange = (box: Box): number[][] =>
    [0, 1, 2].map((k) => [Math.floor((box.min[k] - EPS) / GRID_CELL), Math.floor((box.max[k] + EPS) / GRID_CELL)]);

  boxes.forEach((box, i) => {
    const [rx, ry, rz] = cellRange(box);
    for (let x = rx[0]; x <= rx[1]; x++)
      for (let y = ry[0]; y <= ry[1]; y++)
        for (let z = rz[0]; z <= rz[1]; z++) {
          const key = `${x},${y},${z}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(i);
          else grid.set(key, [i]);
        }
  });

  return boxes.map((box, i) => {
    const found = new Set<number>();
    const [rx, ry, rz] = cellRange(box);
    for (let x = rx[0]; x <= rx[1]; x++)
      for (let y = ry[0]; y <= ry[1]; y++)
        for (let z = rz[0]; z <= rz[1]; z++) {
          for (const j of grid.get(`${x},${y},${z}`) ?? []) {
            if (j !== i && boxesTouch(box, boxes[j])) found.add(j);
          }
        }
    return [...found];
  });
}

/** Recorta un polígono convexo y conserva el lado exterior (n·p >= d) o el interior (n·p <= d). */
function clipPolygon(poly: Vec3[], plane: HalfSpace, keepOutside: boolean): Vec3[] {
  const sign = keepOutside ? -1 : 1;
  const s = (p: Vec3) => sign * (dot(plane.n, p) - plane.d);
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    const sc = s(cur);
    const sn = s(nxt);
    if (sc <= EPS) out.push(cur);
    if ((sc < -EPS && sn > EPS) || (sc > EPS && sn < -EPS)) {
      const t = sc / (sc - sn);
      out.push([cur[0] + (nxt[0] - cur[0]) * t, cur[1] + (nxt[1] - cur[1]) * t, cur[2] + (nxt[2] - cur[2]) * t]);
    }
  }
  return out;
}

function hasArea(poly: Vec3[]): boolean {
  if (poly.length < 3) return false;
  const n = faceNormal(poly);
  return Math.hypot(n[0], n[1], n[2]) / 2 > MIN_AREA;
}

/**
 * Parte del polígono que queda fuera del poliedro convexo `other`.
 * `faceNormal` es la normal exterior de la cara de origen. Cuando la cara coincide con un plano de
 * `other` en la misma dirección, la cara se conserva en una sola de las dos piezas (la de menor
 * índice); cuando se enfrentan en sentido contrario, es un contacto interior y se descarta.
 */
function subtract(poly: Vec3[], normal: Vec3, planes: HalfSpace[], otherIsEarlier: boolean): Vec3[][] {
  const outside: Vec3[][] = [];
  let current = poly;
  for (const plane of planes) {
    let anyOut = false;
    let anyIn = false;
    for (const p of current) {
      const s = dot(plane.n, p) - plane.d;
      if (s > EPS) anyOut = true;
      else if (s < -EPS) anyIn = true;
    }

    if (!anyOut && !anyIn) {
      const inside = dot(normal, plane.n) > 0 ? otherIsEarlier : true;
      if (inside) continue;
      outside.push(current);
      return outside;
    }
    if (!anyIn) {
      outside.push(current);
      return outside;
    }
    if (!anyOut) continue;

    const part = clipPolygon(current, plane, true);
    if (hasArea(part)) outside.push(part);
    current = clipPolygon(current, plane, false);
    if (!hasArea(current)) return outside;
  }
  // Lo que queda está dentro de `other` y no pertenece a la superficie.
  return outside;
}

/**
 * Superficie exterior de la unión de varias piezas convexas: a cada cara se le quitan las partes
 * que caen dentro de otras piezas o que son contacto entre dos piezas.
 */
export function unionSurface(pieces: Piece[]): SurfaceFace[] {
  const planes = pieces.map(planesOf);
  const boxes = pieces.map(boxOf);
  const neighbors = findNeighbors(boxes);
  const result: SurfaceFace[] = [];

  pieces.forEach((piece, i) => {
    piece.faces.forEach((face, faceIndex) => {
      const normal = unit(faceNormal(face));
      let parts: Vec3[][] = [face];
      for (const j of neighbors[i]) {
        if (parts.length === 0) break;
        parts = parts.flatMap((part) => subtract(part, normal, planes[j], j < i));
      }
      for (const part of parts) result.push({ face: part, color: faceColorOf(piece, faceIndex) });
    });
  });
  return result;
}
