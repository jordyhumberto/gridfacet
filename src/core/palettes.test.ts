import { describe, expect, it } from 'vitest';
import { parseHexColors, parsePalettes, toHexText, upsertPalette } from './palettes';

describe('paletas', () => {
  it('lee un .hex de Lospec, con o sin #, y quita repetidos y basura', () => {
    expect(parseHexColors('FF0000\n#00ff00\r\n0000ff\nff0000\nhola\n12345')).toEqual([0xff0000, 0x00ff00, 0x0000ff]);
  });

  it('también lee colores separados por comas o espacios', () => {
    expect(parseHexColors('#111111, 222222;333333 444444')).toEqual([0x111111, 0x222222, 0x333333, 0x444444]);
  });

  it('escribe y vuelve a leer lo mismo', () => {
    const colors = [0x000000, 0x0a0b0c, 0xffffff];
    expect(toHexText(colors)).toBe('000000\n0a0b0c\nffffff\n');
    expect(parseHexColors(toHexText(colors))).toEqual(colors);
  });

  it('descarta lo mal formado al leer lo guardado', () => {
    const raw = [{ name: ' A ', colors: [1, 1, 2, 'x', -1, 0x1000000] }, { name: '', colors: [1] }, { name: 'B', colors: [] }, null, 'x'];
    expect(parsePalettes(raw)).toEqual([{ name: 'A', colors: [1, 2] }]);
    expect(parsePalettes('nada')).toEqual([]);
  });

  it('guardar con un nombre existente la reemplaza', () => {
    const list = upsertPalette([{ name: 'Mía', colors: [1] }], { name: 'mía', colors: [2, 3] });
    expect(list).toEqual([{ name: 'mía', colors: [2, 3] }]);
  });
});
