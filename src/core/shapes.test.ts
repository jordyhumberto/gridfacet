import { describe, expect, it } from 'vitest';
import { volume } from './piece';
import { buildShape, SECTIONS, SHAPES, shapePoints, type ShapeSpec } from './shapes';

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

describe('secciones de esfera', () => {
  const base: ShapeSpec = { kind: 'sphere', size: [1, 1, 1], sides: 12, rings: 4 };
  const vol = (spec: Partial<ShapeSpec>, up?: [number, number, number]) => volume(buildShape({ ...base, ...spec }, [0, 0, 0], 0xff0000, up)!);
  const box = (spec: Partial<ShapeSpec>, up?: [number, number, number]) => {
    const pts = buildShape({ ...base, ...spec }, [0, 0, 0], 0xff0000, up)!.faces.flat();
    return [0, 1, 2].map((i) => extent(pts, i));
  };

  it('todas las secciones producen piezas convexas con volumen', () => {
    for (const { kind } of SECTIONS) expect(vol({ section: kind })).toBeGreaterThan(0.02);
  });

  it('un hemisferio es la mitad de la esfera', () => {
    expect(vol({ section: 'hemi' })).toBeCloseTo(vol({ section: 'full' }) / 2, 6);
  });

  it('un gajo de 90° es un cuarto, y el octante un cuarto del hemisferio', () => {
    expect(vol({ section: 'wedge', angle: 90 })).toBeCloseTo(vol({ section: 'full' }) / 4, 6);
    expect(vol({ section: 'octant' })).toBeCloseTo(vol({ section: 'full' }) / 8, 6);
  });

  it('el casquete es más pequeño cuanto más alto el corte', () => {
    expect(vol({ section: 'cap', cut: 0.5 })).toBeLessThan(vol({ section: 'cap', cut: 0 }));
    expect(vol({ section: 'cap', cut: -0.5 })).toBeGreaterThan(vol({ section: 'cap', cut: 0 }));
  });

  it('los anillos son independientes de los lados', () => {
    const few = shapePoints({ ...base, rings: 3 }).length;
    const many = shapePoints({ ...base, rings: 6 }).length;
    expect(many).toBeGreaterThan(few);
  });

  it('la sección queda centrada en su propia caja', () => {
    const [x, y, z] = box({ section: 'hemi' });
    expect((y[0] + y[1]) / 2).toBeCloseTo(0, 6);
    expect(y[1] - y[0]).toBeCloseTo(0.5, 6);
    expect(x[1] - x[0]).toBeCloseTo(1, 1);
    expect(z[1] - z[0]).toBeCloseTo(1, 1);
  });

  it('la cúpula se gira hacia donde se pide y la cara plana queda del lado contrario', () => {
    const [x, y] = box({ section: 'hemi' }, [1, 0, 0]);
    expect(x[1] - x[0]).toBeCloseTo(0.5, 6);
    expect(y[1] - y[0]).toBeCloseTo(1, 1);
    const [, yDown] = box({ section: 'hemi' }, [0, -1, 0]);
    expect(yDown[1] - yDown[0]).toBeCloseTo(0.5, 6);
  });

  it('el giro propio mueve el gajo sin cambiar su volumen', () => {
    expect(vol({ section: 'wedge', angle: 90, turn: [30, 45, 10] })).toBeCloseTo(vol({ section: 'wedge', angle: 90 }), 6);
  });

  it('el giro de una cúpula con la normal inclinada conserva el volumen', () => {
    const s = Math.SQRT1_2;
    expect(vol({ section: 'hemi' }, [s, s, 0])).toBeCloseTo(vol({ section: 'hemi' }), 6);
  });
});
