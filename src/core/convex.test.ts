import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { isConvex, splitConvex, triangulateFace } from './convex';
import { buildExportMeshes } from './export';
import { makePiece, type Piece, type Vec3 } from './piece';

const cube = (x = 0) => buildPiece(CATALOG[0], x, 0, 0, 0, 0x336699);

const area = (face: Vec3[], triangles: [number, number, number][]): number =>
  triangles.reduce((sum, [a, b, c]) => {
    const u = [face[b][0] - face[a][0], face[b][1] - face[a][1], face[b][2] - face[a][2]];
    const v = [face[c][0] - face[a][0], face[c][1] - face[a][1], face[c][2] - face[a][2]];
    return sum + Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }, 0);

/** Cubo con un vértice de la cara superior hundido hacia dentro: ya no es convexo. */
function dentedCube(): Piece {
  const base = cube();
  const top = Math.max(...base.faces.flat().map((p) => p[1]));
  const corner = base.faces.flat().find((p) => p[1] === top)!;
  const moved = base.faces.map((face) => face.map((p) => (p[0] === corner[0] && p[1] === corner[1] && p[2] === corner[2] ? ([p[0], p[1] - 0.6, p[2]] as Vec3) : p)));
  return makePiece(moved, base.color);
}

describe('isConvex', () => {
  it('los poliedros del catálogo son convexos', () => {
    for (const entry of CATALOG) expect(isConvex(buildPiece(entry, 0, 0, 0, 0, 0xffffff))).toBe(true);
  });

  it('un vértice hundido deja una malla libre', () => {
    expect(isConvex(dentedCube())).toBe(false);
  });

  it('separa las piezas convexas de las libres', () => {
    const { convex, free } = splitConvex([cube(), dentedCube(), cube(3)]);
    expect(convex).toHaveLength(2);
    expect(free).toHaveLength(1);
  });
});

describe('triangulateFace', () => {
  it('una cara convexa se parte en abanico', () => {
    const quad: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]];
    expect(triangulateFace(quad)).toEqual([[0, 1, 2], [0, 2, 3]]);
  });

  it('una cara en L cubre exactamente su área, sin tapar el hueco', () => {
    // L de área 3: cuadrado de 2×2 sin el cuadrante superior derecho.
    const l: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]];
    const triangles = triangulateFace(l);
    expect(triangles).toHaveLength(4);
    expect(area(l, triangles)).toBeCloseTo(3, 9);
  });

  it('funciona con la cara orientada en cualquier plano', () => {
    const l: Vec3[] = [[0, 0, 0], [0, 0, 2], [0, 1, 2], [0, 1, 1], [0, 2, 1], [0, 2, 0]];
    expect(area(l, triangulateFace(l))).toBeCloseTo(3, 9);
  });

  it('no pierde una cara degenerada', () => {
    const line: Vec3[] = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
    expect(triangulateFace(line).length).toBeGreaterThan(0);
  });
});

describe('exportar mallas libres', () => {
  it('la unión por color incluye las caras de una malla libre', () => {
    const meshes = buildExportMeshes([cube(), dentedCube()], 'merged');
    const triangles = meshes.reduce((sum, mesh) => sum + mesh.indices.length / 3, 0);
    expect(triangles).toBeGreaterThan(12);
  });
});
