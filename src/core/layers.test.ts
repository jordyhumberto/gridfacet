import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from './catalog';
import { Layers, layerOf } from './layers';
import { clipPiece } from './piece';
import { parseProjectFull, serializeProject } from './project';
import { ModelScene } from '../scene';

const cube = (x = 0) => buildPiece(CATALOG[0], x, 0, 0, 0, 0xabcdef);

describe('capas', () => {
  it('empieza con una capa base y las piezas sin capa pertenecen a ella', () => {
    const layers = new Layers();
    expect(layers.all().map((l) => l.name)).toEqual(['Capa 1']);
    expect(layerOf(cube())).toBe(1);
    expect(layers.isLocked(cube())).toBe(false);
  });

  it('ocultar y bloquear se aplican a las piezas de esa capa', () => {
    const layers = new Layers();
    const second = layers.add('Brazos');
    const piece = cube();
    piece.layer = second.id;
    layers.setLocked(second.id, true);
    layers.setHidden(second.id, true);
    expect(layers.isLocked(piece)).toBe(true);
    expect(layers.isHidden(piece)).toBe(true);
    expect(layers.isLocked(cube())).toBe(false);
  });

  it('una capa nueva queda activa y quitarla devuelve la activa a la base; la base no se quita', () => {
    const layers = new Layers();
    const second = layers.add();
    expect(layers.active).toBe(second.id);
    expect(layers.remove(second.id)).toBe(true);
    expect(layers.active).toBe(1);
    expect(layers.remove(1)).toBe(false);
  });

  it('las piezas nuevas toman la capa activa y las derivadas conservan la suya', () => {
    const model = new ModelScene();
    model.activeLayer = 3;
    const piece = cube();
    model.apply({ added: [piece], removed: [] });
    expect(piece.layer).toBe(3);
    const half = clipPiece(piece, { n: [1, 0, 0], d: 0.5 })!;
    expect(half.layer).toBe(3);
  });

  it('las piezas bloqueadas siguen en el modelo pero no son editables', () => {
    const model = new ModelScene();
    const a = cube();
    const b = cube(2);
    b.layer = 2;
    model.apply({ added: [a, b], removed: [] });
    model.isLocked = (piece) => piece.layer === 2;
    expect(model.all()).toHaveLength(2);
    expect(model.editable().map((p) => p.id)).toEqual([a.id]);
  });

  it('se guardan y se cargan con el proyecto', () => {
    const layers = new Layers();
    const second = layers.add('Torso');
    layers.setLocked(second.id, true);
    const piece = cube();
    piece.layer = second.id;
    const text = serializeProject([piece, cube(1)], [], undefined, layers.toJSON());
    const loaded = parseProjectFull(text);
    const restored = new Layers();
    restored.load(loaded.layers, loaded.pieces);
    expect(restored.all().map((l) => [l.name, l.locked])).toEqual([['Capa 1', false], ['Torso', true]]);
    expect(loaded.pieces[0].layer).toBe(second.id);
    expect(loaded.pieces[1].layer).toBeUndefined();
    expect(restored.active).toBe(second.id);
  });

  it('un proyecto sin capas, o con una capa que no existe, vuelve a la base', () => {
    const layers = new Layers();
    const piece = cube();
    piece.layer = 9;
    layers.load({ layers: [{ id: 2, name: 'X' }] }, [piece]);
    expect(layers.all().map((l) => l.id)).toEqual([1, 2]);
    expect(piece.layer).toBeUndefined();
    layers.load(undefined);
    expect(layers.all().map((l) => l.id)).toEqual([1]);
  });
});
