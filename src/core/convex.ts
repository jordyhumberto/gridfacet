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

/** Área de un triángulo y hacia dónde mira respecto a la normal de su cara (negativo: está dado la vuelta y no se vería desde fuera). */
const triangleFacing = (a: Vec3, b: Vec3, c: Vec3, normal: Vec3): { area: number; facing: number } => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(...normal) || 1;
  return { area: 0.5 * Math.hypot(...cross), facing: (cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]) / length };
};

/** Lo que cuesta un triángulo dado la vuelta: más que cualquier área posible, para que solo salga si no hay otra forma de partir la cara. */
const FLIPPED_PENALTY = 1e6;

/** ¿Algún vértice se sale del plano de la cara? (una cara alabeada, con puntas o pliegues). */
function isWarped(face: Vec3[], normal: Vec3): boolean {
  const length = Math.hypot(...normal);
  if (length < 1e-12) return false;
  const centre = [0, 1, 2].map((k) => face.reduce((sum, p) => sum + p[k], 0) / face.length);
  return face.some((p) => Math.abs(((p[0] - centre[0]) * normal[0] + (p[1] - centre[1]) * normal[1] + (p[2] - centre[2]) * normal[2]) / length) > 1e-5);
}

/**
 * Triangulación de área total mínima de una cara (programación dinámica sobre su anillo), evitando los triángulos dados la vuelta (que dejarían un hueco
 * al verse desde fuera) siempre que haya otra forma de partirla. No depende de por qué vértice se empiece a contar,
 * así una cara alabeada sale igual de un lado que de su imagen en espejo: cada punta queda con su triángulo en vez de colgar de un abanico.
 */
function minimumAreaTriangles(face: Vec3[], normal: Vec3): [number, number, number][] {
  const n = face.length;
  const cost: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const split: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(-1));
  for (let span = 2; span < n; span++) {
    for (let i = 0; i + span < n; i++) {
      const j = i + span;
      cost[i][j] = Infinity;
      for (let k = i + 1; k < j; k++) {
        const { area, facing } = triangleFacing(face[i], face[k], face[j], normal);
        const total = cost[i][k] + cost[k][j] + area + (facing < -1e-9 ? FLIPPED_PENALTY : 0);
        if (total < cost[i][j] - 1e-9) {
          cost[i][j] = total;
          split[i][j] = k;
        }
      }
    }
  }
  const out: [number, number, number][] = [];
  const walk = (i: number, j: number): void => {
    if (j - i < 2) return;
    const k = split[i][j];
    out.push([i, k, j]);
    walk(i, k);
    walk(k, j);
  };
  walk(0, n - 1);
  return out;
}

/** Triángulos de una cara como índices de sus vértices; de área mínima si está alabeada, en abanico si es convexa y plana y por recorte de orejas si es plana y no convexa. */
export function triangulateFace(face: Vec3[]): [number, number, number][] {
  const count = face.length;
  if (count < 3) return [];
  if (count === 3) return [[0, 1, 2]];

  // Una cara alabeada no tiene un plano al que proyectarla sin errores (al subir una punta, el contorno proyectado puede dejar de ser convexo y el recorte
  // de orejas deja triángulos dados la vuelta): se parte por área mínima, sin triángulos invertidos si se puede evitar.
  if (count <= 16 && isWarped(face, faceNormal(face))) return minimumAreaTriangles(face, faceNormal(face));

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
