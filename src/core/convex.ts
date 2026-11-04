import { faceNormal, type Piece, type Vec3 } from './piece';

/** Cuánto puede salirse un vértice de un plano de cara (en celdas) y seguir contando como convexo. */
const TOLERANCE = 1e-6;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cache = new WeakMap<Piece, boolean>();

/**
 * ¿Es la pieza un poliedro convexo con caras planas? Las operaciones de corte, resta, unión y chaflán solo valen para esas;
 * las demás son "mallas libres" (vértices movidos, huecos, caras torcidas) y solo admiten mover, extruir, pintar y exportar.
 */
export function isConvex(piece: Piece): boolean {
  const known = cache.get(piece);
  if (known !== undefined) return known;
  const result = computeConvex(piece);
  cache.set(piece, result);
  return result;
}

function computeConvex(piece: Piece): boolean {
  const points = piece.faces.flat();
  for (const face of piece.faces) {
    const n = faceNormal(face);
    const length = Math.hypot(n[0], n[1], n[2]);
    if (length < 1e-12) return false;
    const unit: Vec3 = [n[0] / length, n[1] / length, n[2] / length];
    const d = dot(unit, face[0]);
    // Una cara convexa y plana deja todos los vértices de la pieza a un solo lado (o sobre su plano).
    for (const p of points) if (dot(unit, p) - d > TOLERANCE) return false;
  }
  return true;
}

/** Piezas convexas de la lista y cuántas se dejaron fuera por ser mallas libres. */
export function splitConvex(pieces: Piece[]): { convex: Piece[]; free: Piece[] } {
  const convex: Piece[] = [];
  const free: Piece[] = [];
  for (const piece of pieces) (isConvex(piece) ? convex : free).push(piece);
  return { convex, free };
}

/** Triángulos de una cara como índices de sus vértices; en abanico si es convexa y por recorte de orejas si no. */
export function triangulateFace(face: Vec3[]): [number, number, number][] {
  const count = face.length;
  if (count < 3) return [];
  if (count === 3) return [[0, 1, 2]];

  // Se proyecta al plano de la cara dejando fuera el eje en el que la normal pesa más.
  const n = faceNormal(face);
  const axis = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const [u, v] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
  const sign = n[axis] >= 0 ? 1 : -1;
  const flat = face.map((p) => [p[u], p[v]] as [number, number]);
  const turn = (a: number, b: number, c: number): number =>
    sign * ((flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]));

  const ring = face.map((_, i) => i);
  const isConvexRing = ring.every((i) => turn(ring[(i + count - 1) % count], i, ring[(i + 1) % count]) >= -1e-12);
  if (isConvexRing) return Array.from({ length: count - 2 }, (_, i) => [0, i + 1, i + 2] as [number, number, number]);

  const inside = (p: number, a: number, b: number, c: number): boolean =>
    turn(a, b, p) >= -1e-12 && turn(b, c, p) >= -1e-12 && turn(c, a, p) >= -1e-12;
  const triangles: [number, number, number][] = [];
  let guard = count * count;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < ring.length; k++) {
      const a = ring[(k + ring.length - 1) % ring.length];
      const b = ring[k];
      const c = ring[(k + 1) % ring.length];
      if (turn(a, b, c) <= 1e-12) continue;
      if (ring.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      triangles.push([a, b, c]);
      ring.splice(k, 1);
      clipped = true;
      break;
    }
    // Un polígono degenerado o que se cruza no tiene orejas: se termina en abanico para no perder la cara.
    if (!clipped) break;
  }
  for (let i = 1; i < ring.length - 1; i++) triangles.push([ring[0], ring[i], ring[i + 1]]);
  return triangles;
}
