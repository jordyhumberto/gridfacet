import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { intersectionPoints } from './intersections';
import type { Vec3 } from './piece';
import { translatePiece } from './transform';

const cube = (x = 0, y = 0, z = 0) => buildPiece(CATALOG[0], x, y * 3, z, 0, 0xff0000);
const has = (points: Vec3[], target: Vec3) =>
  points.some((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]) < 1e-6);

describe('intersectionPoints', () => {
  it('dos cubos desplazados media celda cruzan sus aristas en puntos nuevos', () => {
    const points = intersectionPoints([cube(), translatePiece(cube(), 0.5, 0.5, 0.5)]);
    expect(has(points, [1, 0.5, 0.5])).toBe(true);
    expect(has(points, [0.5, 1, 0.5])).toBe(true);
    expect(has(points, [0.5, 0.5, 1])).toBe(true);
  });

  it('un cubo hundido en una rampa cruza la superficie inclinada', () => {
    // La rampa sube hacia un lado; el cubo está en medio y la atraviesa.
    const ramp = buildPiece(CATALOG[2], 0, 0, 0, 0, 0x3b8bd4);
    const sunk = translatePiece(cube(), 0.25, 0.1, 0);
    const points = intersectionPoints([ramp, sunk]);
    expect(points.length).toBeGreaterThan(0);
    // Ninguno de los puntos coincide con un vértice de las piezas originales.
    const vertices = [ramp, sunk].flatMap((p) => p.faces.flat());
    for (const p of points) expect(has(vertices, p)).toBe(false);
  });

  it('piezas que solo se tocan por una cara no generan puntos', () => {
    expect(intersectionPoints([cube(0), cube(1)])).toHaveLength(0);
  });

  it('piezas separadas no generan puntos', () => {
    expect(intersectionPoints([cube(0), cube(5)])).toHaveLength(0);
  });
});
