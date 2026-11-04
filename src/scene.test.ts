import { describe, expect, it } from 'vitest';
import { ModelScene } from './scene';

describe('puntos de referencia', () => {
  it('se añaden, se deshacen y se rehacen', () => {
    const model = new ModelScene();
    model.apply({ added: [], removed: [], marksAdded: [[1, 2, 3]] });
    expect(model.points()).toEqual([[1, 2, 3]]);
    model.undo();
    expect(model.points()).toEqual([]);
    model.redo();
    expect(model.points()).toEqual([[1, 2, 3]]);
  });

  it('añadir un punto que ya existe no crea un paso del historial', () => {
    const model = new ModelScene();
    model.apply({ added: [], removed: [], marksAdded: [[1, 2, 3]] });
    model.apply({ added: [], removed: [], marksAdded: [[1, 2, 3]] });
    model.undo();
    expect(model.points()).toEqual([]);
  });

  it('quitar un punto se deshace', () => {
    const model = new ModelScene();
    model.apply({ added: [], removed: [], marksAdded: [[0, 0, 0], [1, 1, 1]] });
    model.apply({ added: [], removed: [], marksRemoved: [[0, 0, 0]] });
    expect(model.points()).toEqual([[1, 1, 1]]);
    model.undo();
    expect(model.points()).toHaveLength(2);
  });
});

describe('vista previa de un arrastre', () => {
  it('varios cambios en vivo se anotan como un solo paso de deshacer', async () => {
    const { CATALOG, buildPiece } = await import('./core/catalog');
    const { moveVertices, uniqueVertices, vertexKey } = await import('./core/vertices');
    const model = new ModelScene();
    const original = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    model.apply({ added: [original], removed: [] });
    const corner = uniqueVertices(original)[0];
    const keys = new Set([vertexKey(corner)]);
    let current = original;
    for (const dy of [0.25, 0.5, 0.75]) {
      const moved = moveVertices(original, keys, [0, dy, 0], true)!;
      model.preview({ added: [moved], removed: [current] });
      current = moved;
    }
    // Las piezas conservan el id durante la vista previa.
    expect(model.all().map((p) => p.id)).toEqual([original.id]);
    model.commitPreview({ added: [current], removed: [original] });
    expect(model.get(original.id)).toBe(current);
    model.undo();
    expect(model.get(original.id)).toBe(original);
    model.redo();
    expect(model.get(original.id)).toBe(current);
  });
});
