import { describe, expect, it } from 'vitest';
import { convexHull } from './hull';
import { guideVertices } from './guides';
import { makePiece, type Vec3 } from './piece';

const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
  const points: Vec3[] = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) points.push([x, y, z]);
  return makePiece(convexHull(points)!, 0xff0000);
};
const has = (points: Vec3[], target: Vec3) => points.some((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]) < 1e-6);

// Pared del cubo grande en z = 0 (4 × 3 celdas) y un cubo pequeño fuera de centro apoyado en ella.
const wall = box(0, 0, -1, 4, 3, 0);
const small = box(1.1, 0.9, 0, 2, 1.7, 0.5);

describe('guideVertices', () => {
  it('el cubo pequeño prolonga sus aristas hasta el borde de la pared', () => {
    const { points } = guideVertices([3, 1.5, 0], [wall, small]);
    // Su arista vertical x = 1.1 llega al borde inferior y al superior de la pared.
    expect(has(points, [1.1, 0, 0])).toBe(true);
    expect(has(points, [1.1, 3, 0])).toBe(true);
    // Y la horizontal y = 0.9 llega a los bordes laterales.
    expect(has(points, [0, 0.9, 0])).toBe(true);
    expect(has(points, [4, 0.9, 0])).toBe(true);
  });

  it('dos aristas prolongadas del cubo pequeño y de otro se cruzan en un vértice virtual', () => {
    const other = box(3, 2, 0, 3.5, 2.5, 0.3);
    const { points } = guideVertices([2.5, 1.5, 0], [wall, small, other]);
    // x = 3 del segundo cubo con y = 1.7 del primero.
    expect(has(points, [3, 1.7, 0])).toBe(true);
    // x = 1.1 del primero con y = 2.5 del segundo.
    expect(has(points, [1.1, 2.5, 0])).toBe(true);
  });

  it('devuelve las líneas prolongadas recortadas a la pared', () => {
    const { lines } = guideVertices([3, 1.5, 0], [wall, small]);
    const vertical = lines.find(([a, b]) => Math.abs(a[0] - 1.1) < 1e-6 && Math.abs(b[0] - 1.1) < 1e-6);
    expect(vertical).toBeDefined();
    const ys = [vertical![0][1], vertical![1][1]].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0);
    expect(ys[1]).toBeCloseTo(3);
  });

  it('una pieza sola no genera nada', () => {
    const { points, lines } = guideVertices([2, 1.5, 0], [wall]);
    expect(points).toEqual([]);
    expect(lines).toEqual([]);
  });

  it('con el cursor lejos del plano no hay guías', () => {
    expect(guideVertices([2, 1.5, 3], [wall, small]).points).toEqual([]);
  });

  it('con el cursor fuera de la pared tampoco', () => {
    expect(guideVertices([9, 1.5, 0], [wall, small]).points).toEqual([]);
  });

  it('funciona en el plano vertical contrario (cara lateral)', () => {
    // Misma escena girada: la pared pasa a x = 0 y el cubo pequeño sobresale en +x.
    const side = box(-1, 0, 0, 0, 3, 4);
    const bump = box(0, 0.9, 1.1, 0.5, 1.7, 2);
    const { points } = guideVertices([0, 1.5, 3], [side, bump]);
    expect(has(points, [0, 0, 1.1])).toBe(true);
    expect(has(points, [0, 0.9, 4])).toBe(true);
  });
});
