import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import type { Vec3 } from './piece';
import { translatePiece } from './transform';
import { candidatePoints, uniqueEdges } from './vertexCandidates';

const cube = (x = 0, y = 0, z = 0) => buildPiece(CATALOG[0], x, y * 3, z, 0, 0xff0000);
const has = (points: Vec3[], target: Vec3) =>
  points.some((p) => Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]) < 1e-6);

describe('candidatePoints', () => {
  it('un cubo tiene 12 aristas distintas', () => {
    expect(uniqueEdges(cube())).toHaveLength(12);
  });

  it('divide las aristas sin repetir ni incluir los extremos', () => {
    const { points } = candidatePoints([cube()], [cube()], { divisions: 4, faces: false });
    expect(points).toHaveLength(12 * 3);
    expect(has(points, [0.5, 0, 0])).toBe(true);
    expect(has(points, [0.25, 0, 0])).toBe(true);
    expect(has(points, [0, 0, 0])).toBe(false);
  });

  it('con 2 divisiones solo salen los puntos medios', () => {
    const { points } = candidatePoints([cube()], [], { divisions: 2, faces: false });
    expect(points).toHaveLength(12);
  });

  it('la cuadrícula de caras añade puntos dentro de cada cara', () => {
    const base = candidatePoints([cube()], [], { divisions: 2, faces: false }).points.length;
    const withFaces = candidatePoints([cube()], [], { divisions: 2, faces: true });
    expect(withFaces.points.length).toBe(base + 6);
    expect(has(withFaces.points, [0.5, 0.5, 0])).toBe(true);
    expect(has(withFaces.points, [0.5, 1, 0.5])).toBe(true);
  });

  it('incluye los puntos donde la pieza cruza a otra', () => {
    const other = translatePiece(cube(), 0.5, 0.5, 0.5);
    const { points } = candidatePoints([cube()], [cube(), other], { divisions: 2, faces: false });
    expect(has(points, [1, 0.5, 0.5])).toBe(true);
    expect(has(points, [0.5, 1, 0.5])).toBe(true);
  });

  it('no mezcla piezas que no se tocan', () => {
    const far = cube(10);
    const a = candidatePoints([cube()], [cube(), far], { divisions: 2, faces: false }).points.length;
    const b = candidatePoints([cube()], [cube()], { divisions: 2, faces: false }).points.length;
    expect(a).toBe(b);
  });
});
