// Decisiones del teclado que no dependen del DOM: así se pueden probar. `main.ts` solo las consulta.

/** Un campo donde se escribe: ahí las teclas le pertenecen a él, salvo los atajos con Ctrl de `ctrlBeatsField`. */
export function isTextField(target: { tagName?: string; type?: string } | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && (target.type === 'number' || target.type === 'text' || target.type === 'search');
}

/** Atajos con Ctrl que valen incluso con el foco en un campo (si no, el navegador abre «Guardar página» u «Abrir archivo»). Z, Y, A, C y V siguen siendo del campo. */
export function ctrlBeatsField(key: string): boolean {
  return key === 's' || key === 'o' || key === 'k';
}

/** Ctrl+Z deshace y Ctrl+Mayús+Z (o Ctrl+Y) rehace. */
export function undoRedoKey(key: string, shift: boolean): 'undo' | 'redo' | null {
  if (key === 'y') return 'redo';
  if (key === 'z') return shift ? 'redo' : 'undo';
  return null;
}

/** Subir y bajar la selección es de Re Pág y Av Pág; E y Q ya son de Malla y de sus acciones. */
export function verticalMoveKey(key: string): 1 | -1 | 0 {
  if (key === 'pageup') return 1;
  if (key === 'pagedown') return -1;
  return 0;
}

/** Herramientas donde Esc vuelve a Colocar (las de Cortar, Rellenar y Figura cancelan lo que tienen a medias). */
const ESC_TO_PLACE = new Set(['vertex', 'mesh', 'paint', 'erase', 'shape', 'bevel', 'face', 'grow', 'sink']);
export function escLeavesTool(mode: string): boolean {
  return ESC_TO_PLACE.has(mode);
}

/** En Malla estas teclas pertenecen a la herramienta; si ella no las toma, no hacen nada (reflejar, ocultar o aislar piezas, sumar conectadas). */
const MESH_FREE_KEYS = new Set(['m', 'n', 'u', 'k', 'o']);
/**
 * ¿Debe ignorarse esta tecla en Malla, una vez que `MeshTool.handleKey` no la tomó?
 * Los dígitos solo estorban cuando hay vértices elegidos (cambiar de herramienta los soltaría).
 */
export function meshIgnoresKey(key: string, chosenVertices: number): boolean {
  if (MESH_FREE_KEYS.has(key)) return true;
  return /^[1-9]$/.test(key) && chosenVertices > 0;
}

// ——— La tabla de atajos ———

/** Las herramientas de la aplicación (los modos de `main.ts`). */
export const ALL_MODES = ['place', 'select', 'erase', 'cut', 'grow', 'sink', 'fill', 'outline', 'vertex', 'paint', 'shape', 'bevel', 'face', 'mesh'] as const;
export type KeyMode = (typeof ALL_MODES)[number];

/** Un atajo de teclado: qué tecla (en minúsculas, como `e.key`), con qué modificadores, en qué herramientas y qué hace. */
export interface Shortcut {
  /** Tecla en minúsculas (`e.key`), o `numpad1`… para el teclado numérico. */
  key: string;
  /** Modificadores que deben estar pulsados: `''`, `'ctrl'`, `'alt'`, `'shift'`, `'ctrl+alt'`, `'ctrl+shift'`. Ctrl vale también como Cmd. */
  mods?: string;
  /** Herramientas donde actúa: una lista o `'all'`. */
  modes: 'all' | readonly KeyMode[];
  /** Herramientas de `modes` donde NO actúa (porque otra la toma primero). */
  except?: readonly KeyMode[];
  /** Condición que no depende de la herramienta. Dos atajos pueden compartir tecla y herramienta solo si los dos traen una condición. */
  when?: string;
  /** Quién la toma: el teclado de la aplicación o `MeshTool.handleKey`. */
  by?: 'app' | 'mesh';
  /** Qué hace, para la ayuda. */
  description: string;
  /** Si es una tecla que enciende y apaga una herramienta, cuál. */
  toggles?: KeyMode;
}

const arrows = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const PAN_MODES: readonly KeyMode[] = ['cut', 'fill', 'outline', 'vertex', 'mesh'];
const MIRROR_EXCEPT: readonly KeyMode[] = ['cut', 'fill', 'vertex', 'outline', 'mesh'];

/** Teclas que encienden y apagan una herramienta (Figura no tiene tecla). En Malla las toma antes `MeshTool` las que no se listan en `modes`. */
const TOOL_KEYS: [string, KeyMode, readonly KeyMode[], string][] = [
  ['c', 'cut', [], 'Cortar'],
  ['s', 'select', ['mesh'], 'Elegir'],
  ['b', 'erase', ['mesh'], 'Borrar'],
  ['l', 'fill', ['mesh'], 'Rellenar'],
  ['v', 'vertex', [], 'Punto guía'],
  ['e', 'mesh', [], 'Malla'],
  ['j', 'bevel', [], 'Chaflán'],
  ['f', 'face', ['cut', 'mesh'], 'Cara'],
  ['t', 'shape', ['mesh'], 'Forma'],
  ['p', 'paint', ['mesh'], 'Pintar'],
  ['g', 'grow', [], 'Crecer'],
  ['d', 'sink', ['mesh'], 'Hundir'],
];

const row = (key: string, modes: Shortcut['modes'], description: string, extra: Partial<Shortcut> = {}): Shortcut => ({ key, modes, description, ...extra });

export const SHORTCUTS: readonly Shortcut[] = [
  // Siempre disponibles
  row('?', 'all', 'abrir la ayuda', { when: 'fuera de un campo de texto' }),
  row('f1', 'all', 'abrir la ayuda'),
  row('k', 'all', 'abrir Comandos (el buscador de acciones)', { mods: 'ctrl' }),
  row('s', 'all', 'guardar', { mods: 'ctrl' }),
  row('s', 'all', 'guardar como', { mods: 'ctrl+alt' }),
  row('o', 'all', 'abrir', { mods: 'ctrl' }),
  row('z', 'all', 'deshacer (en Cortar, Rellenar y Figura, quitar el último punto)', { mods: 'ctrl' }),
  row('z', 'all', 'rehacer', { mods: 'ctrl+shift' }),
  row('y', 'all', 'rehacer', { mods: 'ctrl' }),
  row('g', 'all', 'agrupar la selección', { mods: 'ctrl' }),
  row('g', 'all', 'desagrupar la selección', { mods: 'ctrl+alt' }),
  row('a', 'all', 'elegir todas las piezas', { mods: 'ctrl' }),
  row('c', 'all', 'copiar las piezas elegidas', { mods: 'ctrl', when: 'no se pintan píxeles' }),
  row('v', 'all', 'pegar las piezas', { mods: 'ctrl', when: 'no se pintan píxeles' }),
  row('c', 'all', 'copiar los píxeles', { mods: 'ctrl', when: 'se pintan píxeles' }),
  row('v', 'all', 'pegar los píxeles', { mods: 'ctrl', when: 'se pintan píxeles' }),
  row('d', 'all', 'duplicar las piezas elegidas', { mods: 'ctrl' }),
  row('enter', ['cut'], 'aplicar el corte', { mods: 'ctrl' }),
  row('numpad1', 'all', 'vista de frente'),
  row('numpad1', 'all', 'vista de atrás', { mods: 'ctrl' }),
  row('numpad3', 'all', 'vista desde la derecha'),
  row('numpad3', 'all', 'vista desde la izquierda', { mods: 'ctrl' }),
  row('numpad7', 'all', 'vista desde arriba'),
  row('numpad7', 'all', 'vista desde abajo', { mods: 'ctrl' }),
  row('numpad5', 'all', 'alternar vista ortográfica y perspectiva'),
  row('h', 'all', 'mostrar u ocultar el panel'),
  row('w', 'all', 'alternar la vista de alambre'),
  row('o', 'all', 'mostrar las piezas ocultas', { mods: 'alt' }),
  // Cámara y movimiento de la selección
  ...arrows.map((key) => row(key, PAN_MODES, 'desplazar la cámara (Ctrl: más rápido)')),
  ...arrows.map((key) => row(key, 'all', 'desplazar la cámara (Ctrl: más rápido)', { except: PAN_MODES, when: 'no hay piezas elegidas' })),
  ...arrows.map((key) => row(key, 'all', 'mover la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas' })),
  ...arrows.map((key) => row(key, 'all', 'tumbar la selección 90°', { mods: 'alt', except: PAN_MODES, when: 'hay piezas elegidas' })),
  row('pageup', 'all', 'subir la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas' }),
  row('pagedown', 'all', 'bajar la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas' }),
  // Herramientas
  ...TOOL_KEYS.map(([key, toggles, except, name]) => row(key, 'all', `${name}: encender o apagar la herramienta`, { except, toggles })),
  ...'123456789'.split('').map((key) => row(key, 'all', 'elegir la pieza del catálogo', { when: 'en Malla, solo sin vértices elegidos' })),
  row('r', ['place'], 'rotar la pieza que se va a colocar 90°'),
  row('r', ['select'], 'girar la selección 90°', { when: 'hay piezas elegidas' }),
  row('r', ['select'], 'girar la selección 90° al revés', { mods: 'alt', when: 'hay piezas elegidas' }),
  row('r', ['shape'], 'girar la forma 90°'),
  row('f', ['cut'], 'darle la vuelta al plano de corte'),
  // Selección y piezas
  row('escape', ['place', 'select'], 'quitar la selección', { when: 'sin arrastre en curso' }),
  row('escape', 'all', 'cancelar el arrastre, el recuadro o el crecimiento en curso', { when: 'hay un arrastre en curso' }),
  row('escape', ['vertex', 'mesh', 'paint', 'erase', 'shape', 'bevel', 'face', 'grow', 'sink'], 'volver a Colocar', { when: 'sin arrastre ni giro en curso' }),
  row('escape', ['cut', 'fill', 'outline'], 'cancelar lo que se tiene a medias', { when: 'sin arrastre en curso' }),
  row('enter', ['cut', 'fill', 'outline'], 'aplicar'),
  row('o', 'all', 'ocultar las piezas elegidas', { except: ['mesh'] }),
  row('i', 'all', 'aislar las piezas elegidas', { except: ['mesh'] }),
  row('a', 'all', 'mostrar u ocultar la barra de ayuda', { except: ['mesh'] }),
  ...['x', 'y', 'z'].map((key) => row(key, 'all', `simetría en ${key.toUpperCase()}`, { except: ['mesh'] })),
  row('m', 'all', 'reflejar la selección en X', { except: MIRROR_EXCEPT }),
  row('n', 'all', 'reflejar la selección en Z', { except: MIRROR_EXCEPT }),
  row('u', 'all', 'reflejar la selección en Y', { except: MIRROR_EXCEPT }),
  row('k', 'all', 'sumar las piezas conectadas', { except: MIRROR_EXCEPT }),
  row('delete', 'all', 'borrar la selección', { except: ['mesh'] }),
  row('backspace', 'all', 'borrar la selección', { except: ['mesh', 'cut', 'fill', 'outline'] }),
  // Malla: las toma MeshTool.handleKey antes que la aplicación
  ...['x', 'y', 'z'].map((key) => row(key, ['mesh'], `fijar el eje ${key.toUpperCase()} del movimiento (Mayús: el plano que lo deja fuera)`, { by: 'mesh', when: 'sin giro ni escala en curso' })),
  ...['x', 'y', 'z'].map((key) => row(key, ['mesh'], `limitar el giro o la escala al eje ${key.toUpperCase()}`, { by: 'mesh', when: 'giro o escala en curso' })),
  row('escape', ['mesh'], 'cancelar el giro o la escala', { by: 'mesh', when: 'giro o escala en curso' }),
  row('enter', ['mesh'], 'confirmar el giro o la escala', { by: 'mesh', when: 'giro o escala en curso' }),
  row('escape', ['mesh'], 'cancelar el arrastre', { by: 'mesh', when: 'hay un arrastre en curso' }),
  row('s', ['mesh'], 'Deslizar: encender o apagar', { by: 'mesh' }),
  row('a', ['mesh'], 'añadir vértices: encender o apagar', { by: 'mesh' }),
  row('d', ['mesh'], 'quitar vértices: encender o apagar', { by: 'mesh' }),
  row('r', ['mesh'], 'girar los vértices elegidos', { by: 'mesh' }),
  row('t', ['mesh'], 'escalar los vértices elegidos', { by: 'mesh' }),
  row('u', ['mesh'], 'trazar un segmento entre dos vértices', { by: 'mesh' }),
  row('q', ['mesh'], 'quitar un segmento', { by: 'mesh' }),
  row('l', ['mesh'], 'alinear en línea', { by: 'mesh' }),
  row('p', ['mesh'], 'aplanar en un plano', { by: 'mesh' }),
  row('f', ['mesh'], 'crear una cara', { by: 'mesh' }),
  row('b', ['mesh'], 'borrar caras', { by: 'mesh' }),
  row('n', ['mesh'], 'empujar la cara', { by: 'mesh' }),
  row('k', ['mesh'], 'tapar un hueco', { by: 'mesh' }),
  row('i', ['mesh'], 'sacar una punta: duplicar los vértices elegidos y jalar la copia', { by: 'mesh' }),
  row('m', ['mesh'], 'extruir las caras cuyos vértices están elegidos', { by: 'mesh' }),
  row('delete', ['mesh'], 'borrar los vértices elegidos', { by: 'mesh' }),
  row('backspace', ['mesh'], 'borrar los vértices elegidos', { by: 'mesh' }),
];

const appliesIn = (s: Shortcut, mode: KeyMode): boolean => (s.modes === 'all' || s.modes.includes(mode)) && !(s.except ?? []).includes(mode);

/** Los atajos que valen en una herramienta. */
export function shortcutsFor(mode: KeyMode): Shortcut[] {
  return SHORTCUTS.filter((s) => appliesIn(s, mode));
}

/** La tecla que enciende y apaga una herramienta, si tiene. */
export function toolKey(mode: KeyMode): string | undefined {
  return SHORTCUTS.find((s) => s.toggles === mode)?.key;
}

/** La herramienta que enciende o apaga esta tecla (sin modificadores) estando en `current`, o null si no es una tecla de herramienta ahí. */
export function toolForKey(key: string, current: KeyMode): KeyMode | null {
  const found = SHORTCUTS.find((s) => s.toggles && s.key === key && appliesIn(s, current));
  return found?.toggles ?? null;
}

/** Las letras y dígitos sin ningún atajo (con o sin modificadores) en una herramienta. */
export function freeKeys(mode: KeyMode): string[] {
  const taken = new Set(shortcutsFor(mode).map((s) => s.key));
  return [...'abcdefghijklmnopqrstuvwxyz0123456789'].filter((k) => !taken.has(k));
}

/** Cada par (herramienta, modificadores, tecla) que sale más de una vez sin que todas las filas repetidas traigan su condición: son atajos que se pisan. */
export function clashes(): string[] {
  const seen = new Map<string, Shortcut[]>();
  for (const s of SHORTCUTS) {
    for (const mode of ALL_MODES) {
      if (!appliesIn(s, mode)) continue;
      const id = `${mode}:${s.mods ?? ''}:${s.key}`;
      seen.set(id, [...(seen.get(id) ?? []), s]);
    }
  }
  return [...seen].filter(([, list]) => list.length > 1 && list.some((s) => !s.when)).map(([id]) => id);
}
