import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { clipPiece, makePiece, planeFromPoints, volume } from './piece';
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

  it.each(['novoxel', 'polygrid'])('abre los proyectos guardados con el nombre antiguo del formato (%s)', (format) => {
    const text = JSON.stringify({ format, version: 1, pieces: [] });
    expect(parseProject(text)).toEqual([]);
    expect(JSON.parse(serializeProject([])).format).toBe('gridfacet');
  });

  it('un proyecto vacío es válido', () => {
    expect(parseProject(serializeProject([]))).toEqual([]);
  });

  it('rechaza archivos que no son del programa o están dañados', () => {
    expect(() => parseProject('no es json')).toThrow('JSON');
    expect(() => parseProject('{"hola":1}')).toThrow('proyecto de Gridfacet');
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

describe('animación en el proyecto', () => {
  it('se guarda y se vuelve a leer', async () => {
    const { emptyAnimation, setKey } = await import('./animation');
    const { CATALOG, buildPiece } = await import('./catalog');
    const { withGroup } = await import('./piece');
    const piece = withGroup(buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699), 4, 'Brazo');
    const animation = setKey(emptyAnimation(), 4, 6, { pos: [1, 0, 0], rot: [0, 90, 0], scale: [1, 1, 1] });
    const back = parseProjectFull(serializeProject([piece], [], undefined, undefined, animation));
    expect(back.animation).toEqual(animation);
  });

  it('un proyecto sin animación no la trae, y una animación dañada se ignora', () => {
    expect(parseProjectFull(serializeProject([])).animation).toBeUndefined();
    const text = JSON.stringify({ format: JSON.parse(serializeProject([])).format, version: 1, pieces: [], animation: { frames: 'x' } });
    expect(parseProjectFull(text).animation).toBeUndefined();
  });
});

describe('propiedades de cara en el proyecto', () => {
  it('guarda y recupera «al fondo» junto con las demás propiedades', () => {
    const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const flagged = makePiece(cube.faces, cube.color, undefined, undefined, cube.faces.map((_, i) => (i === 0 ? 7 : 0)));
    const back = parseProject(serializeProject([flagged]));
    expect(back[0].faceFlags?.[0]).toBe(7);
  });
});

describe('vértices canónicos al abrir', () => {
  it('dos esquinas con la misma clave y distinto valor quedan idénticas', () => {
    const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x123456);
    const faces = cube.faces.map((face, i) => (i === 1 ? face.map((p) => [p[0] + 2e-6, p[1], p[2]] as [number, number, number]) : face));
    const loaded = parseProject(serializeProject([makePiece(faces, 0x123456)]))[0];
    const byKey = new Map<string, Set<string>>();
    for (const p of loaded.faces.flat()) {
      const key = p.map((v) => Math.round(v * 1e5)).join(',');
      byKey.set(key, (byKey.get(key) ?? new Set()).add(p.join(',')));
    }
    expect([...byKey.values()].every((values) => values.size === 1)).toBe(true);
  });
});

describe('archivos dañados', () => {
  const head = '{"format":"gridfacet","version":1';
  const cubeJson = (color: number) => JSON.stringify(buildPiece(CATALOG[0], 0, 0, 0, 0, color).faces);

  it('una cara con un vértice no numérico se descarta y el resto se carga', () => {
    const faces = JSON.parse(cubeJson(1)) as unknown[];
    faces[0] = [[0, 0, 0], [1, 0, 0], [1, 'x', 1]];
    const text = `${head},"pieces":[{"color":1,"faces":${JSON.stringify(faces)}}]}`;
    const loaded = parseProjectFull(text);
    expect(loaded.pieces).toHaveLength(1);
    expect(loaded.pieces[0].faces).toHaveLength(5);
    expect(loaded.discarded).toEqual({ pieces: 0, faces: 1, segments: 0 });
  });

  it('al descartar una cara, los colores por cara siguen en paralelo', () => {
    const faces = JSON.parse(cubeJson(1)) as unknown[];
    faces[0] = [[0, 0, 0], [1, 0, 0], [null, 0, 1]];
    const colors = [10, 11, 12, 13, 14, 15];
    const text = `${head},"pieces":[{"color":1,"faces":${JSON.stringify(faces)},"faceColors":${JSON.stringify(colors)}}]}`;
    expect(parseProjectFull(text).pieces[0].faceColors).toEqual([11, 12, 13, 14, 15]);
  });

  it('una pieza dañada se descarta y las demás se cargan', () => {
    const text = `${head},"pieces":[{"color":"rojo","faces":${cubeJson(1)}},{"color":2,"faces":${cubeJson(2)}}]}`;
    const loaded = parseProjectFull(text);
    expect(loaded.pieces).toHaveLength(1);
    expect(loaded.pieces[0].color).toBe(2);
    expect(loaded.discarded.pieces).toBe(1);
  });

  it('una entrada nula en las capas no rompe el archivo ni deja el proyecto a medias', async () => {
    const { Layers } = await import('./layers');
    const text = `${head},"pieces":[{"color":2,"faces":${cubeJson(2)}}],"layers":{"layers":[null,{"id":2,"name":"Pelo"}],"active":2}}`;
    const loaded = parseProjectFull(text);
    expect(loaded.layers?.layers?.every((l) => l !== null)).toBe(true);
    const manager = new Layers();
    expect(() => manager.load(loaded.layers, loaded.pieces)).not.toThrow();
    expect(() => manager.load({ layers: [null as never, { id: 3 }], active: 3 })).not.toThrow();
  });
});

describe('describeDiscarded', () => {
  it('dice qué se dejó fuera y calla si no hubo nada', async () => {
    const { describeDiscarded } = await import('./project');
    expect(describeDiscarded({ pieces: 0, faces: 0, segments: 0 })).toBe('');
    expect(describeDiscarded({ pieces: 1, faces: 3, segments: 0 })).toBe('Se descartaron 1 pieza dañada y 3 caras dañadas del archivo');
  });
});
