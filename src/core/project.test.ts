import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { clipPiece, planeFromPoints, volume } from './piece';
import { parseProject, parseProjectFull, serializeProject } from './project';

describe('proyecto', () => {
  it('ida y vuelta conserva caras, color y volumen, incluso en piezas cortadas', () => {
    const cube = buildPiece(CATALOG[0], 2, 3, -1, 1, 0x123456);
    const cut = clipPiece(cube, planeFromPoints([2, 1, -1], [3, 2, -1], [3, 2, 0]))!;
    const loaded = parseProject(serializeProject([cube, cut]));
    expect(loaded).toHaveLength(2);
    expect(loaded[1].faces).toEqual(cut.faces);
    expect(loaded[1].color).toBe(0x123456);
    expect(volume(loaded[1])).toBeCloseTo(volume(cut));
  });

  it('abre los proyectos guardados con el nombre antiguo del formato (novoxel)', () => {
    const text = JSON.stringify({ format: 'novoxel', version: 1, pieces: [] });
    expect(parseProject(text)).toEqual([]);
    expect(JSON.parse(serializeProject([])).format).toBe('polygrid');
  });

  it('un proyecto vacío es válido', () => {
    expect(parseProject(serializeProject([]))).toEqual([]);
  });

  it('rechaza archivos que no son del programa o están dañados', () => {
    expect(() => parseProject('no es json')).toThrow('JSON');
    expect(() => parseProject('{"hola":1}')).toThrow('proyecto de Polygrid');
    expect(() => parseProject('{"format":"novoxel","version":99,"pieces":[]}')).toThrow('más nueva');
    expect(() => parseProject('{"format":"novoxel","version":1,"pieces":[{"color":1,"faces":[]}]}')).toThrow('caras');
    expect(() => parseProject('{"format":"novoxel","version":1,"pieces":[null]}')).toThrow('color');
  });

  it('rechaza piezas sin volumen', () => {
    const flat = [[[0, 0, 0], [1, 0, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0], [1, 0, 0]], [[0, 0, 0], [1, 0, 0], [1, 1, 0]], [[0, 0, 0], [1, 1, 0], [1, 0, 0]]];
    const text = JSON.stringify({ format: 'novoxel', version: 1, pieces: [{ color: 0, faces: flat }] });
    expect(() => parseProject(text)).toThrow('volumen');
  });

  const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x123456);

  it('guarda y recupera los puntos de referencia', () => {
    const text = serializeProject([cube], [[0.5, 0, 0], [1, 1, 1]]);
    expect(parseProjectFull(text).marks).toEqual([[0.5, 0, 0], [1, 1, 1]]);
  });

  it('un proyecto sin puntos se lee igual (compatibilidad con archivos antiguos)', () => {
    expect(parseProjectFull(serializeProject([cube])).marks).toEqual([]);
  });
});
