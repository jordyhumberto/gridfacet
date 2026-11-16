import { describe, expect, it } from 'vitest';
import { ALL_MODES, SHORTCUTS, clashes, ctrlBeatsField, escLeavesTool, freeKeys, isTextField, meshIgnoresKey, shortcutsFor, toolForKey, toolKey, undoRedoKey, verticalMoveKey } from './shortcuts';

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
  it('M, N, U, K, O e I se ignoran (reflejar, ocultar y aislar piezas)', () => {
    for (const k of ['m', 'n', 'u', 'k', 'o', 'i']) expect(meshIgnoresKey(k, 2)).toBe(true);
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
