import { describe, expect, it } from 'vitest';
import { ModelScene } from './scene';
import { CATALOG, buildPiece } from './core/catalog';

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

describe('capa activa', () => {
  const cube = () => buildPiece(CATALOG[0], 0, 0, 0, 0, 0xffffff);

  it('una pieza nueva cae en la capa activa', () => {
    const model = new ModelScene();
    model.activeLayer = 2;
    const piece = cube();
    model.apply({ added: [piece], removed: [] });
    expect(model.get(piece.id)!.layer).toBe(2);
  });

  it('una pieza de la capa 1 sustituida con otra capa activa sigue sin capa', () => {
    const model = new ModelScene();
    const original = cube();
    model.apply({ added: [original], removed: [] });
    model.activeLayer = 2;
    const derived = cube();
    model.apply({ added: [derived], removed: [original] });
    expect(model.get(derived.id)!.layer).toBeUndefined();
  });
});

describe('historial', () => {
  it('clearHistory vacía deshacer y rehacer sin tocar las piezas', () => {
    const model = new ModelScene();
    const a = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xffffff);
    model.apply({ added: [a], removed: [] });
    model.apply({ added: [], removed: [a] });
    model.undo();
    expect(model.undoDepth).toBe(1);
    expect(model.redoDepth).toBe(1);
    model.clearHistory();
    expect(model.undoDepth).toBe(0);
    expect(model.redoDepth).toBe(0);
    model.undo();
    expect(model.get(a.id)).toBeDefined();
  });
});

describe('un arrastre que no cambia nada', () => {
  it('commitPreview con piezas iguales no añade un paso ni borra lo rehacible', () => {
    const model = new ModelScene();
    const piece = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    const other = buildPiece(CATALOG[0], 3, 0, 0, 0, 0x336699);
    model.apply({ added: [piece], removed: [] });
    model.apply({ added: [other], removed: [] });
    model.undo();
    expect(model.redoDepth).toBe(1);
    const depth = model.undoDepth;
    const serial = model.serial;
    // La pieza de la vista previa es otro objeto con la misma geometría.
    const copy = { ...piece, faces: piece.faces.map((face) => face.map((p) => [...p] as typeof p)) };
    model.preview({ added: [copy], removed: [piece] });
    model.commitPreview({ added: [copy], removed: [piece] });
    expect(model.undoDepth).toBe(depth);
    expect(model.redoDepth).toBe(1);
    expect(model.serial).toBe(serial);
  });

  it('commitPreview con una pieza movida sí se anota', () => {
    const model = new ModelScene();
    const piece = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
    model.apply({ added: [piece], removed: [] });
    const moved = { ...piece, faces: piece.faces.map((face) => face.map((p) => [p[0] + 1, p[1], p[2]] as typeof p)) };
    model.preview({ added: [moved], removed: [piece] });
    model.commitPreview({ added: [moved], removed: [piece] });
    expect(model.undoDepth).toBe(2);
  });
});

describe('suscriptores de cambios', () => {
  it('avisan en orden, el primero va delante y se pueden dar de baja', () => {
    const model = new ModelScene();
    const order: string[] = [];
    model.subscribe(() => order.push('a'));
    const offB = model.subscribe(() => order.push('b'));
    model.subscribe(() => order.push('primero'), true);
    model.apply({ added: [], removed: [], marksAdded: [[1, 2, 3]] });
    expect(order).toEqual(['primero', 'a', 'b']);
    offB();
    order.length = 0;
    model.undo();
    expect(order).toEqual(['primero', 'a']);
  });
});
