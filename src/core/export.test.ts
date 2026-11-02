import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { buildExportMeshes } from './export';

const cubeAt = (x: number, color = 0xff0000) => buildPiece(CATALOG[0], x, 0, 0, 0, color);

describe('buildExportMeshes', () => {
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
