import { convexHull } from './hull';
import { clipPiece, makePiece, type Piece, type Vec3 } from './piece';
import { tiltUpTo } from './shapes';
import { boundsOf } from './transform';

/** Una cara es una pendiente si no es vertical ni está alineada con un eje: se apoya algo encima sin que caiga a la rejilla. */
const FLAT = 0.999;
const STEEP = 0.05;

export type SlopeKind = 'seat' | 'perp';

/** Cómo colocar una pieza sobre una cara con la normal dada: null si no es una pendiente (cara recta o casi vertical). */
export function slopeKindOf(normal: Vec3, mode: SlopeKind | 'grid'): SlopeKind | null {
  const length = Math.hypot(...normal) || 1;
  const n = normal.map((v) => v / length);
  if (mode === 'grid' || Math.max(...n.map(Math.abs)) > FLAT || Math.abs(n[1]) <= STEEP) return null;
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
 * Apoya la pieza plana sobre la pendiente, apuntando hacia fuera de ella (en la dirección de la normal): el centro de su
 * base cae en `point`. Sirve para clavar algo en una superficie inclinada.
 */
export function standOnSlope(parts: Piece[], n: Vec3, point: Vec3): Piece[] {
  const box = boundsOf(parts);
  if (!box) return [];
  const base: Vec3 = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
  const tilt = tiltUpTo(n);
  return parts.map((part) =>
    makePiece(
      part.faces.map((face) =>
        face.map((p): Vec3 => {
          const r = tilt([p[0] - base[0], p[1] - base[1], p[2] - base[2]]);
          return [r[0] + point[0], r[1] + point[1], r[2] + point[2]];
        }),
      ),
      part.color,
      part.faceColors,
    ),
  );
}
