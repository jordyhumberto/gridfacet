import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { cutPieces, crossesPlane } from './cut';
import { planeFromPoints, volume, type Piece, type Vec3 } from './piece';

const total = (pieces: Piece[]) => pieces.reduce((sum, p) => sum + volume(p), 0);
const cubeAt = (x: number) => buildPiece(CATALOG[0], x, 0, 0, 0, 0xffffff);

describe('cutPieces', () => {
  // De la esquina inferior del primer cubo a la esquina superior del segundo.
  // El orden de los puntos decide el lado: así se conserva la parte de abajo.
  const plane = planeFromPoints([0, 0, 0], [2, 1, 1], [2, 1, 0]);

  it('un solo plano corta dos cubos juntos y deja una rampa continua', () => {
    const pieces = [cubeAt(0), cubeAt(1)];
    const { added, removed } = cutPieces(pieces, plane, false);
    expect(removed).toHaveLength(2);
    expect(added).toHaveLength(2);
    expect(volume(added[0])).toBeCloseTo(0.25);
    expect(volume(added[1])).toBeCloseTo(0.75);
  });

  it('con keepBoth las dos mitades suman el volumen original', () => {
    const pieces = [cubeAt(0), cubeAt(1)];
    const { added } = cutPieces(pieces, plane, true);
    expect(added).toHaveLength(4);
    expect(total(added)).toBeCloseTo(2);
  });

  it('no toca las piezas que el plano no cruza', () => {
    const far = cubeAt(10);
    expect(crossesPlane(far, plane)).toBe(false);
    const { added, removed } = cutPieces([far], plane, false);
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });
});

describe('corte limitado a una región', () => {
  // Plano vertical z = 0.5 que atraviesa dos cubos separados en Z (0..1 y 2..3 no); usamos dos cubos en X.
  const plane = planeFromPoints([0.5, 0, 0], [0.5, 1, 0], [0.5, 1, 1]);

  it('solo corta las piezas que la región alcanza', () => {
    const pieces = [cubeAt(0), cubeAt(1)];
    // Región que cubre la sección del primer cubo (z 0..1, y 0..1) en x = 0.5; el segundo cubo no cruza el plano.
    const region: Vec3[] = [[0.5, 0, 0], [0.5, 1, 0], [0.5, 1, 1], [0.5, 0, 1]];
    const { removed } = cutPieces(pieces, plane, false, region);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(pieces[0]);
  });

  it('una región lejos de la pieza no corta nada aunque el plano la cruce', () => {
    const pieces = [cubeAt(0)];
    const far: Vec3[] = [[0.5, 5, 5], [0.5, 6, 5], [0.5, 6, 6]];
    expect(cutPieces(pieces, plane, false, far).removed).toHaveLength(0);
    expect(cutPieces(pieces, plane, false).removed).toHaveLength(1);
  });

  it('una región que solo roza el borde no cuenta', () => {
    const pieces = [cubeAt(0)];
    const touching: Vec3[] = [[0.5, 1, 0], [0.5, 2, 0], [0.5, 2, 1]];
    expect(cutPieces(pieces, plane, false, touching).removed).toHaveLength(0);
  });

  it('funciona con regiones cóncavas', () => {
    const pieces = [cubeAt(0)];
    // Forma en L que cubre la parte baja y la izquierda de la sección.
    const l: Vec3[] = [[0.5, 0, 0], [0.5, 0, 1], [0.5, 0.3, 1], [0.5, 0.3, 0.3], [0.5, 1, 0.3], [0.5, 1, 0]];
    expect(cutPieces(pieces, plane, false, l).removed).toHaveLength(1);
  });
});
