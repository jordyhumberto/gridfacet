import { describe, expect, it } from 'vitest';
import { addOutline, flipRows, sheetLayout, spriteFileName, viewYaws } from './sprites';

describe('sprites', () => {
  it('reparte las vistas por igual y empieza de frente', () => {
    expect(viewYaws(4)).toEqual([0, 90, 180, 270]);
    expect(viewYaws(8)[1]).toBe(45);
    expect(viewYaws(16)).toHaveLength(16);
  });

  it('la hoja usa una cuadrícula casi cuadrada y ordena por filas', () => {
    const sheet = sheetLayout(8, 32);
    expect([sheet.cols, sheet.rows, sheet.width, sheet.height]).toEqual([3, 3, 96, 96]);
    expect(sheet.at(0)).toEqual([0, 0]);
    expect(sheet.at(4)).toEqual([32, 32]);
    expect(sheetLayout(4, 16).width).toBe(32);
    expect(sheetLayout(1, 16).width).toBe(16);
  });

  it('el contorno rodea lo opaco sin tocarlo', () => {
    const w = 3;
    const rgba = new Uint8ClampedArray(w * w * 4);
    rgba.set([10, 20, 30, 255], (1 * w + 1) * 4);
    const out = addOutline(rgba, w, w, 0xff0000);
    const px = (x: number, y: number) => [...out.slice((y * w + x) * 4, (y * w + x) * 4 + 4)];
    expect(px(1, 1)).toEqual([10, 20, 30, 255]);
    expect(px(0, 1)).toEqual([255, 0, 0, 255]);
    expect(px(1, 0)).toEqual([255, 0, 0, 255]);
    expect(px(0, 0)[3]).toBe(0);
    expect(rgba[(0 * w + 1) * 4 + 3]).toBe(0);
  });

  it('voltea las filas', () => {
    const rgba = new Uint8Array([1, 1, 1, 1, 2, 2, 2, 2]);
    expect([...flipRows(rgba, 1, 2)]).toEqual([2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('nombra el archivo con proyecto, tamaño y vista', () => {
    expect(spriteFileName('Mi árbol.json', 64, 2)).toBe('Mi árbol-64px-view2.png');
    expect(spriteFileName('a/b', 32, 1)).toBe('a_b-32px-view1.png');
  });
});
