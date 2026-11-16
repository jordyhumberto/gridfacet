import { describe, expect, it } from 'vitest';
import { VERTEX_EPSILON, vertexKey } from './key';

describe('clave de vértice', () => {
  it('puntos a menos de la mitad de la precisión comparten clave', () => {
    expect(vertexKey([1, 2, 3])).toBe(vertexKey([1 + VERTEX_EPSILON / 4, 2 - VERTEX_EPSILON / 4, 3]));
  });
  it('puntos separados más que la precisión no la comparten', () => {
    expect(vertexKey([1, 2, 3])).not.toBe(vertexKey([1 + 3 * VERTEX_EPSILON, 2, 3]));
  });
});
