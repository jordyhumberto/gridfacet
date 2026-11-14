import { describe, expect, it } from 'vitest';
import { panRamp, panStep, type PanState } from './pan';

const run = (seconds: number, want: [number, number], state: PanState, distance = 10, fast = false): number => {
  let total = 0;
  for (let t = 0; t < seconds; t += 1 / 60) total += panStep(state, want, 1 / 60, distance, fast)[0];
  return total;
};

describe('panStep', () => {
  it('arranca despacio y acelera mientras se mantiene la flecha', () => {
    expect(panRamp(0)).toBeCloseTo(0.125, 9);
    expect(panRamp(1.5)).toBeCloseTo(1, 9);
    expect(panRamp(9)).toBe(1);
    const state: PanState = { held: 0, vx: 0, vy: 0 };
    const first = run(0.5, [1, 0], state);
    const later = run(0.5, [1, 0], { ...state, held: 2 });
    expect(later).toBeGreaterThan(first * 5);
  });

  it('un toque corto mueve muy poco (para cuadrar la figura)', () => {
    const state: PanState = { held: 0, vx: 0, vy: 0 };
    const tap = run(0.1, [1, 0], state) + run(0.5, [0, 0], state);
    expect(tap).toBeLessThan(0.2);
  });

  it('al soltar frena casi de golpe', () => {
    const state: PanState = { held: 3, vx: 0, vy: 0 };
    run(1, [1, 0], state);
    const glide = run(0.5, [0, 0], state);
    const hold = run(0.5, [1, 0], { held: 3, vx: 0, vy: 0 });
    expect(glide).toBeLessThan(hold * 0.1);
    expect(panStep(state, [0, 0], 1 / 60, 10, false)).toEqual([0, 0]);
  });

  it('Ctrl es más rápido y cuanto más lejos la cámara, más rápido', () => {
    const slow = run(2, [1, 0], { held: 2, vx: 0, vy: 0 });
    expect(run(2, [1, 0], { held: 2, vx: 0, vy: 0 }, 10, true)).toBeGreaterThan(slow * 2);
    expect(run(2, [1, 0], { held: 2, vx: 0, vy: 0 }, 20)).toBeGreaterThan(slow * 1.9);
  });
});
