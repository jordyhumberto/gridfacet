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
