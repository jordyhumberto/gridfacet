// Decisiones del teclado que no dependen del DOM: así se pueden probar. `main.ts` solo las consulta.

/** Un campo donde se escribe: ahí las teclas le pertenecen a él, salvo los atajos con Ctrl de `ctrlBeatsField`. */
export function isTextField(target: { tagName?: string; type?: string } | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? '').toUpperCase();
  if (tag === 'SELECT' || tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && (target.type === 'number' || target.type === 'text' || target.type === 'search');
}

/** Atajos con Ctrl que valen incluso con el foco en un campo (si no, el navegador abre «Guardar página» u «Abrir archivo»): los de la tabla marcados `inField`. Z, Y, A, C y V siguen siendo del campo. */
export function ctrlBeatsField(key: string): boolean {
  return SHORTCUTS.some((s) => s.inField && s.key === key && hasMod(s, 'ctrl'));
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
const ESC_TO_PLACE_MODES = ['vertex', 'mesh', 'paint', 'erase', 'shape', 'bevel', 'face', 'grow', 'sink'] as const;
const ESC_TO_PLACE = new Set<string>(ESC_TO_PLACE_MODES);
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

/**
 * Las acciones del teclado de la aplicación. Cada fila de la tabla que no toma `MeshTool` apunta a una por su id; `main.ts` las
 * implementa y `ui/keyboard.ts` las ejecuta. Una acción devuelve `false` si ahora no le corresponde (y se prueba la siguiente fila).
 */
export const ACTIONS = [
  'help', 'commands', 'save', 'saveAs', 'open', 'undo', 'redo', 'group', 'ungroup', 'selectAll', 'copy', 'paste', 'copyPixels', 'pastePixels', 'duplicate',
  'applyCutNow', 'view', 'toggleOrtho', 'toggleHud', 'toggleWire', 'showHidden',
  'panCamera', 'moveSelection', 'tumbleSelection', 'moveVertical',
  'toggleTool', 'selectPiece', 'rotatePlace', 'rotateSelection', 'turnShape', 'flipCut',
  'cancelDrag', 'clearSelection', 'leaveTool', 'cancelTool', 'applyTool',
  'hideSelected', 'isolateSelected', 'toggleHint', 'toggleSymmetry', 'mirrorX', 'mirrorZ', 'mirrorY', 'selectConnected', 'deleteSelection',
] as const;
export type ActionId = (typeof ACTIONS)[number];

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
  /** Condición que no depende de la herramienta. Dos atajos pueden compartir tecla y herramienta solo si los dos traen una condición. La comprueba la acción (devuelve `false` si no se cumple). */
  when?: string;
  /** Quién la toma: el teclado de la aplicación o `MeshTool.handleKey`. */
  by?: 'app' | 'mesh';
  /** Qué hace, para la ayuda. */
  description: string;
  /** Si es una tecla que enciende y apaga una herramienta, cuál. */
  toggles?: KeyMode;
  /** La acción de la aplicación que ejecuta (las filas de `MeshTool` no la llevan). */
  action?: ActionId;
  /** Un dato para la acción (por ejemplo, hacia dónde mira cada vista del teclado numérico). */
  arg?: string;
  /** Vale también con el foco en un campo de texto. */
  inField?: boolean;
  /** Si la tecla es un atajo de un botón o casilla del panel de Malla: su `data-mesh` (o `add`, `slide`, `remove`). */
  mesh?: string;
}

const arrows = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
/** Herramientas donde las flechas mueven la cámara aunque haya piezas elegidas. */
const PAN_MODES: readonly KeyMode[] = ['cut', 'fill', 'outline', 'vertex', 'mesh'];
const MIRROR_EXCEPT: readonly KeyMode[] = ['cut', 'fill', 'vertex', 'outline', 'mesh'];
export const isPanMode = (mode: string): boolean => (PAN_MODES as readonly string[]).includes(mode);

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
  row('?', 'all', 'abrir la ayuda', { action: 'help', when: 'fuera de un campo de texto' }),
  row('f1', 'all', 'abrir la ayuda', { action: 'help', inField: true }),
  row('k', 'all', 'abrir Comandos (el buscador de acciones)', { mods: 'ctrl', action: 'commands', inField: true }),
  row('s', 'all', 'guardar', { mods: 'ctrl', action: 'save', inField: true }),
  row('s', 'all', 'guardar como', { mods: 'ctrl+alt', action: 'saveAs', inField: true }),
  row('o', 'all', 'abrir', { mods: 'ctrl', action: 'open', inField: true }),
  row('z', 'all', 'deshacer (en Cortar, Rellenar y Figura, quitar el último punto)', { mods: 'ctrl', action: 'undo' }),
  row('z', 'all', 'rehacer', { mods: 'ctrl+shift', action: 'redo' }),
  row('y', 'all', 'rehacer', { mods: 'ctrl', action: 'redo' }),
  row('g', 'all', 'agrupar la selección', { mods: 'ctrl', action: 'group' }),
  row('g', 'all', 'desagrupar la selección', { mods: 'ctrl+alt', action: 'ungroup' }),
  row('a', 'all', 'elegir todas las piezas', { mods: 'ctrl', action: 'selectAll' }),
  row('c', 'all', 'copiar las piezas elegidas', { mods: 'ctrl', when: 'no se pintan píxeles', action: 'copy' }),
  row('v', 'all', 'pegar las piezas', { mods: 'ctrl', when: 'no se pintan píxeles', action: 'paste' }),
  row('c', 'all', 'copiar los píxeles', { mods: 'ctrl', when: 'se pintan píxeles', action: 'copyPixels' }),
  row('v', 'all', 'pegar los píxeles', { mods: 'ctrl', when: 'se pintan píxeles', action: 'pastePixels' }),
  row('d', 'all', 'duplicar las piezas elegidas', { mods: 'ctrl', action: 'duplicate' }),
  row('enter', ['cut'], 'aplicar el corte', { mods: 'ctrl', action: 'applyCutNow' }),
  row('numpad1', 'all', 'vista de frente', { action: 'view', arg: '+z' }),
  row('numpad1', 'all', 'vista de atrás', { mods: 'ctrl', action: 'view', arg: '-z' }),
  row('numpad3', 'all', 'vista desde la derecha', { action: 'view', arg: '+x' }),
  row('numpad3', 'all', 'vista desde la izquierda', { mods: 'ctrl', action: 'view', arg: '-x' }),
  row('numpad7', 'all', 'vista desde arriba', { action: 'view', arg: '+y' }),
  row('numpad7', 'all', 'vista desde abajo', { mods: 'ctrl', action: 'view', arg: '-y' }),
  row('numpad5', 'all', 'alternar vista ortográfica y perspectiva', { action: 'toggleOrtho' }),
  row('h', 'all', 'mostrar u ocultar el panel', { action: 'toggleHud' }),
  row('w', 'all', 'alternar la vista de alambre', { action: 'toggleWire' }),
  row('o', 'all', 'mostrar las piezas ocultas', { mods: 'alt', action: 'showHidden' }),
  // Cámara y movimiento de la selección
  ...arrows.map((key) => row(key, PAN_MODES, 'desplazar la cámara (Ctrl: más rápido)', { action: 'panCamera' })),
  ...arrows.map((key) => row(key, 'all', 'desplazar la cámara (Ctrl: más rápido)', { except: PAN_MODES, when: 'no hay piezas elegidas', action: 'panCamera' })),
  ...arrows.map((key) => row(key, 'all', 'mover la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas', action: 'moveSelection' })),
  ...arrows.map((key) => row(key, 'all', 'tumbar la selección 90°', { mods: 'alt', except: PAN_MODES, when: 'hay piezas elegidas', action: 'tumbleSelection' })),
  row('pageup', 'all', 'subir la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas', action: 'moveVertical' }),
  row('pagedown', 'all', 'bajar la selección un cuarto de celda (Ctrl: media celda)', { except: PAN_MODES, when: 'hay piezas elegidas', action: 'moveVertical' }),
  // Herramientas
  ...TOOL_KEYS.map(([key, toggles, except, name]) => row(key, 'all', `${name}: encender o apagar la herramienta`, { except, toggles, action: 'toggleTool' })),
  ...'123456789'.split('').map((key) => row(key, 'all', 'elegir la pieza del catálogo', { when: 'en Malla, solo sin vértices elegidos', action: 'selectPiece' })),
  row('r', ['place'], 'rotar la pieza que se va a colocar 90°', { action: 'rotatePlace' }),
  row('r', ['select'], 'girar la selección 90°', { when: 'hay piezas elegidas', action: 'rotateSelection' }),
  row('r', ['select'], 'girar la selección 90° al revés', { mods: 'alt', when: 'hay piezas elegidas', action: 'rotateSelection' }),
  row('r', ['shape'], 'girar la forma 90°', { action: 'turnShape' }),
  row('f', ['cut'], 'darle la vuelta al plano de corte', { action: 'flipCut' }),
  // Selección y piezas (Esc: primero cancela lo que esté en curso)
  row('escape', 'all', 'cancelar el arrastre, el recuadro o el crecimiento en curso', { when: 'hay un arrastre en curso', action: 'cancelDrag' }),
  row('escape', ['place', 'select'], 'quitar la selección', { when: 'sin arrastre en curso', action: 'clearSelection' }),
  row('escape', ESC_TO_PLACE_MODES, 'volver a Colocar', { when: 'sin arrastre ni giro en curso', action: 'leaveTool' }),
  row('escape', ['cut', 'fill', 'outline'], 'cancelar lo que se tiene a medias', { when: 'sin arrastre en curso', action: 'cancelTool' }),
  row('enter', ['cut', 'fill', 'outline'], 'aplicar', { action: 'applyTool' }),
  row('o', 'all', 'ocultar las piezas elegidas', { except: ['mesh'], action: 'hideSelected' }),
  row('i', 'all', 'aislar las piezas elegidas', { except: ['mesh'], action: 'isolateSelected' }),
  row('a', 'all', 'mostrar u ocultar la barra de ayuda', { except: ['mesh'], action: 'toggleHint' }),
  ...['x', 'y', 'z'].map((key) => row(key, 'all', `simetría en ${key.toUpperCase()}`, { except: ['mesh'], action: 'toggleSymmetry' })),
  row('m', 'all', 'reflejar la selección en X', { except: MIRROR_EXCEPT, action: 'mirrorX' }),
  row('n', 'all', 'reflejar la selección en Z', { except: MIRROR_EXCEPT, action: 'mirrorZ' }),
  row('u', 'all', 'reflejar la selección en Y', { except: MIRROR_EXCEPT, action: 'mirrorY' }),
  row('k', 'all', 'sumar las piezas conectadas', { except: MIRROR_EXCEPT, action: 'selectConnected' }),
  row('delete', 'all', 'borrar la selección', { except: ['mesh'], action: 'deleteSelection' }),
  row('backspace', 'all', 'borrar la selección', { except: ['mesh', 'cut', 'fill', 'outline'], action: 'deleteSelection' }),
  // Malla: las toma MeshTool.handleKey antes que la aplicación
  ...['x', 'y', 'z'].map((key) => row(key, ['mesh'], `fijar el eje ${key.toUpperCase()} del movimiento (Mayús: el plano que lo deja fuera)`, { by: 'mesh', when: 'sin giro ni escala en curso' })),
  ...['x', 'y', 'z'].map((key) => row(key, ['mesh'], `limitar el giro o la escala al eje ${key.toUpperCase()}`, { by: 'mesh', when: 'giro o escala en curso' })),
  row('escape', ['mesh'], 'cancelar el giro o la escala', { by: 'mesh', when: 'giro o escala en curso' }),
  row('enter', ['mesh'], 'confirmar el giro o la escala', { by: 'mesh', when: 'giro o escala en curso' }),
  row('escape', ['mesh'], 'cancelar el arrastre', { by: 'mesh', when: 'hay un arrastre en curso' }),
  row('s', ['mesh'], 'Deslizar: encender o apagar', { by: 'mesh', mesh: 'slide' }),
  row('a', ['mesh'], 'añadir vértices: encender o apagar', { by: 'mesh', mesh: 'add' }),
  row('d', ['mesh'], 'quitar vértices: encender o apagar', { by: 'mesh', mesh: 'remove' }),
  row('r', ['mesh'], 'girar los vértices elegidos', { by: 'mesh', mesh: 'rotate' }),
  row('t', ['mesh'], 'escalar los vértices elegidos', { by: 'mesh', mesh: 'scale' }),
  row('u', ['mesh'], 'trazar un segmento entre dos vértices', { by: 'mesh', mesh: 'connect' }),
  row('q', ['mesh'], 'quitar un segmento', { by: 'mesh', mesh: 'dissolve' }),
  row('l', ['mesh'], 'alinear en línea', { by: 'mesh', mesh: 'straighten' }),
  row('p', ['mesh'], 'aplanar en un plano', { by: 'mesh', mesh: 'flatten' }),
  row('f', ['mesh'], 'crear una cara', { by: 'mesh', mesh: 'face' }),
  row('b', ['mesh'], 'borrar caras', { by: 'mesh', mesh: 'delface' }),
  row('n', ['mesh'], 'empujar la cara', { by: 'mesh', mesh: 'push' }),
  row('k', ['mesh'], 'tapar un hueco', { by: 'mesh', mesh: 'fillhole' }),
  row('i', ['mesh'], 'sacar una punta: duplicar los vértices elegidos y jalar la copia', { by: 'mesh', mesh: 'tip' }),
  row('m', ['mesh'], 'extruir las caras cuyos vértices están todos elegidos', { by: 'mesh', mesh: 'extrude' }),
  row('delete', ['mesh'], 'borrar los vértices elegidos', { by: 'mesh' }),
  row('backspace', ['mesh'], 'borrar los vértices elegidos', { by: 'mesh' }),
];

const hasMod = (s: Shortcut, mod: 'ctrl' | 'alt' | 'shift'): boolean => (s.mods ?? '').split('+').includes(mod);
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

// ——— De la tecla pulsada a las filas de la tabla ———

/** Lo que se necesita de un `KeyboardEvent`. */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Las filas de la aplicación que pueden responder a esta tecla en esta herramienta, la más específica primero (las que piden Alt o Mayús
 * van antes que las que no, y a igualdad manda el orden de la tabla). Las reglas de modificadores son las de siempre:
 * - Ctrl (o Cmd) solo deja pasar a las filas de Ctrl y, sin él, a las flechas y Re Pág/Av Pág (que lo usan para ir más rápido).
 * - Alt, en las filas sin Ctrl, solo deja pasar a R, O y las flechas (las filas con Alt van siempre antes).
 * - «?» y F1 abren la ayuda con cualquier modificador.
 * - Mayús se ignora salvo en las filas que lo piden (Ctrl+Mayús+Z rehace; Ctrl+Z, con Mayús, no deshace).
 * No incluye el teclado numérico (`matchNumpad`) ni las filas de `MeshTool`.
 */
export function matchShortcuts(e: KeyLike, mode: KeyMode): Shortcut[] {
  const key = e.key.toLowerCase();
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const alt = !!e.altKey;
  const shift = !!e.shiftKey;
  const arrowLike = /^(arrow|page)/.test(key);
  const altOk = key === 'r' || key === 'o' || key.startsWith('arrow');
  const rows = SHORTCUTS.filter((s) => {
    if (s.by === 'mesh' || !s.action || s.key !== key || !appliesIn(s, mode)) return false;
    // La ayuda se abre con «?» y F1 sea cual sea el modificador (en algunos teclados «?» sale con AltGr).
    if (s.action === 'help') return true;
    const needsCtrl = hasMod(s, 'ctrl');
    if (needsCtrl !== ctrl && !(ctrl && arrowLike)) return false;
    if (hasMod(s, 'alt')) {
      if (!alt) return false;
    } else if (alt && !needsCtrl && !ctrl && !altOk) return false;
    return !hasMod(s, 'shift') || shift;
  });
  const weight = (s: Shortcut): number => (hasMod(s, 'alt') ? 1 : 0) + (hasMod(s, 'shift') ? 1 : 0);
  return rows.map((s, i) => ({ s, i })).sort((a, b) => weight(b.s) - weight(a.s) || a.i - b.i).map((x) => x.s);
}

/** Las filas del teclado numérico (vistas de cámara) para esta tecla: solo sin Alt ni Mayús. */
export function matchNumpad(e: KeyLike): Shortcut[] {
  if (!e.code?.startsWith('Numpad') || e.altKey || e.shiftKey) return [];
  const key = `numpad${e.code.slice(6)}`;
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const rows = SHORTCUTS.filter((s) => s.action && s.key === key);
  // Con Ctrl, la vista opuesta; el 5 (perspectiva/ortográfica) no tiene versión con Ctrl y vale igual con él.
  const exact = rows.filter((s) => hasMod(s, 'ctrl') === ctrl);
  return exact.length > 0 ? exact : ctrl ? rows.filter((s) => !hasMod(s, 'ctrl')) : [];
}

// ——— Los nombres de las teclas, para botones y ayuda ———

const KEY_NAMES: Record<string, string> = { escape: 'Esc', enter: 'Intro', delete: 'Supr', backspace: 'Retroceso', pageup: 'Re Pág', pagedown: 'Av Pág' };

/** Cómo se escribe una tecla de la tabla: «O», «Ctrl+Alt+G», «Ctrl+3» o «teclado numérico 3». */
export function keyLabel(s: Shortcut): string {
  const numpad = /^numpad(\d)$/.exec(s.key);
  if (numpad) return hasMod(s, 'ctrl') ? `Ctrl+${numpad[1]}` : `teclado numérico ${numpad[1]}`;
  const name = KEY_NAMES[s.key] ?? (s.key.length === 1 || /^f\d+$/.test(s.key) ? s.key.toUpperCase() : s.key);
  return [hasMod(s, 'ctrl') ? 'Ctrl' : '', hasMod(s, 'alt') ? 'Alt' : '', hasMod(s, 'shift') ? 'Mayús' : '', name].filter(Boolean).join('+');
}

/**
 * La fila a la que apunta el `data-shortcut` de un botón: `acción` o `acción:dato` (por ejemplo `view:+x`), o `mesh:nombre` para un
 * botón del panel de Malla (`face`, `add`…). Para un botón con varias filas gana la primera de la tabla.
 */
export function findShortcut(ref: string): Shortcut | undefined {
  const [what, arg] = ref.split(':');
  if (what === 'mesh') return SHORTCUTS.find((s) => s.by === 'mesh' && s.mesh === arg);
  return SHORTCUTS.find((s) => s.action === what && (arg === undefined || s.arg === arg));
}

/** El nombre de la tecla de un `data-shortcut` (cadena vacía si la tabla no lo conoce). */
export function shortcutLabel(ref: string): string {
  const found = findShortcut(ref);
  return found ? keyLabel(found) : '';
}
