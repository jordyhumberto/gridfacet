import { convexHull } from './hull';
import { clipPiece, makePiece, type Piece, type Plane, type Vec3 } from './piece';

export type ShapeKind = 'sphere' | 'cylinder' | 'cone' | 'capsule';

export const SHAPES: { kind: ShapeKind; name: string }[] = [
  { kind: 'sphere', name: 'Esfera' },
  { kind: 'cylinder', name: 'Cilindro / prisma' },
  { kind: 'cone', name: 'Cono / pirámide' },
  { kind: 'capsule', name: 'Cápsula' },
];

/** Cuánto de la esfera se conserva: entera o una sección con la cara plana del corte hacia abajo. */
export type SphereSection = 'full' | 'hemi' | 'cap' | 'wedge' | 'octant';

export const SECTIONS: { kind: SphereSection; name: string }[] = [
  { kind: 'full', name: 'Completa' },
  { kind: 'hemi', name: 'Hemisferio' },
  { kind: 'cap', name: 'Casquete' },
  { kind: 'wedge', name: 'Gajo' },
  { kind: 'octant', name: 'Octante' },
];

export const MIN_SIDES = 3;
export const MIN_RINGS = 2;
export const MAX_RINGS = 8;
export const MAX_SIDES = 20;

export interface ShapeSpec {
  kind: ShapeKind;
  /** Medidas de la caja que encierra la forma, en celdas: ancho (X), alto (Y) y fondo (Z). */
  size: Vec3;
  /** Lados de la sección: pocos dan un prisma o una pirámide, muchos una forma redonda. */
  sides: number;
  /** Solo esfera: anillos de arriba abajo; si falta, salen de los lados. */
  rings?: number;
  /** Solo esfera: sección que se conserva (por defecto, completa). */
  section?: SphereSection;
  /** Casquete: altura del corte como fracción del radio vertical, de −0,9 (casi entera) a 0,9 (solo la punta). */
  cut?: number;
  /** Gajo: ángulo de la cuña en grados (10 a 180, para que siga siendo convexa). */
  angle?: number;
  /** Giro de la forma sobre sí misma antes de colocarla, en grados alrededor de X, Y y Z. */
  turn?: Vec3;
}

const ring = (cx: number, y: number, cz: number, rx: number, rz: number, sides: number, phase = 0): Vec3[] =>
  Array.from({ length: sides }, (_, j): Vec3 => {
    const b = phase + (2 * Math.PI * j) / sides;
    return [cx + Math.cos(b) * rx, y, cz + Math.sin(b) * rz];
  });

/** Anillos de un elipsoide entre dos polos, con `stacks` divisiones de arriba abajo. */
function ellipsoidPoints(cy: number, rx: number, ry: number, rz: number, sides: number, stacks: number, includeTop = true, includeBottom = true): Vec3[] {
  const pts: Vec3[] = [];
  if (includeTop) pts.push([0, cy + ry, 0]);
  if (includeBottom) pts.push([0, cy - ry, 0]);
  for (let i = 1; i < stacks; i++) {
    const a = (Math.PI * i) / stacks;
    pts.push(...ring(0, cy + Math.cos(a) * ry, 0, rx * Math.sin(a), rz * Math.sin(a), sides));
  }
  return pts;
}

/** Puntos de la forma, centrada en el origen y ocupando exactamente su caja. */
export function shapePoints({ kind, size, sides, rings }: ShapeSpec): Vec3[] {
  const n = Math.max(MIN_SIDES, Math.min(MAX_SIDES, Math.round(sides)));
  const [w, h, d] = size.map((v) => v / 2) as Vec3;
  switch (kind) {
    case 'sphere':
      return ellipsoidPoints(0, w, h, d, n, rings === undefined ? Math.max(3, Math.min(8, Math.round(n / 2))) : Math.max(MIN_RINGS, Math.min(MAX_RINGS, Math.round(rings))));
    case 'cylinder':
      return [...ring(0, -h, 0, w, d, n), ...ring(0, h, 0, w, d, n)];
    case 'cone':
      return [...ring(0, -h, 0, w, d, n), [0, h, 0]];
    case 'capsule': {
      // Dos medias esferas unidas por un cuerpo recto; el radio sale del lado menor.
      const r = Math.min(w, d);
      const cap = Math.min(r, h);
      const stacks = Math.max(2, Math.min(5, Math.round(n / 3)));
      const top = ellipsoidPoints(h - cap, w, cap, d, n, stacks * 2).filter((p) => p[1] >= h - cap - 1e-9);
      const bottom = ellipsoidPoints(-(h - cap), w, cap, d, n, stacks * 2).filter((p) => p[1] <= -(h - cap) + 1e-9);
      return [...top, ...bottom];
    }
  }
}

/** Planos (conserva n·p <= d) que dejan solo la sección pedida de una esfera con la cúpula hacia +Y. */
function sectionPlanes({ section = 'full', cut = 0, angle = 90, size }: ShapeSpec): Plane[] {
  const planes: Plane[] = [];
  if (section === 'hemi' || section === 'octant') planes.push({ n: [0, -1, 0], d: 0 });
  if (section === 'cap') planes.push({ n: [0, -1, 0], d: -Math.max(-0.9, Math.min(0.9, cut)) * (size[1] / 2) });
  if (section === 'wedge' || section === 'octant') {
    const theta = ((section === 'octant' ? 90 : Math.max(10, Math.min(180, angle))) * Math.PI) / 180;
    planes.push({ n: [0, 0, -1], d: 0 }, { n: [-Math.sin(theta), 0, Math.cos(theta)], d: 0 });
  }
  return planes;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Giro en grados alrededor de X, luego Y, luego Z. */
function eulerTurn([ax, ay, az]: Vec3): (p: Vec3) => Vec3 {
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(rad(ax)), Math.cos(rad(ax)), Math.sin(rad(ay)), Math.cos(rad(ay)), Math.sin(rad(az)), Math.cos(rad(az))];
  return ([x, y, z]) => {
    [y, z] = [y * cx - z * sx, y * sx + z * cx];
    [x, z] = [x * cy + z * sy, -x * sy + z * cy];
    [x, y] = [x * cz - y * sz, x * sz + y * cz];
    return [x, y, z];
  };
}

/** Giro mínimo que lleva el eje +Y hacia `to` (Rodrigues); sirve para apoyar la cara plana de una sección sobre una superficie. */
export function tiltUpTo(to: Vec3): (p: Vec3) => Vec3 {
  const length = Math.hypot(to[0], to[1], to[2]) || 1;
  const n: Vec3 = [to[0] / length, to[1] / length, to[2] / length];
  if (n[1] > 1 - 1e-9) return (p) => p;
  if (n[1] < -1 + 1e-9) return ([x, y, z]) => [x, -y, -z];
  // eje = Y × n, ángulo con cos = n.y
  const axis: Vec3 = [n[2], 0, -n[0]];
  const sinA = Math.hypot(axis[0], axis[2]);
  const k: Vec3 = [axis[0] / sinA, 0, axis[2] / sinA];
  const cosA = n[1];
  return (p) => {
    const kxp: Vec3 = [k[1] * p[2] - k[2] * p[1], k[2] * p[0] - k[0] * p[2], k[0] * p[1] - k[1] * p[0]];
    const kdp = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
    return [p[0] * cosA + kxp[0] * sinA + k[0] * kdp * (1 - cosA), p[1] * cosA + kxp[1] * sinA + k[1] * kdp * (1 - cosA), p[2] * cosA + kxp[2] * sinA + k[2] * kdp * (1 - cosA)];
  };
}

/**
 * Pieza convexa de la forma, con el centro de su caja en `center`. Una sección de esfera se obtiene recortando la esfera
 * con planos, así que sigue siendo convexa y la cara del corte es plana. `up` (opcional) es hacia dónde mira la cúpula:
 * la cara plana queda del lado contrario, apoyada en la superficie.
 */
export function buildShape(spec: ShapeSpec, center: Vec3, color: number, up?: Vec3): Piece | null {
  const faces = convexHull(shapePoints(spec));
  if (!faces) return null;
  let piece: Piece | null = makePiece(faces, color);
  if (spec.kind === 'sphere') {
    for (const plane of sectionPlanes(spec)) {
      piece = piece && clipPiece(piece, plane);
    }
  }
  if (!piece) return null;
  const turn = spec.turn && spec.turn.some((v) => v !== 0) ? eulerTurn(spec.turn) : null;
  const tilt = up && spec.kind === 'sphere' ? tiltUpTo(up) : null;
  const move = (p: Vec3): Vec3 => (tilt ? tilt(turn ? turn(p) : p) : turn ? turn(p) : p);
  const moved = turn || tilt ? piece.faces.map((face) => face.map(move)) : piece.faces;
  const all = moved.flat();
  const mid = [0, 1, 2].map((i) => (Math.min(...all.map((p) => p[i])) + Math.max(...all.map((p) => p[i]))) / 2);
  const placed = moved.map((face) => face.map((p): Vec3 => [p[0] - mid[0] + center[0], p[1] - mid[1] + center[1], p[2] - mid[2] + center[2]]));
  return makePiece(placed, color, piece.faceColors);
}
