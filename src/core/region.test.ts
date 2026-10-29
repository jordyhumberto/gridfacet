import { describe, expect, it } from 'vitest';
import { buildPieces, CATALOG } from './catalog';
import { coplanarRegion } from './region';
import type { Piece, Vec3 } from './piece';

const cube = (cx: number, row: number, cz: number): Piece => buildPieces(CATALOG[0], cx, row * 3, cz, 0, 0xff0000)[0];
const faceFacing = (piece: Piece, axis: number, sign: number): Vec3[] =>
  piece.faces.find((f) => {
    const c = f.reduce((s, p) => s + p[axis], 0) / f.length;
    const all = piece.faces.flat().map((p) => p[axis]);
    return f.every((p) => Math.abs(p[axis] - c) < 1e-9) && Math.abs(c - (sign > 0 ? Math.max(...all) : Math.min(...all))) < 1e-9;
  })!;

/** Muro de 3 × 3 cubos en el plano z = 0..1 */
const wall = (): Piece[] => {
  const cubes: Piece[] = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) cubes.push(cube(x, y, 0));
  return cubes;
};

describe('cara completa conectada', () => {
  it('un muro de 3 × 3 cubos es una sola cara de 9', () => {
    const pieces = wall();
    const start = { piece: pieces[4], face: faceFacing(pieces[4], 2, 1) };
    expect(coplanarRegion(start, pieces)).toHaveLength(9);
  });

  it('desde cualquier cubo sale la misma cara', () => {
    const pieces = wall();
    const start = { piece: pieces[0], face: faceFacing(pieces[0], 2, 1) };
    expect(coplanarRegion(start, pieces)).toHaveLength(9);
  });

  it('un cubo adelantado no entra en la cara y su vecino tampoco se tapa', () => {
    const pieces = wall();
    const front = cube(1, 1, 1); // delante del cubo central
    pieces.push(front);
    const start = { piece: pieces[0], face: faceFacing(pieces[0], 2, 1) };
    const region = coplanarRegion(start, pieces);
    // La cara del cubo central está tapada por el adelantado: quedan 8
    expect(region).toHaveLength(8);
    expect(region.some((r) => r.piece.id === front.id)).toBe(false);
  });

  it('piezas con un hueco entre ellas no se conectan', () => {
    const pieces = [cube(0, 0, 0), cube(2, 0, 0)];
    const start = { piece: pieces[0], face: faceFacing(pieces[0], 2, 1) };
    expect(coplanarRegion(start, pieces)).toHaveLength(1);
  });

  it('piezas que solo se tocan por una esquina no se conectan', () => {
    const pieces = [cube(0, 0, 0), cube(1, 1, 0)];
    const start = { piece: pieces[0], face: faceFacing(pieces[0], 2, 1) };
    expect(coplanarRegion(start, pieces)).toHaveLength(1);
  });

  it('las caras de otro lado (la de atrás) no entran', () => {
    const pieces = wall();
    const start = { piece: pieces[4], face: faceFacing(pieces[4], 2, -1) };
    const region = coplanarRegion(start, pieces);
    expect(region).toHaveLength(9);
    expect(region.every((r) => r.face.every((p) => Math.abs(p[2]) < 1e-9))).toBe(true);
  });

  it('la cara de arriba de un solo cubo es solo esa', () => {
    const pieces = wall();
    const start = { piece: pieces[0], face: faceFacing(pieces[0], 1, 1) };
    // Los cubos de la fila 0 tienen encima otro cubo: la cara de arriba de la fila 2 es la que cuenta
    const top = pieces.find((p) => p.faces.flat().some((q) => Math.abs(q[1] - 3) < 1e-9) && p.faces.flat().every((q) => q[0] <= 1 + 1e-9))!;
    expect(coplanarRegion({ piece: top, face: faceFacing(top, 1, 1) }, pieces)).toHaveLength(3);
    expect(coplanarRegion(start, pieces)).toHaveLength(1);
  });
});
