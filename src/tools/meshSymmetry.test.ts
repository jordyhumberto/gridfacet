import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CATALOG, buildPiece } from '../core/catalog';
import type { Piece, Vec3 } from '../core/piece';
import { translatePiece } from '../core/transform';
import { moveVertices, uniqueVertices, vertexKey } from '../core/vertices';
import { ModelScene } from '../scene';
import { MeshTool } from './meshTool';

/** Una herramienta de Malla sobre un modelo real, con simetría en X y una pieza que cruza el plano. */
function setup() {
  const model = new ModelScene();
  const cube = buildPiece(CATALOG[0], 0, 0, 0, 0, 0x336699);
  const xs = uniqueVertices(cube).map((p) => p[0]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const piece = translatePiece(cube, -centerX, 0, 0);
  model.apply({ added: [piece], removed: [] });
  const messages: string[] = [];
  const el = { addEventListener() {}, removeEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) } as unknown as HTMLElement;
  const symmetry = { x: true, y: false, z: false, center: [0, 0, 0] as Vec3 };
  const tool = new MeshTool({
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    domElement: el,
    setOrbit: () => {},
    model,
    selectedPieces: () => [],
    isHidden: () => false,
    symmetry: () => symmetry,
    status: (message: string) => messages.push(message),
    onSelectionChange: () => {},
  });
  tool.activate();
  const choose = (predicate: (p: Vec3) => boolean) => {
    const current = model.all()[0];
    const keys = new Set(uniqueVertices(current).filter(predicate).map(vertexKey));
    (tool as unknown as { selection: Map<number, Set<string>> }).selection = new Map([[current.id, keys]]);
    tool.refresh();
  };
  return { model, tool, choose, messages };
}

/** Cada vértice tiene su imagen en espejo en X, y cada cara la suya. */
function isSymmetric(pieces: Piece[]): boolean {
  const keys = new Set(pieces.flatMap((piece) => uniqueVertices(piece).map(vertexKey)));
  const mirrored = (p: Vec3) => vertexKey([-p[0], p[1], p[2]]);
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
