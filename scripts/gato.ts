/**
 * Genera el proyecto de ejemplo `ejemplos/gato.gridfacet.json`: un gato sentado hecho con formas convexas.
 * Se ejecuta con: npx vite-node scripts/gato.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { convexHull } from '../src/core/hull';
import { makePiece, newGroupId, type Piece, type Vec3 } from '../src/core/piece';
import { serializeProject } from '../src/core/project';
import { shapePoints, type ShapeKind } from '../src/core/shapes';

const ORANGE = 0xe08a3c;
const DARK = 0xa85a1c;
const WHITE = 0xf6efe4;
const PINK = 0xe8929a;
const GREEN = 0x7ad86a;
const BLACK = 0x15161a;
const INNER = 0xf0a6ad;

const pieces: Piece[] = [];

/** Pieza convexa que une los puntos, dentro de un grupo con nombre. */
function hull(points: Vec3[], color: number, group: number, name: string): void {
  const faces = convexHull(points);
  if (!faces) throw new Error(`Casco inválido en ${name}`);
  const piece = makePiece(faces, color);
  piece.group = group;
  piece.groupName = name;
  pieces.push(piece);
}

/** Puntos de una forma de caja de ancho w, alto h y fondo d, con el centro en (cx, cy, cz). */
function shape(kind: ShapeKind, cx: number, cy: number, cz: number, w: number, h: number, d: number, sides = 12): Vec3[] {
  return shapePoints({ kind, size: [w, h, d], sides }).map((p): Vec3 => [p[0] + cx, p[1] + cy, p[2] + cz]);
}

const body = newGroupId();
const head = newGroupId();
const legs = newGroupId();
const tail = newGroupId();

// Cuerpo
hull(shape('sphere', 0, 0.95, -0.15, 1.24, 1.9, 1.4), ORANGE, body, 'Cuerpo');
hull(shape('sphere', 0, 0.9, 0.42, 0.72, 1.5, 0.56, 10), WHITE, body, 'Cuerpo');
for (const s of [-1, 1]) {
  hull(shape('sphere', s * 0.55, 0.45, -0.4, 0.68, 0.9, 1.1, 10), ORANGE, legs, 'Patas');
  hull(shape('sphere', s * 0.3, 0.55, 0.55, 0.3, 1.1, 0.3, 8), ORANGE, legs, 'Patas');
  hull(shape('sphere', s * 0.3, 0.08, 0.68, 0.4, 0.2, 0.56, 8), WHITE, legs, 'Patas');
  hull(shape('sphere', s * 0.55, 0.07, 0.2, 0.4, 0.2, 0.68, 8), WHITE, legs, 'Patas');
}

// Cabeza
hull(shape('sphere', 0, 2.2, 0.38, 1.04, 0.9, 0.92), ORANGE, head, 'Cabeza');
for (const s of [-1, 1]) {
  hull(shape('sphere', s * 0.46, 2.08, 0.5, 0.32, 0.36, 0.56, 8), ORANGE, head, 'Cabeza');
  hull([[s * 0.45, 2.5, 0.3], [s * 0.12, 2.5, 0.3], [s * 0.12, 2.5, 0.62], [s * 0.45, 2.5, 0.62], [s * 0.48, 3.0, 0.45]], ORANGE, head, 'Cabeza');
  hull([[s * 0.4, 2.5, 0.64], [s * 0.17, 2.5, 0.64], [s * 0.39, 2.88, 0.54], [s * 0.4, 2.5, 0.7], [s * 0.17, 2.5, 0.7]], INNER, head, 'Cabeza');
  hull(shape('sphere', s * 0.2, 2.28, 0.8, 0.2, 0.14, 0.08, 8), GREEN, head, 'Cabeza');
  hull(shape('sphere', s * 0.2, 2.28, 0.83, 0.06, 0.14, 0.04, 6), BLACK, head, 'Cabeza');
}
hull(shape('sphere', 0, 2.05, 0.8, 0.48, 0.28, 0.4, 10), WHITE, head, 'Cabeza');
hull(shape('sphere', 0, 2.15, 0.98, 0.14, 0.1, 0.08, 8), PINK, head, 'Cabeza');

// Cola curva alrededor del cuerpo: cada tramo es el casco de dos esferas consecutivas
const N = 9;
let previous: Vec3[] | null = null;
for (let i = 0; i <= N; i++) {
  const a = Math.PI * 0.15 + i * ((Math.PI * 0.9) / N);
  const r = (0.12 - 0.004 * i) * 2;
  const segment = shape('sphere', -0.85 * Math.cos(a) - 0.1, 0.12 + i * 0.02, -0.4 - 0.85 * Math.sin(a), r, r, r, 8);
  if (previous) hull([...previous, ...segment], i >= N - 1 ? BLACK : i % 3 === 0 ? DARK : ORANGE, tail, 'Cola');
  previous = segment;
}

mkdirSync('ejemplos', { recursive: true });
writeFileSync('ejemplos/gato.gridfacet.json', serializeProject(pieces, [], 24));
console.log(`ejemplos/gato.gridfacet.json: ${pieces.length} piezas, ${pieces.reduce((s, p) => s + p.faces.length, 0)} caras`);
