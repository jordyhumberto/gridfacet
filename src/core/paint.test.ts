import { describe, expect, it } from 'vitest';
import { paintChange, facesAt } from './paint';
import { buildPiece, CATALOG } from './catalog';
import { faceColorOf } from './piece';
import { buildExportMeshes } from './export';
import { parseProject, serializeProject } from './project';
import { mirrorPiece } from './transform';
import { clipPiece, planeFromPoints } from './piece';

const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);

describe('pintar caras', () => {
  it('pinta solo la cara elegida y reemplaza la pieza', () => {
    const piece = cube();
    const { added, removed } = paintChange([{ piece, index: 4 }], 0x00ff00);
    expect(removed).toEqual([piece]);
    expect(added).toHaveLength(1);
    expect(faceColorOf(added[0], 4)).toBe(0x00ff00);
    expect(faceColorOf(added[0], 0)).toBe(0xff0000);
    expect(added[0].color).toBe(0xff0000);
  });

  it('no cambia nada si la cara ya tiene ese color', () => {
    const { added, removed } = paintChange([{ piece: cube(), index: 2 }], 0xff0000);
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  it('pintar todas las caras deja la pieza de un solo color, sin colores por cara', () => {
    const { added } = paintChange([{ piece: cube(), index: -1 }], 0x0000ff);
    expect(added[0].color).toBe(0x0000ff);
    expect(added[0].faceColors).toBeUndefined();
  });

  it('el color por cara sobrevive a espejo, corte y guardado', () => {
    const painted = paintChange([{ piece: cube(), index: 4 }], 0x00ff00).added[0];
    const mirrored = mirrorPiece(painted, 'x', 0.5);
    expect(faceColorOf(mirrored, 4)).toBe(0x00ff00);
    const cut = clipPiece(painted, planeFromPoints([0.5, 0, 0], [0.5, 1, 0], [0.5, 0, 1]))!;
    expect(cut.faceColors).toBeDefined();
    expect(cut.faces.some((_, i) => faceColorOf(cut, i) === 0x00ff00)).toBe(true);
    const loaded = parseProject(serializeProject([painted]))[0];
    expect(loaded.faceColors).toEqual(painted.faceColors);
  });

  it('la exportación reparte la pieza en una malla por color', () => {
    const painted = paintChange([{ piece: cube(), index: 4 }], 0x00ff00).added[0];
    expect(buildExportMeshes([painted], 'perPiece').map((m) => m.color).sort((a, b) => a - b)).toEqual([0x00ff00, 0xff0000].sort((a, b) => a - b));
    expect(buildExportMeshes([painted], 'merged').map((m) => m.color).sort((a, b) => a - b)).toEqual([0x00ff00, 0xff0000].sort((a, b) => a - b));
  });

  it('facesAt encuentra la cara por su centro y su normal', () => {
    const piece = cube();
    const top = piece.faces[1];
    const centre: [number, number, number] = [0.5, top[0][1], 0.5];
    expect(facesAt([piece], centre, [0, 1, 0])).toEqual([{ piece, index: 1 }]);
    expect(facesAt([piece], centre, [0, -1, 0])).toEqual([]);
  });
});
