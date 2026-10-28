import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { extrudeFace, faceAt, unitNormal } from './extrude';
import { volume } from './piece';

const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);

describe('extrudeFace', () => {
  it('encuentra la cara tocada por su normal', () => {
    const top = faceAt(cube, [0.5, 1, 0.5], [0, 1, 0])!;
    expect(unitNormal(top)).toEqual([0, 1, 0]);
    expect(faceAt(cube, [0.5, 0.5, 0.5], [0, 1, 0])).toBeUndefined();
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
