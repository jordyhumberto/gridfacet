/** Estado del desplazamiento de la cámara con las flechas: cuánto lleva pulsada la tecla y la velocidad actual en pantalla (x, y). */
export interface PanState {
  held: number;
  vx: number;
  vy: number;
}

/** Multiplicador de velocidad según cuánto lleva pulsada la flecha: un octavo al empezar (para ajustar de a poco), completa tras 1,5 s. */
export const panRamp = (held: number): number => {
  const t = Math.min(Math.max(held, 0) / 1.5, 1);
  return 0.125 + 0.875 * t * t;
};

/**
 * Un paso de `dt` segundos. `want` es la dirección pedida (suma de las flechas pulsadas) y `distance` lo lejos que está la cámara de su punto de mira
 * (cuanto más lejos, más rápido, para cruzar la escena). Devuelve cuánto se mueve la cámara en este paso por el plano de la pantalla.
 * Al soltar la flecha frena casi de golpe en vez de seguir deslizando.
 */
export function panStep(state: PanState, want: [number, number], dt: number, distance: number, fast: boolean): [number, number] {
  const pressed = want[0] !== 0 || want[1] !== 0;
  state.held = pressed ? state.held + dt : 0;
  const speed = distance * (fast ? 1.6 : 0.7) * panRamp(state.held);
  const k = 1 - Math.exp(-dt * (pressed ? 10 : 30));
  state.vx += (want[0] * speed - state.vx) * k;
  state.vy += (want[1] * speed - state.vy) * k;
  if (state.vx * state.vx + state.vy * state.vy < 1e-6) return [0, 0];
  return [state.vx * dt, state.vy * dt];
}
