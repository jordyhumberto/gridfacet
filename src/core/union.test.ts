import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { faceNormal } from './piece';
import { translatePiece } from './transform';
import { unionSurface } from './union';

const cube = (x = 0) => buildPiece(CATALOG[0], x, 0, 0, 0, 0xff0000);

const area = (faces: { face: number[][] }[]) =>
  faces.reduce((sum, { face }) => {
    const n = faceNormal(face as [number, number, number][]);
    return sum + Math.hypot(n[0], n[1], n[2]) / 2;
  }, 0);

describe('unionSurface', () => {
  it('una pieza sola conserva toda su superficie', () => {
    expect(area(unionSurface([cube()]))).toBeCloseTo(6);
  });

  it('dos cubos contiguos pierden las dos caras en contacto', () => {
    expect(area(unionSurface([cube(0), cube(1)]))).toBeCloseTo(10);
  });

  it('dos cubos solapados a media celda dan la superficie de una caja de 1.5 × 1 × 1', () => {
    expect(area(unionSurface([cube(0), translatePiece(cube(0), 0.5, 0, 0)]))).toBeCloseTo(8);
  });

  it('un cubo con una esquina metida en otro: 6 + 6 - 2 × 0.75', () => {
    expect(area(unionSurface([cube(0), translatePiece(cube(0), 0.5, 0.5, 0.5)]))).toBeCloseTo(10.5);
  });

  it('dos piezas idénticas superpuestas no duplican la superficie', () => {
    expect(area(unionSurface([cube(0), cube(0)]))).toBeCloseTo(6);
  });

  it('una rampa sobre un cubo oculta la cara de contacto', () => {
    const base = cube(0);
    const rampa = buildPiece(CATALOG[2], 0, 3, 0, 0, 0xff0000);
    // Cubo (6) + rampa (4.414...) - contacto (1 de cada una).
    const rampArea = 1 + 1 + 0.5 * 2 + Math.SQRT2;
    expect(area(unionSurface([base, rampa]))).toBeCloseTo(6 + rampArea - 2);
  });

  it('encuentra el contacto aunque las piezas estén a ambos lados de un borde de la rejilla', () => {
    expect(area(unionSurface([cube(-1), cube(0)]))).toBeCloseTo(10);
    expect(area(unionSurface([cube(1), cube(2)]))).toBeCloseTo(10);
    expect(area(unionSurface([cube(-3), cube(-2)]))).toBeCloseTo(10);
  });

  it('piezas lejanas no se tocan', () => {
    expect(area(unionSurface([cube(0), cube(10)]))).toBeCloseTo(12);
  });
});
