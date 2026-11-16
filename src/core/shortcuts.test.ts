import { describe, expect, it } from 'vitest';
import { ctrlBeatsField, escLeavesTool, isTextField, meshIgnoresKey, undoRedoKey, verticalMoveKey } from './shortcuts';

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
