import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { extrudeFace, faceAt, unitNormal } from './extrude';
import { makePiece, volume, type Vec3 } from './piece';

const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);

describe('extrudeFace', () => {
  it('encuentra la cara tocada por su normal', () => {
    const top = faceAt(cube, [0.5, 1, 0.5], [0, 1, 0])!;
    expect(unitNormal(top)).toEqual([0, 1, 0]);
    expect(faceAt(cube, [0.5, 0.5, 0.5], [0, 1, 0])).toBeUndefined();
  });

  it('con varias caras en el mismo plano elige la que tiene el punto dentro, no la primera de la lista', () => {
    // Un cuadrado (arriba, mirando a +Y) partido en dos triángulos por su diagonal.
    const a: Vec3 = [0, 1, 0];
    const b: Vec3 = [1, 1, 0];
    const c: Vec3 = [1, 1, 1];
    const d: Vec3 = [0, 1, 1];
    const first: Vec3[] = [a, d, c];
    const second: Vec3[] = [a, c, b];
    expect(unitNormal(first)[1]).toBeGreaterThan(0.99);
    expect(unitNormal(second)[1]).toBeGreaterThan(0.99);
    const piece = makePiece([first, second], 0xff0000);
    // (0.2, 1, 0.8) cae en el triángulo a-d-c y (0.8, 1, 0.2) en a-c-b.
    expect(faceAt(piece, [0.2, 1, 0.8], [0, 1, 0])).toBe(first);
    expect(faceAt(piece, [0.8, 1, 0.2], [0, 1, 0])).toBe(second);
    // Con las caras en el orden contrario sigue eligiendo la del punto.
    const swapped = makePiece([second, first], 0xff0000);
    expect(faceAt(swapped, [0.2, 1, 0.8], [0, 1, 0])).toBe(first);
  });

  it('hacer crecer la cara superior un cubo da una caja del doble de alto', () => {
    const top = faceAt(cube, [0.5, 1, 0.5], [0, 1, 0])!;
    const grown = extrudeFace(top, 0xff0000, 1);
    expect(volume(grown)).toBeCloseTo(1);
    expect(grown.faces).toHaveLength(6);
    const ys = grown.faces.flat().map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(1);
    expect(Math.max(...ys)).toBeCloseTo(2);
  });

  it('las normales de la caja resultante miran hacia fuera', () => {
    const side = faceAt(cube, [1, 0.5, 0.5], [1, 0, 0])!;
    const grown = extrudeFace(side, 0, 0.5);
    expect(volume(grown)).toBeCloseTo(0.5);
  });
});
