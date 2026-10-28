import { describe, expect, it } from 'vitest';
import { buildPiece, CATALOG } from '../core/catalog';
import { buildShape } from '../core/shapes';
import { faceVertexNormals } from './shading';

describe('normales por vértice', () => {
  it('planas: todas las de una cara son iguales', () => {
    const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0);
    for (const face of faceVertexNormals(cube, false)) {
      expect(face.every((n) => n.every((v, i) => Math.abs(v - face[0][i]) < 1e-9))).toBe(true);
    }
  });

  it('suaves: las esquinas de un cubo siguen vivas porque las caras forman 90°', () => {
    const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0);
    const flat = faceVertexNormals(cube, false);
    const smooth = faceVertexNormals(cube, true);
    smooth.forEach((face, i) => face.forEach((n, j) => n.forEach((v, k) => expect(v).toBeCloseTo(flat[i][j][k], 9))));
  });

  it('suaves: en una esfera los vértices de una cara difieren de su normal plana', () => {
    const sphere = buildShape({ kind: 'sphere', size: [1, 1, 1], sides: 16 }, [0, 0, 0], 0)!;
    const flat = faceVertexNormals(sphere, false);
    const smooth = faceVertexNormals(sphere, true);
    let different = 0;
    smooth.forEach((face, i) => face.forEach((n, j) => {
      if (n.some((v, k) => Math.abs(v - flat[i][j][k]) > 1e-3)) different++;
      expect(Math.hypot(...n)).toBeCloseTo(1, 6);
    }));
    expect(different).toBeGreaterThan(10);
  });
});
