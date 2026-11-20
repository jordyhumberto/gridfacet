import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import { makePiece, type Piece, type Vec3 } from '../core/piece';
import { PLANE_XY, PLANE_XZ, PLANE_YZ } from '../core/axisLock';
import { translatePiece } from '../core/transform';
import { moveVertices, scaleAbout, splitEdge, uniqueVertices, vertexKey } from '../core/vertices';
import { ModelScene } from '../scene';
import { MeshTool } from './meshTool';

/** Una herramienta de Malla sobre un modelo real, con simetría en X y una pieza que cruza el plano. */
function setup(options: { selected?: () => Piece[] } = {}) {
  const model = new ModelScene();
  const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
  const xs = uniqueVertices(cube).map((p) => p[0]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const piece = translatePiece(cube, -centerX, 0, 0);
  model.apply({ added: [piece], removed: [] });
  const messages: string[] = [];
  const handlers = new Map<string, ((e: unknown) => void)[]>();
  const hidden = new Set<number>();
  let consumed = 0;
  let selectionChanges = 0;
  const camera = new THREE.PerspectiveCamera();
  const el = { addEventListener(type: string, fn: (e: unknown) => void) { handlers.set(type, [...(handlers.get(type) ?? []), fn]); }, removeEventListener() {}, dispatchEvent() { return true; }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
  const symmetry = { x: true, y: false, z: false, center: [0, 0, 0] as Vec3 };
  const tool = new MeshTool({
    scene: new THREE.Scene(),
    camera,
    domElement: el,
    setOrbit: () => {},
    model,
    selectedPieces: options.selected ?? (() => []),
    isHidden: (p: Piece) => hidden.has(p.id),
    symmetry: () => symmetry,
    status: (message: string) => messages.push(message),
    onSelectionChange: () => selectionChanges++,
    consumed: () => consumed++,
  });
  tool.activate();
  const choose = (predicate: (p: Vec3) => boolean) => {
    const current = model.all()[0];
    const keys = new Set(uniqueVertices(current).filter(predicate).map(vertexKey));
    (tool as unknown as { selection: Map<number, Set<string>> }).selection = new Map([[current.id, keys]]);
    tool.refresh();
  };
  return { model, tool, choose, messages, camera, hidden, handlers, consumedCount: () => consumed, selectionChanges: () => selectionChanges };
}

/** Cada vértice tiene su imagen en espejo en X, y cada cara la suya. */
function isSymmetric(pieces: Piece[]): boolean {
  const keys = new Set(pieces.flatMap((piece) => uniqueVertices(piece).map(vertexKey)));
  const mirrored = (p: Vec3) => vertexKey([-p[0], p[1], p[2]]);
  // Cada segmento suelto tiene su imagen en espejo.
  const segments = new Set(pieces.flatMap((piece) => (piece.segments ?? []).map(([a, b]) => [vertexKey(a), vertexKey(b)].sort().join('>'))));
  if (!pieces.every((piece) => (piece.segments ?? []).every(([a, b]) => segments.has([mirrored(a), mirrored(b)].sort().join('>'))))) return false;
  if (!pieces.every((piece) => uniqueVertices(piece).every((p) => keys.has(mirrored(p))))) return false;
  const faces = new Set(pieces.flatMap((piece) => piece.faces.map((face) => face.map(vertexKey).sort().join('|'))));
  return pieces.every((piece) => piece.faces.every((face) => faces.has(face.map(mirrored).sort().join('|'))));
}

describe('Malla con simetría y una pieza que cruza el espejo', () => {
  it('el punto de partida es simétrico', () => {
    const { model } = setup();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('borrar un vértice de un lado quita también el del otro', () => {
    const { model, tool, choose } = setup();
    const top = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[1]));
    choose((p) => p[0] > 0 && p[1] === top && p[2] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[2])));
    tool.deleteSelected();
    expect(isSymmetric(model.all())).toBe(true);
    expect(model.all().flatMap(uniqueVertices)).toHaveLength(6);
  });

  it('borrar una cara de un lado quita también su espejo', () => {
    const { model, tool, choose } = setup();
    const faces = model.all()[0].faces.length;
    const front = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[2]));
    choose((p) => p[2] === front);
    tool.deleteFacesSelected();
    expect(isSymmetric(model.all())).toBe(true);
    expect(model.all()[0].faces.length).toBe(faces - 1);
  });

  it('fusionar dos vértices de un lado fusiona también los del otro', () => {
    const { model, tool, choose } = setup();
    const top = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[1]));
    choose((p) => p[0] > 0 && p[1] === top);
    tool.mergeSelected();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('girar las caras, extruir y deshacer mantienen la simetría', () => {
    const { model, tool, choose } = setup();
    const front = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[2]));
    choose((p) => p[2] === front && p[0] > 0);
    tool.flipSelected();
    expect(isSymmetric(model.all())).toBe(true);
    tool.extrudeSelected(0.5);
    expect(isSymmetric(model.all())).toBe(true);
    model.undo();
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('tapar hueco cierra el hueco y también su espejo', () => {
    const { model, tool, choose } = setup();
    const faces = model.all()[0].faces.length;
    const right = Math.max(...uniqueVertices(model.all()[0]).map((p) => p[0]));
    // Se quitan las dos caras de los lados (la de la derecha y su espejo) y se vuelve a cerrar eligiendo un solo vértice.
    choose((p) => p[0] === right);
    tool.deleteFacesSelected();
    expect(model.all()[0].faces.length).toBe(faces - 2);
    expect(isSymmetric(model.all())).toBe(true);
    choose((p) => p[0] === right && p[1] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[1])) && p[2] === Math.max(...uniqueVertices(model.all()[0]).map((q) => q[2])));
    tool.fillHolesSelected();
    expect(model.all()[0].faces.length).toBe(faces);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('triangular parte las caras y se deshace (una cara que cruza el espejo no puede quedar con diagonales simétricas)', () => {
    const { model, tool, choose } = setup();
    choose(() => true);
    tool.triangulateSelected();
    expect(model.all()[0].faces).toHaveLength(12);
    expect(uniqueVertices(model.all()[0])).toHaveLength(8);
    model.undo();
    expect(model.all()[0].faces).toHaveLength(6);
  });

  it('biselar una arista de un lado bisela también la del otro', () => {
    const { model, tool, choose } = setup();
    const verts = uniqueVertices(model.all()[0]);
    const right = Math.max(...verts.map((p) => p[0]));
    const top = Math.max(...verts.map((p) => p[1]));
    choose((p) => p[0] === right && p[1] === top);
    tool.bevelSelected();
    expect(model.all()[0].faces).toHaveLength(8);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('corte en anillo parte las caras de la vuelta y deja el modelo simétrico', () => {
    const { model, tool, choose } = setup();
    const verts = uniqueVertices(model.all()[0]);
    const right = Math.max(...verts.map((p) => p[0]));
    const front = Math.max(...verts.map((p) => p[2]));
    // Arista vertical de la derecha y delante: el anillo da la vuelta por las cuatro caras laterales.
    choose((p) => p[0] === right && p[2] === front);
    tool.ringCutSelected();
    expect(model.all()[0].faces).toHaveLength(6 - 4 + 8);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('Simetrizar arregla un modelo que se descuadró y se deshace de un paso', () => {
    const { model, tool, choose } = setup();
    const piece = model.all()[0];
    const right = uniqueVertices(piece).filter((p) => p[0] > 0)[0];
    model.apply({ added: [translateOne(piece, right, [0.01, 0.005, 0])], removed: [piece] });
    expect(isSymmetric(model.all())).toBe(false);
    choose(() => false);
    tool.symmetrizeAll();
    expect(isSymmetric(model.all())).toBe(true);
    model.undo();
    expect(isSymmetric(model.all())).toBe(false);
  });
});

function translateOne(piece: Piece, at: Vec3, delta: Vec3): Piece {
  return moveVertices(piece, new Set([vertexKey(at)]), delta)!;
}

describe('teclas de Malla sin vértices elegidos', () => {
  const key = (name: string) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;

  it('Supr y Retroceso sin vértices elegidos no hacen nada y explican qué hacer', () => {
    for (const name of ['Delete', 'Backspace']) {
      const { model, tool, messages } = setup();
      const before = model.all()[0];
      expect(tool.handleKey(key(name))).toBe(true);
      expect(model.all()).toEqual([before]);
      expect(model.undoDepth).toBe(1);
      expect(messages.at(-1)).toContain('Borrar vértices (Supr)');
    }
  });
});

/** Simula un arrastre de los vértices elegidos (con sus imágenes en espejo) y lo suelta. */
function dragChosen(tool: MeshTool, delta: Vec3): void {
  const inner = tool as unknown as { buildTargets: () => unknown[]; pendingBefore: unknown; drag: unknown; preview: (d: Vec3) => void; finishDrag: (commit: boolean) => void; selection: Map<number, Set<string>> };
  inner.pendingBefore = new Map([...inner.selection].map(([id, keys]) => [id, new Set(keys)]));
  inner.drag = { targets: inner.buildTargets(), anchor: [0, 0, 0], plane: null, grab: null, startX: 0, startY: 0, moved: true, delta };
  inner.preview(delta);
  inner.finishDrag(true);
}

/** Posiciones de los vértices elegidos de la pieza. */
function chosenPositions(model: ModelScene, tool: MeshTool): Vec3[] {
  const selection = (tool as unknown as { selection: Map<number, Set<string>> }).selection;
  return [...selection].flatMap(([id, keys]) => uniqueVertices(model.get(id)!).filter((p) => keys.has(vertexKey(p))));
}

describe('la elección tras una operación se queda en el lado elegido (no crece al espejo)', () => {
  const extremes = (model: ModelScene) => {
    const verts = uniqueVertices(model.all()[0]);
    return { right: Math.max(...verts.map((p) => p[0])), top: Math.max(...verts.map((p) => p[1])), bottom: Math.min(...verts.map((p) => p[1])), front: Math.max(...verts.map((p) => p[2])), back: Math.min(...verts.map((p) => p[2])) };
  };
  /** Cada caso elige vértices de la derecha, ejecuta la operación y dice si el resultado tiene que ser simétrico. */
  const cases: { name: string; prepare?: (model: ModelScene) => void; run: (s: ReturnType<typeof setup>) => void; symmetric: boolean }[] = [
    {
      name: 'Trazar segmento (U)',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right && ((p[1] === e.top && p[2] === e.front) || (p[1] === e.bottom && p[2] === e.back)));
        tool.connectSelected();
      },
      symmetric: true,
    },
    {
      name: 'Alinear en línea (L)',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right);
        tool.straightenSelected();
      },
      symmetric: true,
    },
    {
      name: 'Aplanar en plano (P)',
      prepare: (model) => {
        const e = extremes(model);
        // Se tuerce de forma simétrica una esquina de cada lado para que haya algo que aplanar.
        const piece = model.all()[0];
        const corner = (x: number): Vec3 => uniqueVertices(piece).find((p) => p[0] === x && p[1] === e.top && p[2] === e.front)!;
        const twisted = moveVertices(moveVertices(piece, new Set([vertexKey(corner(e.right))]), [0.2, 0, 0])!, new Set([vertexKey(corner(-e.right))]), [-0.2, 0, 0])!;
        model.apply({ added: [twisted], removed: [piece] });
      },
      run: ({ tool, choose }) => {
        choose((p) => p[0] > 0);
        tool.flattenSelected();
      },
      symmetric: true,
    },
    {
      name: 'Extruir cara',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right);
        tool.extrudeSelected(0.5);
      },
      symmetric: true,
    },
    {
      name: 'Punta',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right && p[1] === e.top);
        tool.tipSelected(0.5);
      },
      symmetric: true,
    },
    {
      name: 'Cara desde segmento',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right && p[1] === e.top);
        tool.growFaceFromEdge(0.5);
      },
      symmetric: true,
    },
    {
      name: 'Biselar',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right && p[1] === e.top);
        tool.bevelSelected();
      },
      symmetric: true,
    },
    {
      name: 'Corte en anillo',
      run: ({ model, tool, choose }) => {
        const e = extremes(model);
        choose((p) => p[0] === e.right && p[2] === e.front);
        tool.ringCutSelected();
      },
      symmetric: true,
    },
  ];

  for (const { name, prepare, run, symmetric } of cases) {
    it(`${name}: los vértices elegidos siguen en un solo lado y un arrastre deja el modelo simétrico`, () => {
      const s = setup();
      prepare?.(s.model);
      const depth = s.model.undoDepth;
      run(s);
      expect(s.model.undoDepth).toBeGreaterThan(depth);
      if (symmetric) expect(isSymmetric(s.model.all())).toBe(true);
      const chosen = chosenPositions(s.model, s.tool);
      expect(chosen.length).toBeGreaterThan(0);
      expect(chosen.every((p) => p[0] >= -1e-9)).toBe(true);
      dragChosen(s.tool, [0.1, 0.05, 0.05]);
      if (symmetric) expect(isSymmetric(s.model.all())).toBe(true);
    });
  }
});

describe('Simetrizar conserva la pieza', () => {
  it('la pieza sigue con el mismo id (y la elección sigue siendo suya)', () => {
    const { model, tool, choose } = setup();
    const piece = model.all()[0];
    const right = uniqueVertices(piece).filter((p) => p[0] > 0)[0];
    model.apply({ added: [translateOne(piece, right, [0.01, 0.005, 0])], removed: [piece] });
    const before = model.all()[0];
    choose((p) => p[0] > 0);
    tool.symmetrizeAll();
    expect(model.all()).toHaveLength(1);
    expect(model.all()[0].id).toBe(before.id);
    const selection = (tool as unknown as { selection: Map<number, Set<string>> }).selection;
    expect([...selection.keys()]).toEqual([before.id]);
  });
});

describe('Biselar con simetría es todo o nada', () => {
  const edgeOnTop = (choose: ReturnType<typeof setup>['choose'], model: ModelScene) => {
    const verts = uniqueVertices(model.all()[0]);
    const right = Math.max(...verts.map((p) => p[0]));
    const top = Math.max(...verts.map((p) => p[1]));
    choose((p) => p[0] === right && p[1] === top);
  };

  it('con un tamaño que no cabe en los dos lados no cambia nada y dice el máximo', () => {
    const { model, tool, choose, messages } = setup();
    const before = model.all()[0];
    edgeOnTop(choose, model);
    tool.bevelSize = 0.6;
    tool.bevelSelected();
    expect(model.all()).toEqual([before]);
    expect(model.undoDepth).toBe(1);
    expect(messages.at(-1)).toContain('0.49');
  });

  it('con un tamaño que cabe bisela los dos lados y el modelo queda simétrico', () => {
    const { model, tool, choose } = setup();
    edgeOnTop(choose, model);
    tool.bevelSize = 0.25;
    tool.bevelSelected();
    expect(model.all()[0].faces).toHaveLength(8);
    expect(isSymmetric(model.all())).toBe(true);
  });
});

describe('ejes con las teclas 1, 2 y 3 (X, Y y Z son de la simetría)', () => {
  const key = (name: string, code = '', shift = false) => ({ key: name, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: shift }) as KeyboardEvent;
  const digit = (n: number, shift = false) => key(shift ? ['!', '@', '#'][n - 1] : String(n), `Digit${n}`, shift);
  it('con vértices elegidos, Digit1/2/3 fijan el eje X/Y/Z y volver a pulsar lo suelta', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    expect(s.tool.handleKey(digit(1))).toBe(true);
    expect(s.tool.axis).toBe(0);
    expect(s.tool.handleKey(digit(2))).toBe(true);
    expect(s.tool.axis).toBe(1);
    expect(s.tool.handleKey(digit(3))).toBe(true);
    expect(s.tool.axis).toBe(2);
    expect(s.tool.handleKey(digit(3))).toBe(true);
    expect(s.tool.axis).toBeNull();
  });

  it('Mayús+dígito fija el plano que deja fuera ese eje', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    s.tool.handleKey(digit(1, true));
    expect(s.tool.axis).toBe(PLANE_YZ);
    s.tool.handleKey(digit(2, true));
    expect(s.tool.axis).toBe(PLANE_XZ);
    s.tool.handleKey(digit(3, true));
    expect(s.tool.axis).toBe(PLANE_XY);
  });

  it('x, y y z no las toma Malla (devuelve false: llegan a la simetría) y no tocan el eje', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    for (const name of ['x', 'y', 'z', 'X']) expect(s.tool.handleKey(key(name, `Key${name.toUpperCase()}`)), name).toBe(false);
    expect(s.tool.axis).toBeNull();
  });

  it('el teclado numérico no fija el eje (son las vistas de cámara)', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    expect(s.tool.handleKey(key('1', 'Numpad1'))).toBe(false);
    expect(s.tool.axis).toBeNull();
  });

  it('sin vértices elegidos Digit1 devuelve false (sigue cambiando de herramienta)', () => {
    const s = setup();
    expect(s.tool.handleKey(digit(1))).toBe(false);
    expect(s.tool.axis).toBeNull();
  });

  it('en un modal, los dígitos limitan el eje y x, y, z se consumen sin hacer nada', () => {
    const s = setup();
    s.choose(() => true);
    s.tool.beginTransform('rotate');
    const modal = () => (s.tool as unknown as { modal: { axis: number | null } }).modal;
    expect(s.tool.handleKey(digit(3))).toBe(true);
    expect(modal().axis).toBe(2);
    expect(s.tool.handleKey(digit(1))).toBe(true);
    expect(modal().axis).toBe(0);
    expect(s.tool.handleKey(digit(1))).toBe(true);
    expect(modal().axis).toBeNull();
    for (const name of ['x', 'y', 'z']) expect(s.tool.handleKey(key(name, `Key${name.toUpperCase()}`)), name).toBe(true);
    expect(modal().axis).toBeNull();
    s.tool.handleKey(key('Escape'));
  });

  it('en un arrastre en marcha, x, y y z se consumen (no cambian la simetría) y los dígitos fijan el eje', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    const inner = s.tool as unknown as { buildTargets: () => unknown[]; drag: unknown; preview: (d: Vec3) => void };
    inner.drag = { targets: inner.buildTargets(), anchor: [0, 0, 0], plane: null, grab: null, startX: 0, startY: 0, moved: true, delta: [0.1, 0, 0] };
    inner.preview([0.1, 0, 0]);
    for (const name of ['x', 'y', 'z']) expect(s.tool.handleKey(key(name, `Key${name.toUpperCase()}`)), name).toBe(true);
    expect(s.tool.handleKey(digit(2))).toBe(true);
    expect(s.tool.axis).toBe(1);
  });
});

describe('con un arrastre, un modal o un recuadro en marcha', () => {
  const key = (name: string, ctrl = false, shift = false) => ({ key: name, ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: shift }) as KeyboardEvent;
  /** Empieza un arrastre simulado de los vértices elegidos de la derecha, sin soltarlo. */
  function startDrag(s: ReturnType<typeof setup>) {
    s.choose((p) => p[0] > 0);
    const inner = s.tool as unknown as { buildTargets: () => unknown[]; drag: unknown; preview: (d: Vec3) => void; pendingBefore: unknown };
    inner.drag = { targets: inner.buildTargets(), anchor: [0, 0, 0], plane: null, grab: null, startX: 0, startY: 0, moved: true, delta: [0.1, 0, 0] };
    inner.preview([0.1, 0, 0]);
  }

  it('Ctrl+Z, Ctrl+Y y Supr se ignoran durante un arrastre', () => {
    const s = setup();
    startDrag(s);
    expect(s.tool.busy).toBe(true);
    const during = s.model.all();
    const depth = s.model.undoDepth;
    for (const e of [key('z', true), key('y', true), key('z', true, true), key('Delete'), key('Backspace')]) {
      expect(s.tool.handleKey(e)).toBe(true);
    }
    expect(s.model.all()).toEqual(during);
    expect(s.model.undoDepth).toBe(depth);
    expect(s.model.redoDepth).toBe(0);
  });

  it('R y T no empiezan un modal con el recuadro activo', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    (s.tool as unknown as { marquee: unknown }).marquee = { x: 0, y: 0, add: false };
    expect(s.tool.busy).toBe(true);
    s.tool.handleKey(key('r'));
    s.tool.handleKey(key('t'));
    expect((s.tool as unknown as { modal: unknown }).modal).toBeNull();
  });

  it('las acciones del panel no hacen nada con un arrastre en marcha', () => {
    const s = setup();
    startDrag(s);
    const during = s.model.all();
    const depth = s.model.undoDepth;
    s.tool.deleteSelected();
    s.tool.extrudeSelected();
    s.tool.beginTransform('scale');
    expect(s.model.all()).toEqual(during);
    expect(s.model.undoDepth).toBe(depth);
    expect((s.tool as unknown as { modal: unknown }).modal).toBeNull();
  });
});

describe('un arrastre sin desplazamiento', () => {
  it('no anota un paso de deshacer ni deja la elección de antes sin su paso', () => {
    const { model, tool, choose } = setup();
    choose((p) => p[0] > 0);
    const depth = model.undoDepth;
    const before = model.all()[0];
    dragChosen(tool, [0, 0, 0]);
    expect(model.undoDepth).toBe(depth);
    expect(model.all()[0].faces).toEqual(before.faces);
    // Un arrastre de verdad después sigue anotándose.
    dragChosen(tool, [0.1, 0, 0]);
    expect(model.undoDepth).toBe(depth + 1);
  });

  it('un giro o escala sin movimiento del ratón tampoco', () => {
    const { model, tool, choose } = setup();
    choose((p) => p[0] > 0);
    const depth = model.undoDepth;
    tool.beginTransform('scale');
    const inner = tool as unknown as { modal: { moved: boolean }; finishModal: (commit: boolean) => void };
    inner.modal.moved = true;
    inner.finishModal(true);
    expect(model.undoDepth).toBe(depth);
  });
});

describe('un vértice sobre el plano de simetría no se sale de él', () => {
  /** Un cubo con un vértice puesto en medio de la arista de arriba y delante, justo sobre el plano X=0. */
  function withPlaneVertex() {
    const s = setup();
    const piece = s.model.all()[0];
    const verts = uniqueVertices(piece);
    const right = Math.max(...verts.map((p) => p[0]));
    const top = Math.max(...verts.map((p) => p[1]));
    const front = Math.max(...verts.map((p) => p[2]));
    const back = Math.min(...verts.map((p) => p[2]));
    const a = verts.find((p) => p[0] === -right && p[1] === top && p[2] === front)!;
    const b = verts.find((p) => p[0] === right && p[1] === top && p[2] === front)!;
    const split = splitEdge(piece, a, b, 0.5)!;
    s.model.apply({ added: [{ ...split.piece, id: piece.id }], removed: [piece] });
    s.choose((p) => (Math.abs(p[0]) < 1e-9 && p[1] === top && p[2] === front) || (p[0] === right && p[1] === top && p[2] === back));
    return { ...s, top, front, right };
  }
  const near = (list: Vec3[], q: Vec3) => list.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-6);

  it('al arrastrar por el otro vértice, el del plano conserva su X', () => {
    const { model, tool, top, front } = withPlaneVertex();
    dragChosen(tool, [0.2, 0.1, 0]);
    const verts = uniqueVertices(model.all()[0]);
    expect(near(verts, [0, top + 0.1, front])).toBe(true);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('al escalar o girar con esa elección, el del plano conserva su X', () => {
    const { model, tool, top, front } = withPlaneVertex();
    const inner = tool as unknown as { buildTargets: () => unknown[]; previewMap: (targets: unknown[], map: (p: Vec3) => Vec3) => void };
    inner.previewMap(inner.buildTargets(), (p) => scaleAbout(p, [0.3, 0, 0], [1.5, 1.5, 1.5]));
    expect(near(uniqueVertices(model.all()[0]), [0, top * 1.5, front * 1.5])).toBe(true);
    expect(isSymmetric(model.all())).toBe(true);
  });
});

describe('pequeños de Malla', () => {
  const selectionOf = (tool: MeshTool) => (tool as unknown as { selection: Map<number, Set<string>> }).selection;

  it('una pieza que deja de mostrarse suelta su elección y Supr no borra vértices invisibles', () => {
    const { model, tool, choose, hidden } = setup();
    choose((p) => p[0] > 0);
    expect(selectionOf(tool).size).toBe(1);
    hidden.add(model.all()[0].id);
    tool.refresh();
    expect(selectionOf(tool).size).toBe(0);
    const before = model.all()[0];
    tool.deleteSelected();
    expect(model.all()).toEqual([before]);
  });

  it('una pieza bloqueada también suelta su elección', () => {
    const { model, tool, choose } = setup();
    choose((p) => p[0] > 0);
    model.isLocked = () => true;
    tool.refresh();
    expect(selectionOf(tool).size).toBe(0);
  });

  it('desactivar limpia el clic de segmento pendiente y el doble clic', () => {
    const { tool } = setup();
    const inner = tool as unknown as { pendingEdge: unknown; lastEdgeClick: unknown };
    inner.pendingEdge = { x: 1, y: 1 };
    inner.lastEdgeClick = { time: 0, a: 'a', b: 'b', id: 1 };
    tool.deactivate();
    expect(inner.pendingEdge).toBeNull();
    expect(inner.lastEdgeClick).toBeNull();
  });

  it('A la rejilla redondea el lado elegido y refleja: con el centro fuera de la rejilla el modelo sigue simétrico', () => {
    const model = new ModelScene();
    const piece = translatePiece(buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699), 0.37, 0, 0);
    const xs = uniqueVertices(piece).map((p) => p[0]);
    const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
    model.apply({ added: [piece], removed: [] });
    const symmetry = { x: true, y: false, z: false, center: [centre, 0, 0] as Vec3 };
    const el = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
    const tool = new MeshTool({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), domElement: el, setOrbit: () => {}, model, selectedPieces: () => [], isHidden: () => false, symmetry: () => symmetry, status: () => {}, onSelectionChange: () => {} });
    tool.activate();
    const mirrored = (p: Vec3) => vertexKey([2 * centre - p[0], p[1], p[2]]);
    const symmetricAround = () => {
      const keys = new Set(uniqueVertices(model.all()[0]).map(vertexKey));
      return uniqueVertices(model.all()[0]).every((p) => keys.has(mirrored(p)));
    };
    expect(symmetricAround()).toBe(true);
    const current = model.all()[0];
    (tool as unknown as { selection: Map<number, Set<string>> }).selection = new Map([[current.id, new Set(uniqueVertices(current).filter((p) => p[0] > centre).map(vertexKey))]]);
    tool.refresh();
    tool.snapToGrid();
    expect(symmetricAround()).toBe(true);
  });

  it('con una mitad elegida y el gemelo en otra pieza, no sale todo en rosa', () => {
    const model = new ModelScene();
    const left = makeTriangle(-1);
    const right = makeTriangle(1);
    model.apply({ added: [left, right], removed: [] });
    const symmetry = { x: true, y: false, z: false, center: [0, 0, 0] as Vec3 };
    const el = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
    const tool = new MeshTool({ scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), domElement: el, setOrbit: () => {}, model, selectedPieces: () => [right], isHidden: () => false, symmetry: () => symmetry, status: () => {}, onSelectionChange: () => {} });
    tool.activate();
    expect(tool.unpairedCount).toBe(0);
  });

  it('Escalar con un salto grande del ratón dice el valor que se aplicó, no el pedido', () => {
    const { tool, choose, messages, camera } = setup();
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld(true);
    choose((p) => p[0] > 0);
    tool.beginTransform('scale');
    const inner = tool as unknown as { modal: { last: { x: number; y: number; free: boolean } | null; value: number }; updateModal: () => void };
    inner.modal.last = { x: 600, y: 300, free: true };
    inner.updateModal();
    inner.modal.last = { x: 790, y: 300, free: true };
    inner.updateModal();
    const applied = inner.modal.value;
    expect(applied).toBeGreaterThan(1);
    expect(applied).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(messages.at(-1)).toContain(`×${applied.toFixed(2)}`);
  });

  it('un clic que la herramienta consume avisa al anfitrión (para que no le quede un pulsar viejo)', () => {
    const { tool, handlers, consumedCount, camera } = setup();
    camera.position.set(0, 0, 5);
    camera.updateMatrixWorld(true);
    void tool;
    const event = { button: 0, shiftKey: true, altKey: false, ctrlKey: false, metaKey: false, clientX: 400, clientY: 300, pointerId: 1, stopImmediatePropagation() {}, preventDefault() {} };
    for (const fn of handlers.get('pointerdown') ?? []) fn(event);
    expect(consumedCount()).toBe(1);
  });
});

function makeTriangle(side: number) {
  return makePiece([[[side, 0, 0], [side * 2, 0, 0], [side, 1, 0]]], 0x336699);
}

describe('Soldar cercanos con simetría', () => {
  /** El cubo cruzado por el espejo, con la cara de delante abierta 1 mm en sus esquinas de arriba: R' y L' casi encima de R y L. */
  function withGaps() {
    const ctx = setup();
    const piece = ctx.model.all()[0];
    const verts = uniqueVertices(piece);
    const top = Math.max(...verts.map((p) => p[1]));
    const front = Math.max(...verts.map((p) => p[2]));
    const faces = piece.faces.map((face) =>
      face.every((p) => p[2] === front) ? face.map((p) => (p[1] === top ? ([p[0] + Math.sign(p[0]) * 0.001, p[1], p[2]] as Vec3) : p)) : face,
    );
    const gapped = makePiece(faces, piece.color);
    ctx.model.apply({ added: [gapped], removed: [piece] });
    ctx.tool.refresh();
    return { ...ctx, top, front };
  }

  it('sin elección suelta todos los pares cercanos y deja el modelo simétrico', () => {
    const { model, tool, messages } = withGaps();
    expect(isSymmetric(model.all())).toBe(true);
    const before = uniqueVertices(model.all()[0]).length;
    const depth = model.undoDepth;
    tool.weldNearby(0.002);
    expect(uniqueVertices(model.all()[0]).length).toBe(before - 2);
    expect(isSymmetric(model.all())).toBe(true);
    expect(model.undoDepth).toBe(depth + 1);
    expect(messages[messages.length - 1]).toMatch(/2 vértices soldados/);
  });

  it('con un lado elegido también suelda su espejo', () => {
    const { model, tool, choose, top, front } = withGaps();
    const before = uniqueVertices(model.all()[0]).length;
    choose((p) => p[0] > 0 && p[1] === top && p[2] === front);
    tool.weldNearby(0.002);
    expect(uniqueVertices(model.all()[0]).length).toBe(before - 2);
    expect(isSymmetric(model.all())).toBe(true);
  });

  it('si no hay nada cerca lo dice y no crea un paso de deshacer', () => {
    const { model, tool, messages } = setup();
    const depth = model.undoDepth;
    tool.weldNearby(0.002);
    expect(model.undoDepth).toBe(depth);
    expect(messages[messages.length - 1]).toMatch(/ningún vértice/i);
  });
});

describe('Malla vuelve a calcular lo caro solo cuando hace falta', () => {
  it('durante un arrastre solo se mueven los puntos; el panel y los avisos se ponen al día al soltar', () => {
    const s = setup();
    s.model.subscribe(() => s.tool.refresh());
    s.choose((p) => p[0] > 0);
    const inner = s.tool as unknown as { buildTargets: () => unknown[]; drag: unknown; preview: (d: Vec3) => void; pendingBefore: unknown; finishDrag: (commit: boolean) => void };
    inner.pendingBefore = new Map();
    inner.drag = { targets: inner.buildTargets(), anchor: [0, 0, 0], plane: null, grab: null, startX: 0, startY: 0, moved: true, delta: [0.1, 0, 0] };
    const before = s.selectionChanges();
    inner.preview([0.1, 0, 0]);
    inner.preview([0.2, 0, 0]);
    expect(s.selectionChanges()).toBe(before);
    inner.finishDrag(true);
    expect(s.selectionChanges()).toBeGreaterThan(before);
  });

  it('los vértices sin gemelo se ponen al día cuando cambia una pieza o la simetría, aunque se recuerden entre llamadas', () => {
    const s = setup();
    s.model.subscribe(() => s.tool.refresh());
    s.tool.refresh();
    expect(s.tool.unpairedCount).toBe(0);
    // Un vértice de un solo lado se mueve sin su espejo: pierde el gemelo.
    const piece = s.model.all()[0];
    const corner = uniqueVertices(piece).find((p) => p[0] > 0)!;
    const moved = moveVertices(piece, new Set([vertexKey(corner)]), [0.1, 0, 0], true)!;
    s.model.apply({ added: [moved], removed: [piece] });
    expect(s.tool.unpairedCount).toBeGreaterThan(0);
    // Sin ningún cambio, repetir no altera el resultado.
    const count = s.tool.unpairedCount;
    s.tool.refresh();
    expect(s.tool.unpairedCount).toBe(count);
    s.model.undo();
    expect(s.tool.unpairedCount).toBe(0);
  });
});

describe('giros, escalas y deformaciones simulados con el ratón', () => {
  const key = (name: string) => ({ key: name, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }) as KeyboardEvent;
  const mouse = (s: ReturnType<typeof setup>, x: number, y: number) => {
    for (const fn of s.handlers.get('pointermove') ?? []) fn({ clientX: x, clientY: y, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, buttons: 0 });
  };
  const bounds = (model: ModelScene) => {
    const verts = uniqueVertices(model.all()[0]);
    return { top: Math.max(...verts.map((p) => p[1])), bottom: Math.min(...verts.map((p) => p[1])), wide: Math.max(...verts.map((p) => p[0])) - Math.min(...verts.map((p) => p[0])) };
  };

  it('afinar con el ratón y Esc deja el modelo como estaba y sin paso de deshacer', () => {
    const s = setup();
    s.choose(() => true);
    const before = s.model.all()[0].faces;
    const depth = s.model.undoDepth;
    s.tool.beginTransform('taper');
    mouse(s, 100, 100);
    mouse(s, 220, 100);
    expect(s.tool.busy).toBe(true);
    expect(JSON.stringify(s.model.all()[0].faces)).not.toBe(JSON.stringify(before));
    s.tool.handleKey(key('Escape'));
    expect(s.tool.busy).toBe(false);
    expect(s.model.all()[0].faces).toEqual(before);
    expect(s.model.undoDepth).toBe(depth);
  });

  it('afinar con el ratón e Intro es un solo paso de deshacer, simétrico, y se deshace entero', () => {
    const s = setup();
    s.choose(() => true);
    const before = s.model.all()[0].faces;
    const depth = s.model.undoDepth;
    s.tool.beginTransform('taper');
    mouse(s, 100, 100);
    mouse(s, 160, 100);
    mouse(s, 220, 100);
    s.tool.handleKey(key('Enter'));
    expect(s.model.undoDepth).toBe(depth + 1);
    expect(isSymmetric(s.model.all())).toBe(true);
    expect(bounds(s.model).wide).toBeGreaterThan(0);
    s.model.undo();
    expect(s.model.all()[0].faces).toEqual(before);
  });

  it('un modal sin movimiento del ratón no cambia nada al confirmar', () => {
    const s = setup();
    s.choose(() => true);
    const depth = s.model.undoDepth;
    s.tool.beginTransform('twist');
    s.tool.handleKey(key('Enter'));
    expect(s.model.undoDepth).toBe(depth);
    expect(s.tool.busy).toBe(false);
  });

  it('cancel() en medio de un arrastre devuelve el modelo y no anota paso', () => {
    const s = setup();
    s.choose((p) => p[0] > 0);
    const before = s.model.all()[0].faces;
    const depth = s.model.undoDepth;
    const inner = s.tool as unknown as { buildTargets: () => unknown[]; drag: unknown; preview: (d: Vec3) => void; pendingBefore: unknown };
    inner.pendingBefore = new Map();
    inner.drag = { targets: inner.buildTargets(), anchor: [0, 0, 0], plane: null, grab: null, startX: 0, startY: 0, moved: true, delta: [0.3, 0, 0] };
    inner.preview([0.3, 0, 0]);
    expect(JSON.stringify(s.model.all()[0].faces)).not.toBe(JSON.stringify(before));
    s.tool.cancel();
    expect(s.tool.busy).toBe(false);
    expect(s.model.all()[0].faces).toEqual(before);
    expect(s.model.undoDepth).toBe(depth);
  });
});

describe('Punta (tecla I)', () => {
  const press = (tool: MeshTool, key: string) => tool.handleKey({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent);

  it('sin vértices elegidos avisa y no cambia el modelo', () => {
    const { model, tool, messages } = setup();
    const depth = model.undoDepth;
    expect(press(tool, 'i')).toBe(true);
    expect(model.undoDepth).toBe(depth);
    expect(messages[messages.length - 1]).toContain('Punta (I)');
  });

  it('con vértices elegidos saca la copia, es un solo paso de deshacer y respeta la simetría', () => {
    const s = setup();
    s.tool.tipFaces = true;
    s.choose((p) => p[0] === Math.max(...uniqueVertices(s.model.all()[0]).map((q) => q[0])) && p[1] === Math.max(...uniqueVertices(s.model.all()[0]).map((q) => q[1])));
    const depth = s.model.undoDepth;
    const faces = s.model.all()[0].faces.length;
    expect(press(s.tool, 'i')).toBe(true);
    expect(s.model.undoDepth).toBe(depth + 1);
    expect(s.model.all()[0].faces.length).toBeGreaterThan(faces);
    expect(isSymmetric(s.model.all())).toBe(true);
    s.model.undo();
    expect(s.model.all()[0].faces.length).toBe(faces);
  });
});

describe('Punta con vértices sobre el plano de simetría', () => {
  const noRepeatedFaces = (piece: Piece): boolean => {
    const ids = piece.faces.map((face) => face.map(vertexKey).sort().join('|'));
    return new Set(ids).size === ids.length;
  };
  /** El cubo con un vértice nuevo en mitad de la arista de arriba que cruza el plano (queda en x = 0). */
  const withPlaneVertex = () => {
    const s = setup();
    const piece = s.model.all()[0];
    const vs = uniqueVertices(piece);
    const top = Math.max(...vs.map((p) => p[1]));
    const front = Math.max(...vs.map((p) => p[2]));
    const [a, b] = vs.filter((p) => p[1] === top && p[2] === front);
    const split = splitEdge(piece, a, b, 0.5)!;
    s.model.apply({ added: [split.piece], removed: [piece] });
    s.tool.refresh();
    return { ...s, top, front };
  };

  it('un vértice del plano saca una sola punta, sin caras repetidas, y la punta queda en el plano', () => {
    const s = withPlaneVertex();
    s.tool.tipFaces = true;
    s.choose((p) => Math.abs(p[0]) < 1e-9 && p[1] === s.top && p[2] === s.front);
    const before = s.model.all()[0];
    s.tool.tipSelected(0.5);
    const after = s.model.all()[0];
    expect(noRepeatedFaces(after)).toBe(true);
    expect(after.faces.length).toBe(before.faces.length + 2);
    expect(uniqueVertices(after).length).toBe(uniqueVertices(before).length + 1);
    expect(isSymmetric(s.model.all())).toBe(true);
    const tip = uniqueVertices(after).find((p) => !uniqueVertices(before).some((q) => vertexKey(q) === vertexKey(p)))!;
    expect(Math.abs(tip[0])).toBeLessThan(1e-9);
  });

  it('un vértice del plano junto con uno de un lado: simétrico y sin caras repetidas', () => {
    const s = withPlaneVertex();
    s.tool.tipFaces = true;
    const right = Math.max(...uniqueVertices(s.model.all()[0]).map((p) => p[0]));
    s.choose((p) => p[1] === s.top && p[2] === s.front && (Math.abs(p[0]) < 1e-9 || p[0] === right));
    const before = s.model.all()[0];
    s.tool.tipSelected(0.5);
    const after = s.model.all()[0];
    expect(noRepeatedFaces(after)).toBe(true);
    expect(isSymmetric(s.model.all())).toBe(true);
    // Tres puntas (plano, derecha e izquierda) y una cara por segmento: dos cuadriláteros hacia el del plano y dos triángulos por cada lado.
    expect(uniqueVertices(after).length).toBe(uniqueVertices(before).length + 3);
    expect(after.faces.length).toBe(before.faces.length + 6);
  });
});

describe('Punta sin caras (solo un segmento suelto)', () => {
  const cornerOf = (s: ReturnType<typeof setup>) => uniqueVertices(s.model.all()[0]).reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));

  it('con simetría saca el vértice y su segmento en los dos lados, sin caras nuevas, en un solo paso de deshacer', () => {
    const s = setup();
    const corner = cornerOf(s);
    s.choose((p) => vertexKey(p) === vertexKey(corner));
    const before = s.model.all()[0];
    const depth = s.model.undoDepth;
    s.tool.tipSelected(0.5);
    const after = s.model.all()[0];
    expect(s.model.undoDepth).toBe(depth + 1);
    expect(after.faces).toEqual(before.faces);
    expect(after.segments).toHaveLength(2);
    expect(uniqueVertices(after)).toHaveLength(uniqueVertices(before).length + 2);
    expect(isSymmetric(s.model.all())).toBe(true);
    expect(s.messages[s.messages.length - 1]).toContain('segmento');
    s.model.undo();
    expect(s.model.all()[0].segments).toBeUndefined();
    expect(uniqueVertices(s.model.all()[0])).toHaveLength(uniqueVertices(before).length);
  });

  it('al jalar la copia, el segmento la sigue y la gemela se mueve en espejo', () => {
    const s = setup();
    const corner = cornerOf(s);
    const before = s.model.all()[0];
    s.choose((p) => vertexKey(p) === vertexKey(corner));
    s.tool.tipSelected(0.5);
    const [tip] = chosenPositions(s.model, s.tool);
    dragChosen(s.tool, [0.25, 0.5, 0]);
    const [moved] = chosenPositions(s.model, s.tool);
    expect(moved[0]).toBeCloseTo(tip[0] + 0.25, 5);
    const piece = s.model.all()[0];
    // Un extremo del segmento sigue en el vértice original y el otro en la copia movida.
    expect(piece.segments!.some(([a, b]) => vertexKey(a) === vertexKey(corner) && vertexKey(b) === vertexKey(moved))).toBe(true);
    expect(piece.segments!.some(([a, b]) => vertexKey(a) === vertexKey([-corner[0], corner[1], corner[2]]) && vertexKey(b) === vertexKey([-moved[0], moved[1], moved[2]]))).toBe(true);
    expect(isSymmetric(s.model.all())).toBe(true);
    expect(piece.faces).toEqual(before.faces);
  });

  it('un vértice sobre el plano saca un solo segmento', () => {
    const s = setup();
    const piece = s.model.all()[0];
    const vs = uniqueVertices(piece);
    const top = Math.max(...vs.map((p) => p[1]));
    const front = Math.max(...vs.map((p) => p[2]));
    const [a, b] = vs.filter((p) => p[1] === top && p[2] === front);
    const split = splitEdge(piece, a, b, 0.5)!;
    s.model.apply({ added: [split.piece], removed: [piece] });
    s.tool.refresh();
    s.choose((p) => Math.abs(p[0]) < 1e-9 && p[1] === top && p[2] === front);
    s.tool.tipSelected(0.5);
    const after = s.model.all()[0];
    expect(after.segments).toHaveLength(1);
    expect(after.faces).toEqual(split.piece.faces);
    expect(isSymmetric(s.model.all())).toBe(true);
  });
});

describe('Punta: jalar la copia', () => {
  it('la copia se mueve con su gemela en espejo y el vértice original no se mueve', () => {
    const s = setup();
    const vs = uniqueVertices(s.model.all()[0]);
    const corner = vs.reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));
    s.choose((p) => vertexKey(p) === vertexKey(corner));
    s.tool.tipSelected(0.5);
    const [tip] = chosenPositions(s.model, s.tool);
    expect(vertexKey(tip)).not.toBe(vertexKey(corner));
    dragChosen(s.tool, [0.25, 0.5, 0]);
    const after = uniqueVertices(s.model.all()[0]).map(vertexKey);
    const [moved] = chosenPositions(s.model, s.tool);
    expect(moved[0]).toBeCloseTo(tip[0] + 0.25, 5);
    expect(moved[1]).toBeCloseTo(tip[1] + 0.5, 5);
    // El original y su gemelo siguen donde estaban; la punta gemela se movió en espejo.
    expect(after).toContain(vertexKey(corner));
    expect(after).toContain(vertexKey([-corner[0], corner[1], corner[2]]));
    expect(after).toContain(vertexKey([-moved[0], moved[1], moved[2]]));
    expect(isSymmetric(s.model.all())).toBe(true);
  });

  it('se puede sacar una punta de una punta', () => {
    const s = setup();
    const vs = uniqueVertices(s.model.all()[0]);
    const corner = vs.reduce((a, b) => (b[0] + b[1] + b[2] > a[0] + a[1] + a[2] ? b : a));
    s.choose((p) => vertexKey(p) === vertexKey(corner));
    s.tool.tipSelected(0.5);
    const count = uniqueVertices(s.model.all()[0]).length;
    s.tool.tipSelected(0.5);
    expect(uniqueVertices(s.model.all()[0]).length).toBe(count + 2);
    expect(isSymmetric(s.model.all())).toBe(true);
  });
});

describe('Clic sobre una cara en Malla', () => {
  // `up` suelta la cámara con un `pointercancel` sintético; el entorno de pruebas no trae PointerEvent.
  beforeEach(() => void vi.stubGlobal('PointerEvent', class { constructor(public type: string, public init?: unknown) {} }));
  afterEach(() => void vi.unstubAllGlobals());
  const click = (s: ReturnType<typeof setup>, x: number, y: number) => {
    const event = { button: 0, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, clientX: x, clientY: y, pointerId: 1, stopImmediatePropagation() {}, preventDefault() {} };
    for (const fn of s.handlers.get('pointerdown') ?? []) fn(event);
    for (const fn of s.handlers.get('pointerup') ?? []) fn(event);
  };
  const lookAtCube = (s: ReturnType<typeof setup>) => {
    s.camera.position.set(0, 0.5, 6);
    s.camera.lookAt(0, 0.5, 0);
    s.camera.updateMatrixWorld(true);
    s.camera.updateProjectionMatrix();
  };

  it('elige solo los vértices de esa cara, avisa al anfitrión y no toca la pieza', () => {
    const s = setup();
    lookAtCube(s);
    const piece = s.model.all()[0];
    const depth = s.model.undoDepth;
    click(s, 400, 300);
    const chosen = chosenPositions(s.model, s.tool);
    expect(chosen).toHaveLength(4);
    expect(new Set(chosen.map((p) => p[2])).size).toBe(1);
    expect(s.consumedCount()).toBeGreaterThan(0);
    expect(s.model.undoDepth).toBe(depth);
    expect(s.model.all()[0]).toBe(piece);
  });

  it('un clic en vacío no elige nada de la pieza', () => {
    const s = setup();
    lookAtCube(s);
    click(s, 20, 20);
    expect(chosenPositions(s.model, s.tool)).toHaveLength(0);
  });
});
