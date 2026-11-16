import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { buildExportMeshes } from './export';
import { deleteFaces } from './vertices';
import type { Piece } from './piece';

const cubeAt = (x: number, color = 0xff0000) => buildPiece(CATALOG[0], x, 0, 0, 0, color);

/** Cubo de lado 1 sin la tapa de arriba (la cara que mira a +Y). */
function openBox(): Piece {
  const box = cubeAt(0);
  const top = box.faces.findIndex((face) => face.every((p) => p[1] === Math.max(...box.faces.flat().map((q) => q[1]))));
  return deleteFaces(box, new Set([top]))!;
}

describe('buildExportMeshes', () => {
  it('una pieza abierta no se come lo que se apoya sobre ella al unir', () => {
    const box = openBox();
    expect(box.faces).toHaveLength(5);
    // Un cubo pequeño encima del borde de la caja sin tapa.
    const lid = buildPiece(CATALOG[0], 0, 1, 0, 0, 0x00ff00);
    const meshes = buildExportMeshes([box, lid], 'merged');
    const triangles = meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);
    // La caja abierta conserva sus 5 caras (10 triángulos) y el cubo de arriba sus 12.
    expect(triangles).toBeGreaterThanOrEqual(20);
    const green = meshes.find((m) => m.color === 0x00ff00);
    expect(green).toBeDefined();
    expect(green!.indices.length / 3).toBeGreaterThanOrEqual(10);
  });

  it('un cubo dentro de una pieza abierta tampoco desaparece', () => {
    const box = openBox();
    const inner = { ...buildPiece(CATALOG[0], 0, 0, 0, 0, 0x00ff00) };
    // Mismo hueco que la caja: el cubo está dentro de su prisma «infinito» hacia arriba.
    const meshes = buildExportMeshes([box, inner], 'merged');
    expect(meshes.some((m) => m.color === 0x00ff00 && m.indices.length > 0)).toBe(true);
  });

  it('suelda los vértices: un cubo tiene 8 vértices y 12 triángulos', () => {
    const [mesh] = buildExportMeshes([cubeAt(0)], 'perPiece');
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.indices.length / 3).toBe(12);
  });

  it('al unir dos cubos contiguos queda una sola caja de 8 vértices y 12 triángulos', () => {
    const meshes = buildExportMeshes([cubeAt(0), cubeAt(1)], 'merged');
    expect(meshes).toHaveLength(1);
    expect(meshes[0].positions.length / 3).toBe(8);
    expect(meshes[0].indices.length / 3).toBe(12);
  });

  it('agrupa por color y también quita la cara compartida entre colores', () => {
    const meshes = buildExportMeshes([cubeAt(0, 0xff0000), cubeAt(1, 0x0000ff)], 'merged');
    expect(meshes.map((m) => m.color).sort((a, b) => a - b)).toEqual([0x0000ff, 0xff0000]);
    const triangles = meshes.reduce((sum, m) => sum + m.indices.length / 3, 0);
    expect(triangles).toBe(20);
  });

  it('en modo por capa une cada capa por separado y nombra las mallas con la capa', () => {
    const base = cubeAt(0);
    const other = { ...cubeAt(1), layer: 2 };
    const meshes = buildExportMeshes([base, other], 'perLayer', (id) => (id === 2 ? 'Pelo suelto' : 'Cabeza'));
    expect(meshes.map((m) => m.name)).toEqual(['Cabeza_ff0000', 'Pelo_suelto_ff0000']);
    // Los dos cubos se tocan, pero al ir en capas distintas cada uno conserva su caja completa.
    expect(meshes.every((m) => m.indices.length / 3 === 12)).toBe(true);
  });

  it('en modo por pieza conserva una malla por pieza', () => {
    const meshes = buildExportMeshes([cubeAt(0), cubeAt(1)], 'perPiece');
    expect(meshes).toHaveLength(2);
  });
});
