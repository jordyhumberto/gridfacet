/**
 * Genera `ejemplos/arbol.polygrid.json`: un árbol con ramas que se bifurcan, hecho con troncos cónicos y copas de esferas.
 * Se ejecuta con: npx vite-node scripts/arbol.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { convexHull } from '../src/core/hull';
import { makePiece, newGroupId, type Piece, type Vec3 } from '../src/core/piece';
import { serializeProject } from '../src/core/project';
import { shapePoints } from '../src/core/shapes';

const BARK = [0x6b4423, 0x7a4f2a, 0x5e3a1c];
const LEAVES = [0x3f9a3b, 0x4fae45, 0x2f8a46, 0x62b94a];

const pieces: Piece[] = [];
const trunk = newGroupId();
const branches = newGroupId();
const crown = newGroupId();

// Generador pseudoaleatorio con semilla: el árbol sale igual cada vez.
let seed = 7;
const random = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(...a));

function keep(points: Vec3[], color: number, group: number, name: string): void {
  const faces = convexHull(points);
  if (!faces) return;
  const piece = makePiece(faces, color);
  piece.group = group;
  piece.groupName = name;
  pieces.push(piece);
}

/** Tronco cónico entre dos puntos: dos anillos de radios distintos en planos perpendiculares a la dirección. */
function limb(from: Vec3, to: Vec3, r0: number, r1: number, color: number, group: number, name: string): void {
  const dir = unit([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  const helper: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(helper, dir));
  const v = cross(dir, u);
  const sides = 8;
  const ring = (center: Vec3, r: number): Vec3[] =>
    Array.from({ length: sides }, (_, j) => {
      const a = (2 * Math.PI * j) / sides;
      return add(center, add(scale(u, Math.cos(a) * r), scale(v, Math.sin(a) * r)));
    });
  keep([...ring(from, r0), ...ring(to, r1)], color, group, name);
}

function leaves(at: Vec3, radius: number): void {
  const color = LEAVES[Math.floor(random() * LEAVES.length)];
  const pts = shapePoints({ kind: 'sphere', size: [radius * 2, radius * 1.7, radius * 2], sides: 8 }).map((p): Vec3 => add(p, at));
  keep(pts, color, crown, 'Hojas');
}

/** Rama que se divide en `children` ramas más cortas y finas, abiertas hacia los lados y algo hacia arriba. */
function grow(from: Vec3, dir: Vec3, length: number, radius: number, depth: number): void {
  const to = add(from, scale(dir, length));
  const taper = radius * 0.68;
  limb(from, to, radius, taper, BARK[depth % BARK.length], depth === 0 ? trunk : branches, depth === 0 ? 'Tronco' : 'Ramas');
  if (depth >= 4 || radius < 0.035) {
    leaves(to, 0.3 + random() * 0.15);
    return;
  }
  // Dos o tres ramas hijas repartidas alrededor, con una inclinación que crece con el nivel.
  const count = depth === 0 ? 3 : 2 + (random() < 0.5 ? 1 : 0);
  const helper: Vec3 = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = unit(cross(helper, dir));
  const v = cross(dir, u);
  const phase = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const around = phase + (2 * Math.PI * i) / count + (random() - 0.5) * 0.5;
    const tilt = 0.45 + random() * 0.3 + depth * 0.05;
    const side = add(scale(u, Math.cos(around)), scale(v, Math.sin(around)));
    const next = unit(add(scale(dir, Math.cos(tilt)), scale(side, Math.sin(tilt))));
    // La gravedad curva un poco las ramas hacia arriba en vez de dejarlas caer.
    const lifted = unit([next[0], next[1] + 0.25, next[2]]);
    grow(to, lifted, length * (0.7 + random() * 0.1), taper, depth + 1);
  }
  // Un brote de hojas a media altura de las ramas gruesas da más volumen a la copa.
  if (depth >= 2 && random() < 0.6) leaves(add(from, scale(dir, length * 0.6)), 0.22);
}

grow([0, 0, 0], [0, 1, 0], 1.7, 0.22, 0);

mkdirSync('ejemplos', { recursive: true });
writeFileSync('ejemplos/arbol.polygrid.json', serializeProject(pieces, [], 24));
const count = (group: string) => pieces.filter((p) => p.groupName === group).length;
console.log(`ejemplos/arbol.polygrid.json: ${pieces.length} piezas (tronco ${count('Tronco')}, ramas ${count('Ramas')}, hojas ${count('Hojas')})`);
