import { describe, expect, it } from 'vitest';
import { ACTIONS, ALL_MODES, SHORTCUTS, clashes, ctrlBeatsField, escLeavesTool, freeKeys, isPanMode, isTextField, keyLabel, matchNumpad, matchShortcuts, meshIgnoresKey, shortcutLabel, shortcutsFor, toolForKey, toolKey, undoRedoKey, verticalMoveKey, type KeyLike, type KeyMode } from './shortcuts';

describe('atajos estándar', () => {
  it('Ctrl+Z deshace, Ctrl+Mayús+Z y Ctrl+Y rehacen', () => {
    expect(undoRedoKey('z', false)).toBe('undo');
    expect(undoRedoKey('z', true)).toBe('redo');
    expect(undoRedoKey('y', false)).toBe('redo');
    expect(undoRedoKey('s', false)).toBeNull();
  });

  it('Ctrl+S, O y K valen con el foco en un campo numérico; Z, A, C y V no', () => {
    expect(isTextField({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(ctrlBeatsField('s')).toBe(true);
    expect(ctrlBeatsField('o')).toBe(true);
    for (const k of ['z', 'y', 'a', 'c', 'v']) expect(ctrlBeatsField(k)).toBe(false);
  });

  it('los campos de texto se reconocen y las casillas no', () => {
    expect(isTextField({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTextField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTextField({ tagName: 'SELECT' })).toBe(true);
    expect(isTextField({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTextField({ tagName: 'CANVAS' })).toBe(false);
    expect(isTextField(null)).toBe(false);
  });

  it('Esc vuelve a Colocar en Crecer y Hundir, y quita la selección en Elegir y Colocar', () => {
    expect(escLeavesTool('grow')).toBe(true);
    expect(escLeavesTool('sink')).toBe(true);
    expect(escLeavesTool('mesh')).toBe(true);
    expect(escLeavesTool('select')).toBe(false);
    expect(escLeavesTool('place')).toBe(false);
    expect(escLeavesTool('cut')).toBe(false);
  });
});

describe('E y la selección', () => {
  it('subir y bajar la selección es solo de Re Pág y Av Pág', () => {
    expect(verticalMoveKey('pageup')).toBe(1);
    expect(verticalMoveKey('pagedown')).toBe(-1);
    expect(verticalMoveKey('e')).toBe(0);
    expect(verticalMoveKey('q')).toBe(0);
  });
});

describe('teclas que no actúan en Malla', () => {
  it('M, N, U, K y O se ignoran (reflejar y ocultar piezas)', () => {
    for (const k of ['m', 'n', 'u', 'k', 'o']) expect(meshIgnoresKey(k, 2)).toBe(true);
  });
  it('los dígitos no cambian de herramienta si hay vértices elegidos', () => {
    expect(meshIgnoresKey('3', 2)).toBe(true);
    expect(meshIgnoresKey('3', 0)).toBe(false);
  });
  it('las demás teclas pasan', () => {
    expect(meshIgnoresKey('e', 2)).toBe(false);
    expect(meshIgnoresKey('0', 2)).toBe(false);
  });
});

describe('la tabla de atajos', () => {
  it('ninguna tecla se repite en una misma herramienta sin condiciones que las separen', () => {
    expect(clashes()).toEqual([]);
  });

  it('cada herramienta con tecla tiene una sola, y ninguna tecla enciende dos herramientas', () => {
    const toggles = SHORTCUTS.filter((s) => s.toggles);
    const tools = toggles.map((s) => s.toggles);
    expect(new Set(tools).size).toBe(tools.length);
    expect(new Set(toggles.map((s) => s.key)).size).toBe(toggles.length);
    expect(toolKey('cut')).toBe('c');
    expect(toolKey('mesh')).toBe('e');
    expect(toolKey('outline')).toBeUndefined();
  });

  it('toolForKey respeta dónde actúa cada tecla de herramienta', () => {
    expect(toolForKey('c', 'place')).toBe('cut');
    expect(toolForKey('f', 'place')).toBe('face');
    // En Cortar, F da la vuelta al plano; en Malla es de MeshTool (crear cara).
    expect(toolForKey('f', 'cut')).toBeNull();
    expect(toolForKey('f', 'mesh')).toBeNull();
    // E sale de Malla; S, en cambio, es de Deslizar.
    expect(toolForKey('e', 'mesh')).toBe('mesh');
    expect(toolForKey('s', 'mesh')).toBeNull();
    expect(toolForKey('q', 'place')).toBeNull();
  });

  it('las teclas que toma MeshTool no están a la vez como atajo de la aplicación en Malla (salvo con condición)', () => {
    const mesh = shortcutsFor('mesh');
    for (const s of mesh.filter((x) => x.by === 'mesh' && !x.when)) {
      const twins = mesh.filter((x) => x !== s && x.key === s.key && (x.mods ?? '') === (s.mods ?? '') && !x.when);
      expect(twins, `${s.key} en Malla`).toEqual([]);
    }
  });

  it('se sabe qué teclas quedan libres: Q solo es de Malla; la Ñ y los símbolos no cuentan', () => {
    expect(freeKeys('place')).toContain('q');
    expect(freeKeys('mesh')).not.toContain('q');
    expect(freeKeys('place')).not.toContain('c');
    for (const mode of ALL_MODES) expect(freeKeys(mode).every((k) => /^[a-z0-9]$/.test(k))).toBe(true);
  });

  it('la tabla coincide con las decisiones de teclado que ya vivían aparte', () => {
    // Las teclas que Malla deja pasar sin tomarlas (reflejar, ocultar, aislar, conectadas) no son atajos de la aplicación en Malla.
    for (const key of ['m', 'o', 'i']) expect(shortcutsFor('mesh').some((s) => s.key === key && !s.mods && s.by !== 'mesh')).toBe(false);
    // Esc vuelve a Colocar en las herramientas de escLeavesTool.
    for (const mode of ALL_MODES) {
      const leaves = shortcutsFor(mode).some((s) => s.key === 'escape' && s.description === 'volver a Colocar');
      expect(leaves, mode).toBe(escLeavesTool(mode));
    }
  });
});

const ev = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, ...mods });
const actionsOf = (e: KeyLike, mode: KeyMode): string[] => matchShortcuts(e, mode).map((row) => row.action!);

describe('la tabla ejecuta las acciones', () => {
  it('toda fila de la aplicación apunta a una acción y las de Malla no', () => {
    for (const s of SHORTCUTS) {
      if (s.by === 'mesh') expect(s.action, `${s.key} (Malla)`).toBeUndefined();
      else expect(ACTIONS, `${s.key}: ${s.description}`).toContain(s.action);
    }
  });

  it('toda acción tiene al menos una fila', () => {
    const used = new Set(SHORTCUTS.map((s) => s.action));
    for (const id of ACTIONS) expect(used.has(id), id).toBe(true);
  });

  it('una tecla da las filas por orden: las que piden Alt o Mayús, primero', () => {
    expect(actionsOf(ev('z', { ctrlKey: true }), 'place')).toEqual(['undo']);
    expect(actionsOf(ev('z', { ctrlKey: true, shiftKey: true }), 'place')).toEqual(['redo', 'undo']);
    expect(actionsOf(ev('y', { ctrlKey: true }), 'place')).toEqual(['redo']);
    expect(actionsOf(ev('s', { ctrlKey: true, altKey: true }), 'place')).toEqual(['saveAs', 'save']);
    expect(actionsOf(ev('o', { altKey: true }), 'place')).toEqual(['showHidden', 'hideSelected']);
    expect(actionsOf(ev('o'), 'place')).toEqual(['hideSelected']);
    expect(actionsOf(ev('g', { ctrlKey: true, altKey: true }), 'place')).toEqual(['ungroup', 'group']);
  });

  it('Cmd vale como Ctrl, y Mayús se ignora donde no se pide', () => {
    expect(actionsOf(ev('s', { metaKey: true }), 'place')).toEqual(['save']);
    expect(actionsOf(ev('x', { shiftKey: true }), 'place')).toEqual(['toggleSymmetry']);
    expect(actionsOf(ev('c'), 'place')).toEqual(['toggleTool']);
    expect(actionsOf(ev('c', { ctrlKey: true }), 'place')).toEqual(['copy', 'copyPixels']);
    expect(actionsOf(ev('v', { ctrlKey: true }), 'place')).toEqual(['paste', 'pastePixels']);
  });

  it('con Ctrl solo siguen las filas de Ctrl y las flechas; con Alt, solo R, O y las flechas', () => {
    expect(actionsOf(ev('b', { ctrlKey: true }), 'place')).toEqual([]);
    expect(actionsOf(ev('b', { altKey: true }), 'place')).toEqual([]);
    expect(actionsOf(ev('r', { altKey: true }), 'place')).toEqual(['rotatePlace']);
    expect(actionsOf(ev('r', { altKey: true }), 'select')).toEqual(['rotateSelection', 'rotateSelection']);
    expect(actionsOf(ev('ArrowUp', { ctrlKey: true }), 'place')).toEqual(['panCamera', 'moveSelection']);
    expect(actionsOf(ev('ArrowUp', { altKey: true }), 'place')).toEqual(['tumbleSelection', 'panCamera', 'moveSelection']);
    expect(actionsOf(ev('PageUp', { ctrlKey: true }), 'place')).toEqual(['moveVertical']);
    expect(actionsOf(ev('Escape', { ctrlKey: true }), 'place')).toEqual([]);
  });

  it('las flechas mueven la cámara siempre en las herramientas de puntos y en Malla; en las demás, según haya selección', () => {
    for (const mode of ALL_MODES) {
      const rows = actionsOf(ev('ArrowLeft'), mode);
      if (isPanMode(mode)) expect(rows, mode).toEqual(['panCamera']);
      else expect(rows, mode).toEqual(['panCamera', 'moveSelection']);
    }
  });

  it('Esc: primero cancela lo que está en curso y luego hace lo propio de la herramienta', () => {
    expect(actionsOf(ev('Escape'), 'place')).toEqual(['cancelDrag', 'clearSelection']);
    expect(actionsOf(ev('Escape'), 'select')).toEqual(['cancelDrag', 'clearSelection']);
    expect(actionsOf(ev('Escape'), 'cut')).toEqual(['cancelDrag', 'cancelTool']);
    expect(actionsOf(ev('Escape'), 'grow')).toEqual(['cancelDrag', 'leaveTool']);
    expect(actionsOf(ev('Escape'), 'mesh')).toEqual(['cancelDrag', 'leaveTool']);
  });

  it('las teclas de MeshTool no salen como acción de la aplicación en Malla', () => {
    expect(actionsOf(ev('x'), 'mesh')).toEqual([]);
    expect(actionsOf(ev('f'), 'mesh')).toEqual([]);
    expect(actionsOf(ev('Delete'), 'mesh')).toEqual([]);
    expect(actionsOf(ev('Delete'), 'place')).toEqual(['deleteSelection']);
    expect(actionsOf(ev('Backspace'), 'cut')).toEqual([]);
    expect(actionsOf(ev('e'), 'mesh')).toEqual(['toggleTool']);
  });

  it('«?» y F1 abren la ayuda con cualquier modificador (AltGr)', () => {
    expect(actionsOf(ev('?'), 'place')).toEqual(['help']);
    expect(actionsOf(ev('?', { ctrlKey: true, altKey: true }), 'mesh')).toEqual(['help']);
    expect(actionsOf(ev('F1', { shiftKey: true }), 'cut')).toEqual(['help']);
  });

  it('el teclado numérico elige la vista, con Ctrl la opuesta, y el 5 alterna con o sin Ctrl', () => {
    const view = (code: string, mods: Partial<KeyLike> = {}) => matchNumpad({ key: '1', code, ...mods }).map((row) => row.arg ?? row.action);
    expect(view('Numpad1')).toEqual(['+z']);
    expect(view('Numpad1', { ctrlKey: true })).toEqual(['-z']);
    expect(view('Numpad3')).toEqual(['+x']);
    expect(view('Numpad7', { ctrlKey: true })).toEqual(['-y']);
    expect(view('Numpad5')).toEqual(['toggleOrtho']);
    expect(view('Numpad5', { ctrlKey: true })).toEqual(['toggleOrtho']);
    expect(view('Numpad2')).toEqual([]);
    expect(view('Numpad1', { altKey: true })).toEqual([]);
    expect(view('Numpad1', { shiftKey: true })).toEqual([]);
    expect(matchNumpad({ key: '1', code: 'Digit1' })).toEqual([]);
  });

  it('los dígitos eligen pieza; la tecla de cada herramienta, la enciende', () => {
    expect(actionsOf(ev('3'), 'place')).toEqual(['selectPiece']);
    for (const mode of ALL_MODES) {
      const key = toolKey(mode);
      if (!key) continue;
      const rows = matchShortcuts(ev(key), 'place');
      expect(rows.find((row) => row.toggles === mode), mode).toBeDefined();
    }
  });

  it('solo valen con el foco en un campo F1 y las teclas con Ctrl que lo piden; coincide con ctrlBeatsField', () => {
    const inField = SHORTCUTS.filter((s) => s.inField);
    expect(inField.map((s) => `${s.mods ?? ''}:${s.key}`).sort()).toEqual(['ctrl+alt:s', 'ctrl:k', 'ctrl:o', 'ctrl:s', ':f1'].sort());
    for (const key of 'abcdefghijklmnopqrstuvwxyz') expect(ctrlBeatsField(key), key).toBe(['k', 'o', 's'].includes(key));
  });

  it('en cada herramienta, una tecla suelta no da dos filas sin condición que las separen', () => {
    for (const mode of ALL_MODES) {
      for (const key of [...'abcdefghijklmnopqrstuvwxyz0123456789', 'enter', 'escape', 'delete', 'backspace', 'arrowup', 'pageup']) {
        const rows = matchShortcuts(ev(key), mode);
        const bare = rows.filter((row) => !row.when);
        expect(bare.length, `${key} en ${mode}`).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('los nombres de las teclas', () => {
  it('se escriben como en la interfaz', () => {
    expect(shortcutLabel('hideSelected')).toBe('O');
    expect(shortcutLabel('group')).toBe('Ctrl+G');
    expect(shortcutLabel('ungroup')).toBe('Ctrl+Alt+G');
    expect(shortcutLabel('saveAs')).toBe('Ctrl+Alt+S');
    expect(shortcutLabel('help')).toBe('?');
    expect(shortcutLabel('view:+x')).toBe('teclado numérico 3');
    expect(shortcutLabel('view:-x')).toBe('Ctrl+3');
    expect(shortcutLabel('toggleOrtho')).toBe('teclado numérico 5');
    expect(shortcutLabel('mesh:face')).toBe('F');
    expect(shortcutLabel('mesh:add')).toBe('A');
    expect(shortcutLabel('nada')).toBe('');
    expect(keyLabel({ key: 'pageup', modes: 'all', description: '' })).toBe('Re Pág');
  });

  it('cada botón de Malla con tecla propia sale una sola vez en la tabla', () => {
    const names = SHORTCUTS.filter((s) => s.mesh).map((s) => s.mesh);
    expect(new Set(names).size).toBe(names.length);
  });
});
