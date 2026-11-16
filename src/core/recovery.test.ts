import { describe, expect, it } from 'vitest';
import { MAX_GENERATIONS, addGeneration, describeGeneration, parseGenerations, serializeGenerations, type RecoveryEntry } from './recovery';

const entry = (data: string, pieces = 3, savedAt = 1000): RecoveryEntry => ({ data, pieces, savedAt });

describe('generaciones de recuperación', () => {
  it('la más nueva va primera', () => {
    const list = addGeneration(addGeneration([], entry('a')), entry('b'));
    expect(list.map((e) => e.data)).toEqual(['b', 'a']);
  });

  it('guarda como mucho las últimas 3', () => {
    let list: RecoveryEntry[] = [];
    for (const d of ['a', 'b', 'c', 'd', 'e']) list = addGeneration(list, entry(d));
    expect(list).toHaveLength(MAX_GENERATIONS);
    expect(list.map((e) => e.data)).toEqual(['e', 'd', 'c']);
  });

  it('una sesión vacía no desplaza el trabajo guardado', () => {
    const list = addGeneration([], entry('a'));
    expect(addGeneration(list, entry('vacía', 0))).toEqual(list);
  });

  it('una sesión idéntica a la última no añade otra generación', () => {
    const list = addGeneration([], entry('a'));
    expect(addGeneration(list, entry('a', 3, 2000))).toEqual(list);
  });

  it('dos recargas seguidas no pierden el trabajo', () => {
    // 1.ª recarga: se aparta el trabajo A; luego se pone una pieza de prueba (B) y se recarga otra vez.
    let list = addGeneration([], entry('A', 20));
    list = addGeneration(list, entry('B', 1));
    expect(list.map((e) => e.data)).toEqual(['B', 'A']);
  });

  it('ida y vuelta por texto, y un texto dañado da lista vacía', () => {
    const list = addGeneration(addGeneration([], entry('a', 2, 5)), entry('b', 7, 9));
    expect(parseGenerations(serializeGenerations(list))).toEqual(list);
    expect(parseGenerations(null)).toEqual([]);
    expect(parseGenerations('no es json')).toEqual([]);
    expect(parseGenerations('{"a":1}')).toEqual([]);
    expect(parseGenerations('[null, {"data":"x"}, {"data":"y","pieces":1,"savedAt":3}]')).toEqual([entry('y', 1, 3)]);
  });

  it('describe con número de piezas y fecha', () => {
    const text = describeGeneration(entry('a', 1, new Date(2026, 0, 5, 9, 7).getTime()));
    expect(text).toContain('1 pieza');
    expect(text).not.toContain('1 piezas');
    expect(text).toContain('9:07');
    expect(describeGeneration(entry('a', 12, 0))).toContain('12 piezas');
  });
});
