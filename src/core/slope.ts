import { convexHull } from './hull';
import { clipPiece, makePiece, type Piece, type Vec3 } from './piece';
import { tiltUpTo } from './shapes';
import { boundsOf } from './transform';

/** Una cara es una pendiente si no está alineada con un eje: se apoya algo encima sin que caiga a la rejilla. Si además es casi vertical es una pared oblicua. */
const FLAT = 0.999;
const STEEP = 0.05;

export type SlopeKind = 'seat' | 'perp' | 'wall';

/** Cómo colocar una pieza sobre una cara con la normal dada: null si no es una pendiente (cara recta o casi vertical). */
export function slopeKindOf(normal: Vec3, mode: SlopeKind | 'grid'): SlopeKind | null {
  const length = Math.hypot(...normal) || 1;
  const n = normal.map((v) => v / length);
  if (mode === 'grid' || Math.max(...n.map(Math.abs)) > FLAT) return null;
  // Una pared que no sigue los ejes: la pieza se apoya de pie contra ella, girada para quedar a ras.
  if (Math.abs(n[1]) <= STEEP) return 'wall';
  // Asentada necesita que la cara mire hacia arriba; por debajo solo cabe apoyarla perpendicular.
  return mode === 'seat' && n[1] > 0 ? 'seat' : 'perp';
}

/** Altura del plano que pasa por `point` con normal `n` en (x, z). */
export function planeHeight(n: Vec3, point: Vec3, x: number, z: number): number {
  return point[1] - (n[0] * (x - point[0]) + n[2] * (z - point[2])) / n[1];
}

const translate = (piece: Piece, d: Vec3): Piece =>
  makePiece(piece.faces.map((face) => face.map((p): Vec3 => [p[0] + d[0], p[1] + d[1], p[2] + d[2]])), piece.color, piece.faceColors);

/**
 * Asienta la pieza sobre una pendiente: queda vertical, con el centro de su huella en `center` (x, z), y su base se corta
 * con el plano de la cara, así encaja sin hueco. Se apoya primero en el punto más alto de la pendiente bajo su huella y se
 * "barre" hacia abajo hasta el más bajo antes de recortar, de modo que los lados llegan siempre hasta la superficie.
 * Sigue siendo convexa: el barrido de una pieza convexa a lo largo de una recta lo es, y el recorte también.
 */
export function seatOnSlope(parts: Piece[], n: Vec3, point: Vec3, center: [number, number]): Piece[] {
  const box = boundsOf(parts);
  if (!box || n[1] <= 0) return [];
  const heights = [box.min[0], box.max[0]].flatMap((x) => [box.min[2], box.max[2]].map((z) => planeHeight(n, point, x - (box.min[0] + box.max[0]) / 2 + center[0], z - (box.min[2] + box.max[2]) / 2 + center[1])));
  const [lo, hi] = [Math.min(...heights), Math.max(...heights)];
  const move: Vec3 = [center[0] - (box.min[0] + box.max[0]) / 2, hi - box.min[1], center[1] - (box.min[2] + box.max[2]) / 2];
  const drop = hi - lo;
  const plane = { n: [-n[0], -n[1], -n[2]] as Vec3, d: -(n[0] * point[0] + n[1] * point[1] + n[2] * point[2]) };
  const result: Piece[] = [];
  for (const part of parts) {
    const moved = translate(part, move);
    let solid: Piece | null = moved;
    if (drop > 1e-6) {
      const points = moved.faces.flat();
      const faces = convexHull([...points, ...points.map((p): Vec3 => [p[0], p[1] - drop, p[2]])]);
      solid = faces ? makePiece(faces, part.color) : null;
    }
    const cut = solid && clipPiece(solid, plane);
    if (cut) result.push(cut);
  }
  return result;
}

/**
 * Apoya la pieza de pie contra una pared vertical con la normal horizontal `n`: su cara de atrás (la de menor z) queda a ras de la pared,
 * girada alrededor de Y para seguirla. `anchor` es el centro de esa cara a la altura de la base.
 */
export function leanOnWall(parts: Piece[], n: Vec3, anchor: Vec3): Piece[] {
  const box = boundsOf(parts);
  if (!box) return [];
  const angle = Math.atan2(n[0], n[2]);
  const [sin, cos] = [Math.sin(angle), Math.cos(angle)];
  const mid = (box.min[0] + box.max[0]) / 2;
  const map = (p: Vec3): Vec3 => {
    const [u, w] = [p[0] - mid, p[2] - box.min[2]];
    return [anchor[0] + cos * u + sin * w, anchor[1] + p[1] - box.min[1], anchor[2] - sin * u + cos * w];
  };
  return parts.map((part) => makePiece(part.faces.map((face) => face.map(map)), part.color, part.faceColors));
}

/**
 * Apoya la pieza plana sobre la pendiente, apuntando hacia fuera de ella (en la dirección de la normal): el centro de su
 * base cae en `point`. Sirve para clavar algo en una superficie inclinada.
 */
export function standOnSlope(parts: Piece[], n: Vec3, point: Vec3, spin = 0): Piece[] {
  const box = boundsOf(parts);
  if (!box) return [];
  const base: Vec3 = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
  const orient = orientation(n, spin);
  return parts.map((part) =>
    makePiece(
      part.faces.map((face) =>
        face.map((p): Vec3 => {
          const r = orient([p[0] - base[0], p[1] - base[1], p[2] - base[2]]);
          return [r[0] + point[0], r[1] + point[1], r[2] + point[2]];
        }),
      ),
      part.color,
      part.faceColors,
    ),
  );
}

const unitOf = (v: Vec3): Vec3 => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};
const crossOf = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotOf = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** El giro de `standOnSlope`: lleva +Y hacia la normal y después gira `spin` radianes alrededor de ella. */
function orientation(normal: Vec3, spin: number): (p: Vec3) => Vec3 {
  const n = unitOf(normal);
  const tilt = tiltUpTo(n);
  if (Math.abs(spin) < 1e-9) return tilt;
  const [cos, sin] = [Math.cos(spin), Math.sin(spin)];
  return (p) => {
    const r = tilt(p);
    const nxr = crossOf(n, r);
    const along = dotOf(n, r) * (1 - cos);
    return [r[0] * cos + nxr[0] * sin + n[0] * along, r[1] * cos + nxr[1] * sin + n[1] * along, r[2] * cos + nxr[2] * sin + n[2] * along];
  };
}

/** Los dos ejes de la pieza (sus lados X y Z) apoyada sobre una cara con la normal dada y girada `spin`; es el marco con el que se alinea. */
export function slopeAxes(n: Vec3, spin = 0): [Vec3, Vec3] {
  const orient = orientation(n, spin);
  return [orient([1, 0, 0]), orient([0, 0, 1])];
}

/**
 * Giro (radianes) con el que una pieza apoyada en esa cara queda con sus lados paralelos a los de la cara: se toma la arista
 * más larga y se resuelve módulo 90°, así un cuadrado no tiene "delante". Con la cara de una rampa recta es 0.
 */
export function faceSpin(n: Vec3, face: Vec3[]): number {
  const [ax, az] = slopeAxes(n);
  let best = 0;
  let longest = 1e-6;
  face.forEach((p, i) => {
    const q = face[(i + 1) % face.length];
    const edge: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const length = Math.hypot(...edge);
    if (length <= longest + 1e-9) return;
    longest = length;
    // Giro positivo alrededor de la normal lleva X hacia −Z, así que alinear X con la arista pide el ángulo opuesto.
    best = -Math.atan2(dotOf(edge, az), dotOf(edge, ax));
  });
  const quarter = Math.PI / 2;
  let spin = best - Math.round(best / quarter) * quarter;
  if (Math.abs(spin) < 1e-6) spin = 0;
  return spin;
}
