import { describe, expect, it } from 'vitest';
import { convexHull } from './hull';
import { makePiece, volume, type Vec3 } from './piece';

const cubePoints: Vec3[] = [
  [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
  [0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1],
];

describe('convexHull', () => {
  it('los 8 vértices de un cubo dan 6 caras y volumen 1', () => {
    const faces = convexHull(cubePoints)!;
    expect(faces).toHaveLength(6);
    expect(volume(makePiece(faces, 0))).toBeCloseTo(1);
  });

  it('una cuña de 6 puntos tiene 5 caras y la mitad del volumen', () => {
    const wedge = cubePoints.filter((p) => !(p[0] === 1 && p[1] === 1));
    const faces = convexHull(wedge)!;
    expect(faces).toHaveLength(5);
    expect(volume(makePiece(faces, 0))).toBeCloseTo(0.5);
  });

  it('un tetraedro tiene 4 caras con normales hacia fuera', () => {
    const faces = convexHull([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]])!;
    expect(faces).toHaveLength(4);
    expect(volume(makePiece(faces, 0))).toBeCloseTo(1 / 6);
  });

  it('ignora puntos interiores y repetidos', () => {
    const faces = convexHull([...cubePoints, [0.5, 0.5, 0.5], [0, 0, 0]])!;
    expect(faces).toHaveLength(6);
    expect(volume(makePiece(faces, 0))).toBeCloseTo(1);
  });

  it('puntos coplanares no encierran volumen', () => {
    expect(convexHull([[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]])).toBeNull();
  });
});
