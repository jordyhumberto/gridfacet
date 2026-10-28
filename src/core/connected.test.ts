import { describe, expect, it } from 'vitest';
import { buildPiece, CATALOG } from './catalog';
import { connectedPieces, sizeOf } from './connected';
import { keepGroup, newGroupId, withGroup } from './piece';
import { mirrorPiece, translatePiece } from './transform';
import { parseProject, parseProjectFull, serializeProject } from './project';
import { buildExportMeshes } from './export';

const cube = (x: number, y: number, z: number) => buildPiece(CATALOG[0], x, y, z, 0, 0xff0000);

describe('piezas conectadas', () => {
  it('sigue la cadena de piezas que se tocan por una cara', () => {
    const a = cube(0, 0, 0);
    const b = cube(1, 0, 0);
    const c = cube(2, 0, 0);
    const far = cube(5, 0, 0);
    const got = connectedPieces([a], [a, b, c, far]).map((p) => p.id).sort();
    expect(got).toEqual([a.id, b.id, c.id].sort());
  });

  it('una esquina o una arista no cuentan como contacto', () => {
    const a = cube(0, 0, 0);
    const diagonal = cube(1, 3, 1);
    const edge = cube(1, 0, 1);
    expect(connectedPieces([a], [a, diagonal, edge]).map((p) => p.id)).toEqual([a.id]);
  });

  it('una pieza apilada encima cuenta', () => {
    const a = cube(0, 0, 0);
    const top = cube(0, 3, 0);
    expect(connectedPieces([a], [a, top])).toHaveLength(2);
  });

  it('sizeOf mide la caja del conjunto', () => {
    const [w, h, d] = sizeOf([cube(0, 0, 0), cube(1, 0, 0)])!;
    expect(w).toBeCloseTo(2);
    expect(h).toBeCloseTo(1);
    expect(d).toBeCloseTo(1);
    expect(sizeOf([])).toBeNull();
  });
});

describe('grupos', () => {
  it('mover y espejar conservan el grupo; withGroup lo cambia y quita', () => {
    const g = newGroupId();
    const grouped = withGroup(cube(0, 0, 0), g);
    expect(translatePiece(grouped, 1, 0, 0).group).toBe(g);
    expect(mirrorPiece(grouped, 'x', 0).group).toBe(g);
    expect(withGroup(grouped, undefined).group).toBeUndefined();
    expect(keepGroup(cube(0, 0, 0), grouped).group).toBe(g);
  });

  it('el grupo se guarda y se recupera', () => {
    const g = newGroupId();
    const loaded = parseProject(serializeProject([withGroup(cube(0, 0, 0), g), cube(1, 0, 0)]));
    expect(loaded[0].group).toBe(g);
    expect(loaded[1].group).toBeUndefined();
  });
});

describe('tamaño de la malla en el proyecto', () => {
  it('se guarda y se recupera, y los proyectos antiguos no lo traen', () => {
    const pieces = [cube(0, 0, 0)];
    expect(parseProjectFull(serializeProject(pieces, [], 40)).gridSize).toBe(40);
    expect(parseProjectFull(serializeProject(pieces)).gridSize).toBeUndefined();
  });

  it('ignora un tamaño que no es un entero razonable', () => {
    const raw = JSON.parse(serializeProject([cube(0, 0, 0)], [], 24));
    raw.gridSize = 'grande';
    expect(parseProjectFull(JSON.stringify(raw)).gridSize).toBeUndefined();
  });
});

describe('nombre de grupo', () => {
  it('se conserva al mover, se guarda y da nombre a los objetos exportados', () => {
    const g = newGroupId();
    const named = withGroup(cube(0, 0, 0), g, 'Cola larga!');
    expect(translatePiece(named, 1, 0, 0).groupName).toBe('Cola larga!');
    expect(parseProject(serializeProject([named]))[0].groupName).toBe('Cola larga!');
    const meshes = buildExportMeshes([named, cube(3, 0, 0)], 'perPiece');
    expect(meshes[0].name).toMatch(/^Cola_larga_\d+$/);
    expect(meshes[1].name).toMatch(/^Pieza_\d+$/);
  });

  it('sin grupo el nombre se descarta al guardar', () => {
    const plain = cube(0, 0, 0);
    plain.groupName = 'suelto';
    expect(parseProject(serializeProject([plain]))[0].groupName).toBeUndefined();
  });
});
