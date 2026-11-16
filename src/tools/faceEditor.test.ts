import { beforeAll, describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import { withFaceTexture } from '../core/pixels';
import type { Piece } from '../core/piece';
import type { FaceTexture } from '../core/texture';
import { ModelScene } from '../scene';
import { FaceEditor } from './faceEditor';

type Handler = (e: unknown) => void;

/** Un lienzo y una raíz de mentira: lo justo para que el editor reciba punteros sin navegador. */
function fakeDom() {
  const handlers: Record<string, Handler> = {};
  const noop = new Proxy({}, { get: () => () => {}, set: () => true });
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => noop,
    addEventListener: (name: string, fn: Handler) => (handlers[name] = fn),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: canvas.width, height: canvas.height }),
    setPointerCapture: () => {},
  };
  const root = { hidden: true, addEventListener: () => {} };
  const pointer = (name: string, cellX: number, cellY: number, scale: number) => handlers[name]({ button: 0, clientX: (cellX + 0.5) * scale, clientY: (cellY + 0.5) * scale, pointerId: 1 });
  return { canvas, root, handlers, pointer };
}

function setup() {
  const dom = fakeDom();
  const model = new ModelScene();
  const piece = buildPiece(CATALOG[0], 0, 0, 0, 0, 0xff0000);
  model.apply({ added: [piece], removed: [] });
  const log = { previews: 0, reverts: 0 };
  const editor = new FaceEditor(dom.root as unknown as HTMLElement, dom.canvas as unknown as HTMLCanvasElement, {
    tool: () => 'pencil',
    size: () => 1,
    brush: () => ({}),
    color: () => 0x00ff00,
    pickColor: () => {},
    stillThere: (p: Piece) => model.all().some((q) => q.id === p.id),
    preview: () => void log.previews++,
    revert: () => void log.reverts++,
    commit: (p: Piece, faceIndex: number, texture: FaceTexture) => {
      const next = withFaceTexture(p, faceIndex, texture);
      model.apply({ added: [next], removed: [p] });
      return next;
    },
  });
  editor.open(piece, 0);
  const scale = dom.canvas.width / 16;
  return { ...dom, model, editor, log, piece, scale };
}

beforeAll(() => {
  (globalThis as { document?: unknown }).document ??= { addEventListener: () => {} };
});

describe('editor de una cara en plano', () => {
  it('un trazo normal deja una sola pieza con la textura pintada', () => {
    const s = setup();
    s.pointer('pointerdown', 2, 2, s.scale);
    s.pointer('pointermove', 5, 2, s.scale);
    s.handlers.pointerup(null);
    expect(s.model.all()).toHaveLength(1);
    expect(s.model.all()[0].faceTextures?.[0]).toBeTruthy();
    expect(s.log.previews).toBeGreaterThan(0);
  });

  it('Ctrl+Z en mitad de un trazo y soltar no duplica la pieza ni deja la vista previa', () => {
    const s = setup();
    // Un primer trazo, ya aplicado: el modelo tiene la versión pintada.
    s.pointer('pointerdown', 1, 1, s.scale);
    s.handlers.pointerup(null);
    expect(s.model.all()).toHaveLength(1);
    // Segundo trazo; en mitad de él se deshace el primero.
    s.pointer('pointerdown', 4, 4, s.scale);
    s.pointer('pointermove', 6, 4, s.scale);
    s.model.undo();
    s.handlers.pointerup(null);
    expect(s.model.all()).toHaveLength(1);
    expect(s.model.all()[0].faceTextures?.[0] ?? null).toBeNull();
    expect(s.log.reverts).toBeGreaterThan(0);
    expect(s.editor.isOpen).toBe(false);
  });

  it('seguir moviendo el puntero después de que desaparezca la pieza cierra el editor', () => {
    const s = setup();
    s.pointer('pointerdown', 1, 1, s.scale);
    s.handlers.pointerup(null);
    s.pointer('pointerdown', 4, 4, s.scale);
    s.model.undo();
    const previews = s.log.previews;
    s.pointer('pointermove', 6, 4, s.scale);
    expect(s.editor.isOpen).toBe(false);
    expect(s.log.previews).toBe(previews);
  });

  it('cerrar con un trazo en curso devuelve la vista 3D a lo que hay en el modelo', () => {
    const s = setup();
    s.pointer('pointerdown', 3, 3, s.scale);
    s.pointer('pointermove', 5, 3, s.scale);
    expect(s.log.previews).toBeGreaterThan(0);
    s.editor.close();
    expect(s.log.reverts).toBe(1);
    // Soltar después no aplica nada.
    s.handlers.pointerup(null);
    expect(s.model.all()[0].faceTextures?.[0] ?? null).toBeNull();
  });
});
