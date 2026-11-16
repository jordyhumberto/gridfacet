import * as THREE from 'three';
import { panStep, type PanState } from '../core/pan';
import { isPanMode, isTextField, matchNumpad, matchShortcuts, meshIgnoresKey, type ActionId, type KeyMode, type Shortcut } from '../core/shortcuts';

/** Una acción del teclado: recibe la tecla y la fila de la tabla que la llamó. Devuelve `false` si ahora no le corresponde. */
export type KeyAction = (e: KeyboardEvent, row: Shortcut) => boolean | void;
/** Las acciones que implementa la aplicación (mover la cámara con las flechas es de este módulo). */
export type KeyActions = Record<Exclude<ActionId, 'panCamera'>, KeyAction>;

/** Lo que el teclado necesita de la aplicación. */
export interface KeyboardHost {
  camera: THREE.Camera;
  controls: { target: THREE.Vector3 };
  mode(): KeyMode;
  hasSelection(): boolean;
  /** El editor plano de píxeles: abierto, solo deja pasar Esc (cierra) y los atajos con Ctrl. */
  editor: { isOpen(): boolean; close(): void };
  help: { isOpen(): boolean; isSearch(target: EventTarget | null): boolean; set(open: boolean): void };
  /** Teclas del panel de animación (posar con el teclado). */
  poseKey(e: KeyboardEvent): boolean;
  /** La herramienta Malla toma sus teclas antes que la aplicación. */
  mesh: { handleKey(e: KeyboardEvent): boolean; count(): number };
  actions: KeyActions;
}

export interface Keyboard {
  /** Mueve la cámara según las flechas que están pulsadas (se llama en cada fotograma). */
  updatePan(dt: number): void;
}

const PAN_KEYS: Record<string, [number, number]> = {
  arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, 1], arrowdown: [0, -1],
};

/**
 * El teclado de la aplicación. Cada tecla se busca en la tabla de atajos (`core/shortcuts.ts`) y se ejecuta la acción a la que apunta su fila;
 * aquí solo quedan las puertas que van antes (editor plano, ayuda, campos de texto, panel de animación, teclado numérico y Malla) y
 * el movimiento de la cámara con las flechas.
 */
export function createKeyboard(host: KeyboardHost): Keyboard {
  const { camera, controls } = host;
  const panKeys = new Set<string>();
  let panFast = false;
  /** Cuánto lleva pulsada la flecha (segundos): al principio la cámara avanza despacio, para poder ajustar de a poco, y acelera si se mantiene. */
  const panState: PanState = { held: 0, vx: 0, vy: 0 };
  window.addEventListener('keyup', (e) => {
    panKeys.delete(e.key.toLowerCase());
    // Soltar Ctrl con la flecha pulsada vuelve a la velocidad normal (antes se quedaba rápida hasta la siguiente pulsación).
    panFast = panKeys.size > 0 && (e.ctrlKey || e.metaKey);
  });
  // Si el navegador pierde el foco o la pestaña se oculta se pierde el «soltar tecla»: sin esto la cámara seguía avanzando sola.
  const stopPan = (): void => {
    panKeys.clear();
    panFast = false;
  };
  window.addEventListener('blur', stopPan);
  document.addEventListener('visibilitychange', () => document.hidden && stopPan());

  /** Desplaza cámara y punto de mira juntos por el plano de la pantalla: arranca lento, acelera si se mantiene pulsada y frena casi al soltar. */
  function updatePan(dt: number): void {
    const want: [number, number] = [0, 0];
    for (const key of panKeys) (want[0] += PAN_KEYS[key][0]), (want[1] += PAN_KEYS[key][1]);
    const [x, y] = panStep(panState, want, dt, camera.position.distanceTo(controls.target), panFast);
    if (x === 0 && y === 0) return;
    const move = new THREE.Vector3(x, y, 0).applyQuaternion(camera.quaternion);
    camera.position.add(move);
    controls.target.add(move);
  }

  /** Sin selección (o cortando, o en Malla) las flechas desplazan la cámara en pantalla; con selección mueven las piezas. */
  function panCamera(e: KeyboardEvent): boolean | void {
    const key = e.key.toLowerCase();
    if (!(key in PAN_KEYS) || (!isPanMode(host.mode()) && host.hasSelection())) return false;
    e.preventDefault();
    panKeys.add(key);
    panFast = e.ctrlKey || e.metaKey;
  }

  /** Prueba las filas en orden hasta que una acción las toma. */
  function run(rows: Shortcut[], e: KeyboardEvent): boolean {
    for (const row of rows) {
      const result = row.action === 'panCamera' ? panCamera(e) : host.actions[row.action as Exclude<ActionId, 'panCamera'>](e, row);
      if (result !== false) return true;
    }
    return false;
  }

  window.addEventListener('keydown', (e) => {
    if (host.editor.isOpen()) {
      if (e.key === 'Escape') host.editor.close();
      // Deshacer y rehacer siguen disponibles; lo demás espera a que se cierre el editor.
      if (!(e.ctrlKey || e.metaKey)) return;
    }
    if (host.help.isOpen()) {
      // Con el foco en el buscador, "?" es una letra más.
      if (e.key === 'Escape' || (e.key === '?' && !host.help.isSearch(e.target))) host.help.set(false);
      return;
    }
    const key = e.key.toLowerCase();
    const mode = host.mode();
    let rows = matchShortcuts(e, mode);
    let numpad = matchNumpad(e);
    // Con el foco en un campo las teclas le pertenecen a él, salvo las filas `inField` (Ctrl+S, Ctrl+O, Ctrl+K y F1: si no, el navegador abre «Guardar página»).
    // «?» dentro de un campo de texto es un signo más.
    if (isTextField(e.target as { tagName?: string; type?: string } | null)) {
      rows = rows.filter((row) => row.inField);
      numpad = [];
      if (rows.length === 0) return;
    }
    if (run(rows.filter((row) => row.action === 'help'), e)) return;
    if (host.poseKey(e)) {
      e.preventDefault();
      return;
    }
    // Teclado numérico, como en Blender: 1 frente, 3 derecha, 7 arriba (con Ctrl, la opuesta) y 5 alterna ortográfica/perspectiva.
    if (run(numpad, e)) return;
    if (mode === 'mesh' && host.mesh.handleKey(e)) {
      e.preventDefault();
      return;
    }
    // En Malla, lo que la herramienta no toma no actúa sobre las piezas (reflejar, ocultar, aislar) ni cambia de herramienta con vértices elegidos.
    if (mode === 'mesh' && !e.ctrlKey && !e.metaKey && !e.altKey && meshIgnoresKey(key, host.mesh.count())) return;
    run(rows, e);
  });

  return { updatePan };
}
