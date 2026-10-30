import { extrudeFace } from './extrude';
import { faceColorOf, faceNormal, type Piece, type Vec3 } from './piece';
import type { FaceOf } from './region';

/** Cuánto se separan de un plano los puntos marcados y lo siguen considerando "el mismo plano" (celdas). */
const PLANE_TOLERANCE = 1e-3;
const MIN_AREA = 1e-8;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

/** Normal (sin normalizar, con la magnitud del doble del área) del polígono por el método de Newell. */
function newell(points: Vec3[]): Vec3 {
  const n: Vec3 = [0, 0, 0];
  for (let i = 0; i < points.length; i++) {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** Una figura marcada sobre una superficie: su plano, hacia dónde mira la superficie y las caras (convexas) que la forman. */
export interface Outline {
  /** Normal hacia fuera de la superficie sobre la que se marcó. */
  normal: Vec3;
  /** Caras convexas orientadas hacia fuera: una sola si la figura es convexa; si no, triángulos. */
  faces: FaceOf[];
  /** Color de la cara de la superficie, para lo que crece. */
  color: number;
}

/** Quita los puntos repetidos seguidos (y el último si repite el primero). */
function dedupe(points: Vec3[]): Vec3[] {
  const close = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6;
  const list = points.filter((p, i) => i === 0 || !close(p, points[i - 1]));
  while (list.length > 1 && close(list[0], list[list.length - 1])) list.pop();
  return list;
}

/**
 * Prepara la figura marcada: comprueba que los puntos son coplanares, busca la superficie (una cara de alguna pieza en ese
 * plano que contenga la figura) para saber hacia dónde es "fuera", y la divide en caras convexas.
 */
export function prepareOutline(marked: Vec3[], pieces: Piece[]): Outline | { error: string } {
  const points = dedupe(marked);
  if (points.length < 3) return { error: 'Marca al menos 3 puntos para formar la figura' };
  const raw = newell(points);
  const area = Math.hypot(raw[0], raw[1], raw[2]) / 2;
  if (area < MIN_AREA) {
    return { error: isStraight(points) ? 'Los puntos están en línea: no forman una figura' : 'La figura se cruza: marca los puntos en orden, rodeándola' };
  }
  const m = unit(raw);
  if (points.some((p) => Math.abs(dot(m, sub(p, points[0]))) > PLANE_TOLERANCE)) {
    return { error: 'Los puntos tienen que estar en un mismo plano (sobre una sola cara)' };
  }

  // La superficie: una cara coplanar que contiene el centro de la figura.
  const center: Vec3 = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) center[i] += p[i] / points.length;
  let host: { piece: Piece; face: Vec3[]; n: Vec3 } | null = null;
  for (const piece of pieces) {
    for (const face of piece.faces) {
      const n = unit(faceNormal(face));
      if (Math.abs(dot(n, m)) < 1 - 1e-6 || Math.abs(dot(n, sub(center, face[0]))) > PLANE_TOLERANCE) continue;
      if (containsPoint(face, n, center)) {
        host = { piece, face, n };
        break;
      }
    }
    if (host) break;
  }
  if (!host) return { error: 'Marca la figura sobre una cara de alguna pieza' };

  if (crosses(points, unit(raw))) return { error: 'La figura se cruza: marca los puntos en orden, rodeándola' };

  // Antihoraria vista desde fuera, para que las caras miren hacia fuera.
  const ordered = dot(raw, host.n) >= 0 ? points : [...points].reverse();
  const color = faceColorOf(host.piece, host.piece.faces.indexOf(host.face));
  const make = (face: Vec3[]): FaceOf => ({ piece: host!.piece, face });
  const polygons = isConvex(ordered, host.n) ? [ordered] : triangulate(ordered, host.n);
  if (polygons.length === 0) return { error: 'No pude dividir la figura: revisa que los puntos no se crucen' };
  return { normal: host.n, faces: polygons.map(make), color };
}

/** ¿Todos los puntos caen sobre una misma recta? */
function isStraight(points: Vec3[]): boolean {
  const d = sub(points[points.length - 1], points[0]);
  return points.every((p) => Math.hypot(...cross(d, sub(p, points[0]))) < 1e-6 * (Math.hypot(...d) || 1));
}

/** ¿Algún lado del polígono corta a otro que no es contiguo? */
function crosses(points: Vec3[], n: Vec3): boolean {
  const count = points.length;
  const side = (a: Vec3, b: Vec3, p: Vec3) => dot(cross(sub(b, a), sub(p, a)), n);
  for (let i = 0; i < count; i++) {
    for (let j = i + 2; j < count; j++) {
      if (i === 0 && j === count - 1) continue;
      const [a, b, c, d] = [points[i], points[(i + 1) % count], points[j], points[(j + 1) % count]];
      if (side(a, b, c) * side(a, b, d) < -1e-12 && side(c, d, a) * side(c, d, b) < -1e-12) return true;
    }
  }
  return false;
}

function containsPoint(face: Vec3[], n: Vec3, p: Vec3): boolean {
  return face.every((a, i) => {
    const b = face[(i + 1) % face.length];
    return dot(cross(sub(b, a), sub(p, a)), n) >= -1e-6;
  });
}

function isConvex(points: Vec3[], n: Vec3): boolean {
  return points.every((a, i) => {
    const [b, c] = [points[(i + 1) % points.length], points[(i + 2) % points.length]];
    return dot(cross(sub(b, a), sub(c, b)), n) >= -1e-9;
  });
}

/** Triángulos de un polígono (antihorario respecto a `n`) por recorte de orejas; vacío si se cruza consigo mismo. */
function triangulate(points: Vec3[], n: Vec3): Vec3[][] {
  const ids = points.map((_, i) => i);
  const triangles: Vec3[][] = [];
  const turn = (a: Vec3, b: Vec3, c: Vec3) => dot(cross(sub(b, a), sub(c, b)), n);
  let guard = points.length * points.length;
  while (ids.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < ids.length; k++) {
      const [ia, ib, ic] = [ids[(k + ids.length - 1) % ids.length], ids[k], ids[(k + 1) % ids.length]];
      const [a, b, c] = [points[ia], points[ib], points[ic]];
      if (turn(a, b, c) <= 1e-12) continue;
      const blocked = ids.some((i) => i !== ia && i !== ib && i !== ic && containsTriangle(a, b, c, points[i], n));
      if (blocked) continue;
      triangles.push([a, b, c]);
      ids.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  if (ids.length === 3) triangles.push(ids.map((i) => points[i]));
  return triangles;
}

function containsTriangle(a: Vec3, b: Vec3, c: Vec3, p: Vec3, n: Vec3): boolean {
  const side = (u: Vec3, v: Vec3) => dot(cross(sub(v, u), sub(p, u)), n);
  return side(a, b) > 1e-12 && side(b, c) > 1e-12 && side(c, a) > 1e-12;
}

/** Los cuerpos que salen de la figura al hacerla crecer `distance` hacia fuera. */
export function growOutline(outline: Outline, distance: number): Piece[] {
  if (!(distance > 0)) return [];
  return outline.faces.map(({ face }) => extrudeFace(face, outline.color, distance));
}
