import { describe, expect, it } from 'vitest';
import { volume } from './piece';
import { buildShape, SHAPES, shapePoints } from './shapes';

const extent = (points: number[][], axis: number): [number, number] => [Math.min(...points.map((p) => p[axis])), Math.max(...points.map((p) => p[axis]))];

describe('formas', () => {
  it('cada forma llena exactamente su caja', () => {
    for (const { kind } of SHAPES) {
      const points = shapePoints({ kind, size: [2, 3, 1], sides: 12 });
      const [lo, hi] = extent(points, 1);
      expect(hi - lo).toBeCloseTo(3, 6);
      const [xlo, xhi] = extent(points, 0);
      expect(xhi - xlo).toBeLessThanOrEqual(2 + 1e-9);
    }
  });

  it('produce piezas convexas con volumen, centradas donde se pide', () => {
    for (const { kind } of SHAPES) {
      const piece = buildShape({ kind, size: [1, 1, 1], sides: 10 }, [4, 2, -3], 0xff0000)!;
      expect(piece).not.toBeNull();
      expect(volume(piece)).toBeGreaterThan(0.05);
      const pts = piece.faces.flat();
      const [ylo, yhi] = extent(pts, 1);
      expect((ylo + yhi) / 2).toBeCloseTo(2, 6);
    }
  });

  it('con pocos lados un cono es una pirámide y un cilindro un prisma', () => {
    const pyramid = buildShape({ kind: 'cone', size: [1, 1, 1], sides: 4 }, [0, 0, 0], 0)!;
    expect(pyramid.faces).toHaveLength(5);
    const prism = buildShape({ kind: 'cylinder', size: [1, 1, 1], sides: 6 }, [0, 0, 0], 0)!;
    expect(prism.faces).toHaveLength(8);
  });

  it('limita los lados para que el casco no se dispare', () => {
    const many = shapePoints({ kind: 'sphere', size: [1, 1, 1], sides: 500 });
    expect(many.length).toBeLessThan(200);
  });
});
