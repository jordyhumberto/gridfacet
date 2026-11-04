import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { collapses } from './selfIntersect';
import { makePiece, type Vec3 } from './piece';

/** Cubo de lado 1 con las caras de arriba y de abajo en zigzag, como en una figura estirada con malla libre. */
function crown(low: number, topMid: number, corner: number) {
  const f: Vec3[][] = [
    [[-0.5, corner, -0.5], [0, low, -0.75], [0.5, corner, -0.5], [0.75, low, 0], [0.5, corner, 0.5], [0, low, 0.75], [-0.5, corner, 0.5], [-0.75, low, 0]],
    [[-0.5, 1, -0.5], [-0.5, topMid, 0], [-0.5, 1, 0.5], [0, topMid, 0.5], [0.5, 1, 0.5], [0.5, topMid, 0], [0.5, 1, -0.5], [0, topMid, -0.5]],
    [[-0.5, corner, -0.5], [-0.5, 1, -0.5], [0, topMid, -0.5], [0.5, 1, -0.5], [0.5, corner, -0.5], [0, low, -0.75]],
    [[-0.5, corner, 0.5], [0, low, 0.75], [0.5, corner, 0.5], [0.5, 1, 0.5], [0, topMid, 0.5], [-0.5, 1, 0.5]],
    [[-0.5, corner, -0.5], [-0.75, low, 0], [-0.5, corner, 0.5], [-0.5, 1, 0.5], [-0.5, topMid, 0], [-0.5, 1, -0.5]],
    [[0.5, corner, -0.5], [0.5, 1, -0.5], [0.5, topMid, 0], [0.5, 1, 0.5], [0.5, corner, 0.5], [0.75, low, 0]],
  ];
  return makePiece(f, 0xff0000);
}

describe('collapses', () => {
  it('las piezas del catálogo no se atraviesan', () => {
    for (const entry of CATALOG) expect(collapses(buildPiece(entry, 0, 0, 0, 0, 0xffffff))).toBe(false);
  });

  it('un cuerpo con la cara de arriba hundida pero por encima de la de abajo sigue entero', () => {
    expect(collapses(crown(0, 0.8, 0.25))).toBe(false);
  });

  it('cuando la cara de arriba baja hasta la de abajo, el cuerpo se aplasta', () => {
    expect(collapses(crown(0, 0.5, 0.5))).toBe(true);
  });

  it('cuando la cara de arriba atraviesa la de abajo, también', () => {
    expect(collapses(crown(0, 0.2, 0.5))).toBe(true);
  });
});
