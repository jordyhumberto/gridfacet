import { convexHull } from './hull';
import { makePiece, type Piece, type Vec3 } from './piece';

export type ShapeKind = 'sphere' | 'cylinder' | 'cone' | 'capsule';

export const SHAPES: { kind: ShapeKind; name: string }[] = [
  { kind: 'sphere', name: 'Esfera' },
  { kind: 'cylinder', name: 'Cilindro / prisma' },
  { kind: 'cone', name: 'Cono / pirámide' },
  { kind: 'capsule', name: 'Cápsula' },
];

export const MIN_SIDES = 3;
export const MAX_SIDES = 20;

export interface ShapeSpec {
  kind: ShapeKind;
  /** Medidas de la caja que encierra la forma, en celdas: ancho (X), alto (Y) y fondo (Z). */
  size: Vec3;
  /** Lados de la sección: pocos dan un prisma o una pirámide, muchos una forma redonda. */
  sides: number;
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
export function shapePoints({ kind, size, sides }: ShapeSpec): Vec3[] {
  const n = Math.max(MIN_SIDES, Math.min(MAX_SIDES, Math.round(sides)));
  const [w, h, d] = size.map((v) => v / 2) as Vec3;
  switch (kind) {
    case 'sphere':
      return ellipsoidPoints(0, w, h, d, n, Math.max(3, Math.min(8, Math.round(n / 2))));
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

/** Pieza convexa de la forma, con el centro de su caja en `center`. */
export function buildShape(spec: ShapeSpec, center: Vec3, color: number): Piece | null {
  const faces = convexHull(shapePoints(spec).map((p): Vec3 => [p[0] + center[0], p[1] + center[1], p[2] + center[2]]));
  return faces ? makePiece(faces, color) : null;
}
