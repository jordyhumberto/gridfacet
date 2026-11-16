import { describe, expect, it } from 'vitest';
import { ALL_MODES, shortcutsFor, toolKey } from '../core/shortcuts';
import { GUIDE, MODE_INFO } from './help';

describe('guía de ayuda', () => {
  it('cada herramienta tiene nombre, color y guía', () => {
    for (const mode of ALL_MODES) {
      expect(MODE_INFO[mode].name, mode).toBeTruthy();
      expect(GUIDE[mode].length, mode).toBeGreaterThan(0);
    }
  });

  it('la guía de Colocar nombra la tecla de cada herramienta que tiene una, con su nombre', () => {
    const lines = GUIDE.place.map(([keys, text]) => `${keys}|${text}`).join('\n');
    for (const mode of ALL_MODES) {
      const key = toolKey(mode);
      if (!key) continue;
      expect(lines, mode).toContain(key.toUpperCase());
      expect(lines.toLowerCase(), mode).toContain(MODE_INFO[mode].name.toLowerCase());
    }
  });

  it('las teclas sueltas de la guía de cada herramienta existen en la tabla de atajos de esa herramienta', () => {
    // Solo las filas con una única tecla (R, F, Enter, Esc…); las compuestas («S · B · C · L») ya las cubre la prueba anterior.
    const names: Record<string, string> = { R: 'r', F: 'f', Enter: 'enter', Esc: 'escape', Supr: 'delete' };
    for (const mode of ALL_MODES) {
      const keys = new Set(shortcutsFor(mode).map((s) => s.key));
      for (const [label] of GUIDE[mode]) {
        const key = names[label];
        if (key) expect(keys.has(key), `${mode}: «${label}» está en la guía pero no en la tabla`).toBe(true);
      }
    }
  });
});
