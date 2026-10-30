import { describe, expect, it } from 'vitest';
import { convexHull } from './hull';
import { guideVertices } from './guides';
import { seatOnSlope } from './slope';
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

describe('guideVertices sobre pendientes', () => {
  const s = Math.SQRT1_2;
  // Rampa de 2 celdas de ancho que sube 1 hacia +z: la cara inclinada mira hacia −z y arriba.
  const ramp = convexHull([[0, 0, 0], [2, 0, 0], [0, 0, 1], [2, 0, 1], [0, 1, 1], [2, 1, 1]] as Vec3[])!;
  const slope = makePiece(ramp, 0x88aacc);
  // Un cubito asentado sobre ella: su base es la pendiente.
  const n: Vec3 = [0, s, -s];
  const chimney = seatOnSlope([box(0, 0, 0, 0.5, 0.5, 0.5)], n, [1, 0.5, 0.5], [0.75, 0.5])[0];

  it('las aristas de la base de la pieza asentada se prolongan hasta el borde de la rampa', () => {
    const { points } = guideVertices([1.5, 0.5, 0.5], [slope, chimney]);
    // La base de la chimenea cubre x de 0,5 a 1; sus aristas paralelas a z llegan a los bordes alto y bajo de la rampa.
    expect(has(points, [0.5, 0, 0])).toBe(true);
    expect(has(points, [0.5, 1, 1])).toBe(true);
    expect(has(points, [1, 0, 0])).toBe(true);
    expect(has(points, [1, 1, 1])).toBe(true);
  });

  it('también hay vértices en los bordes laterales de la rampa', () => {
    const { points } = guideVertices([1.5, 0.5, 0.5], [slope, chimney]);
    // Las aristas de la base paralelas a x salen hasta x = 0 y x = 2 en la cara inclinada.
    expect(points.some((p) => Math.abs(p[0]) < 1e-6 && p[1] > 0.1 && p[1] < 0.9)).toBe(true);
    expect(points.some((p) => Math.abs(p[0] - 2) < 1e-6 && p[1] > 0.1 && p[1] < 0.9)).toBe(true);
  });

  it('agrupa caras coplanares aunque sus normales difieran en la precisión de los decimales', () => {
    const nudged = seatOnSlope([box(0, 0, 0, 0.5, 0.5, 0.5)], [1e-8, s, -s], [1, 0.5, 0.5], [0.75, 0.5])[0];
    expect(guideVertices([1.5, 0.5, 0.5], [slope, nudged]).points.length).toBeGreaterThan(0);
  });

  it('sin una pieza apoyada en la pendiente no hay guías', () => {
    expect(guideVertices([1, 0.5, 0.5], [slope]).points).toEqual([]);
  });
});

describe('guideVertices: aristas de piezas vecinas proyectadas', () => {
  // Cubo grande (0..2) y un cubito encima que no toca la cara frontal z = 2: está retranqueado 0,5 y desplazado.
  const big = box(0, 0, 0, 2, 2, 2);
  const top = box(0.6, 2, 0.4, 1.1, 2.5, 1.2);

  it('las aristas del cubito de arriba se proyectan sobre la cara frontal del cubo grande', () => {
    const { points, projected } = guideVertices([1, 1.8, 2], [big, top]);
    // Sus aristas verticales x = 0,6 y x = 1,1 caen sobre la cara frontal y llegan al borde superior (y = 2).
    expect(has(points, [0.6, 2, 2])).toBe(true);
    expect(has(points, [1.1, 2, 2])).toBe(true);
    expect(projected.length).toBeGreaterThan(0);
  });

  it('también en una cara lateral', () => {
    const { points } = guideVertices([2, 1.8, 1], [big, top]);
    // Aristas de z = 0,4 y z = 1,2 proyectadas sobre la cara x = 2.
    expect(has(points, [2, 2, 0.4])).toBe(true);
    expect(has(points, [2, 2, 1.2])).toBe(true);
  });

  it('en la cara inclinada de una rampa con una pieza al lado', () => {
    const ramp = makePiece(convexHull([[0, 0, 0], [2, 0, 0], [0, 0, 1], [2, 0, 1], [0, 1, 1], [2, 1, 1]] as Vec3[])!, 0x88aacc);
    const post = box(2, 0, 0.3, 2.4, 0.8, 0.7);
    const { points } = guideVertices([1.6, 0.5, 0.5], [ramp, post]);
    // La arista x = 2 del poste, proyectada sobre la rampa, cruza las del borde de la rampa en su borde lateral.
    expect(points.length).toBeGreaterThan(0);
  });

  it('no marca como virtuales los vértices reales', () => {
    const { points } = guideVertices([1, 1.8, 2], [big, top]);
    expect(has(points, [0, 0, 2])).toBe(false);
  });
});
