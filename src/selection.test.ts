import { describe, expect, it } from 'vitest';
import { Selection } from './selection';

describe('Selection', () => {
  it('alterna piezas y avisa de cada cambio', () => {
    const selection = new Selection();
    let calls = 0;
    selection.onChange = () => calls++;
    selection.toggle(1);
    selection.toggle(2);
    selection.toggle(1);
    expect(selection.size).toBe(1);
    expect(selection.has(2)).toBe(true);
    expect(calls).toBe(3);
  });

  it('remove solo avisa si quitó algo', () => {
    const selection = new Selection();
    selection.set([1, 2]);
    let calls = 0;
    selection.onChange = () => calls++;
    selection.remove([9]);
    expect(calls).toBe(0);
    selection.remove([1, 9]);
    expect(calls).toBe(1);
    expect(selection.has(1)).toBe(false);
  });

  it('clear sobre una selección vacía no avisa', () => {
    const selection = new Selection();
    let calls = 0;
    selection.onChange = () => calls++;
    selection.clear();
    expect(calls).toBe(0);
  });
});
