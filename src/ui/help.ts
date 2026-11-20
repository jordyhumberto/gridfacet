import { toolKey, type KeyMode as Mode } from '../core/shortcuts';

/** Cómo se llama cada herramienta y su color en la barra de ayuda. */
export const MODE_INFO: Record<Mode, { name: string; color: string }> = {
  place: { name: 'Colocar', color: '#3b6fd4' },
  select: { name: 'Elegir', color: '#6cc3ee' },
  erase: { name: 'Borrar', color: '#ff5a5a' },
  cut: { name: 'Cortar', color: '#ff9a3d' },
  fill: { name: 'Rellenar', color: '#45d19a' },
  outline: { name: 'Figura', color: '#b58cff' },
  vertex: { name: 'Punto guía', color: '#ffd34d' },
  grow: { name: 'Crecer', color: '#b58cff' },
  sink: { name: 'Hundir', color: '#ff6b8b' },
  paint: { name: 'Pintar', color: '#ff7ad1' },
  shape: { name: 'Forma', color: '#7ad1ff' },
  bevel: { name: 'Chaflán', color: '#ffb36b' },
  face: { name: 'Cara', color: '#8ce08c' },
  mesh: { name: 'Malla', color: '#ffd34d' },
};

/** Guía completa de cada herramienta: todo lo que se puede hacer con ratón y teclado estando en ella. */
export const VIEW_GUIDE: [string, string][] = [
  ['Arrastrar en vacío', 'orbitar la vista'],
  ['Arrastrar con la rueda', 'desplazar la cámara en pantalla, como las flechas (el botón derecho también); girar la rueda hace zoom'],
  ['Rueda', 'acercar / alejar'],
  ['Flechas', 'mover la cámara (Ctrl: más rápido)'],
  ['X / Y / Z', 'simetría en ese eje (siempre, en todas las herramientas, también en Malla; no durante un arrastre o un giro a medias)'],
  ['W', 'alambre'],
  ['H', 'ocultar el menú'],
  ['Ctrl+Z / Ctrl+Y', 'deshacer / rehacer'],
];
/** Las teclas que cambian de herramienta, de cuatro en cuatro: salen de la tabla de atajos, así la guía no puede contradecir al teclado. */
const TOOL_KEY_LINES: [string, string][] = ([
  ['select', 'erase', 'cut', 'fill'],
  ['vertex', 'grow', 'sink', 'paint'],
  ['shape', 'bevel', 'face', 'mesh'],
] as Mode[][]).map((group) => [group.map((mode) => (toolKey(mode) ?? '?').toUpperCase()).join(' · '), group.map((mode) => MODE_INFO[mode].name.toLowerCase()).join(' · ')]);

export const GUIDE: Record<Mode, [string, string][]> = {
  place: [
    ['Clic', 'colocar la pieza elegida (la lámina crece desde la cara apuntada)'],
    ['Pendiente', 'sobre el techo de rampas o una cara inclinada la pieza se asienta (vertical, con la base cortada a la rampa) o se apoya perpendicular; se elige en el panel'],
    ['Tamaño · Pendiente · Grosor', 'la pieza sigue al cursor dentro de la cara, en pasos de un cuarto de su tamaño, y se imanta a las aristas de las piezas cercanas y a la rejilla'],
    ['Ctrl+clic', 'borrar la pieza apuntada'],
    ['R', 'rotar la pieza 90°'],
    ['1 – 9', 'elegir pieza del catálogo'],
    ...TOOL_KEY_LINES,
    ...VIEW_GUIDE,
  ],
  select: [
    ['Clic', 'elegir una pieza (o su grupo entero)'],
    ['Ctrl+clic', 'sumar o quitar una pieza de la selección'],
    ['Ctrl+arrastrar', 'desde un hueco: recuadro que suma lo de dentro'],
    ['Ctrl+A · K · Esc', 'elegir todo · sumar conectadas · quitar selección'],
    ['Arrastrar pieza', 'mover la selección (Alt: en vertical · Ctrl: paso doble · Esc cancela). Los botones «Mover en» limitan el movimiento a X, Y o Z'],
    ['Flechas', 'mover un cuarto de celda (Ctrl: media celda)'],
    ['Re Pág / Av Pág', 'subir / bajar un cuarto de celda (Ctrl: media celda)'],
    ['R · Alt+R', 'girar 90° · girar al revés'],
    ['Alt + flechas', 'tumbar 90°: la parte de arriba va hacia la flecha (según la cámara); dos veces la deja de cabeza'],
    ['M · N · U', 'reflejar en X · Z · Y'],
    ['Ctrl+G · Ctrl+Alt+G', 'agrupar · desagrupar'],
    ['Ctrl+C · V · D', 'copiar · pegar · duplicar'],
    ['Supr', 'borrar la selección'],
    ['O · Alt+O · I', 'ocultar · mostrar ocultas · aislar'],
    ['Panel “Selección”', 'aparece al elegir piezas y reúne todo lo que se hace con ellas: ocultar, aislar, agrupar, copiar, reflejar (y copiar), unir, excavar, limpiar astillas, alinear, repartir, al suelo, redimensionar, pasar a la capa activa y, debajo, centro, tamaño, giro y repetir exactos'],
    ...VIEW_GUIDE.slice(0, 1),
  ],
  erase: [
    ['Clic', 'borrar la pieza marcada en rojo (también los puntos guía)'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE,
  ],
  cut: [
    ['Clic', 'marcar un punto de la región (se pega a vértices, a la rejilla y a los vértices virtuales de las aristas prolongadas, los puntos morados)'],
    ['Ctrl+clic', 'sobre una cara: cortar con el plano de esa cara'],
    ['Clic en el primer punto / Enter', 'cerrar la región · con la región cerrada, Enter corta'],
    ['Ctrl+Enter', 'cerrar y cortar de una vez (sin revisar el lado)'],
    ['F', 'cambiar el lado que se borra (el rojo)'],
    ['Ctrl+Z / Ctrl+Y', 'quitar / reponer el último punto'],
    ['Esc', 'cancelar el corte'],
    ['Con selección', 'solo se cortan las piezas elegidas'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  fill: [
    ['Clic', 'marcar un punto (4 o más, no todos en un mismo plano); se pega también a los vértices virtuales (puntos morados donde se cruzan aristas prolongadas)'],
    ['Clic en el primer punto / Enter', 'crear la pieza que los une'],
    ['Ctrl+Z / Ctrl+Y', 'quitar / reponer el último punto'],
    ['Esc', 'cancelar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  outline: [
    ['Clic', 'marcar un punto de la figura (3 o más, en una misma cara); se pega a vértices, aristas prolongadas y vértices virtuales'],
    ['Clic en el primer punto / Enter', 'hacer crecer o hundir solo esa figura, en perpendicular a la cara'],
    ['Crecer / Hundir (panel)', 'elige el sentido; la vista previa es morada al crecer y roja al hundir'],
    ['Panel “Cuánto”', '¼, ½, ¾, 1 celda, valor exacto o Auto'],
    ['Ctrl+Z / Ctrl+Y', 'quitar / reponer el último punto'],
    ['Esc', 'cancelar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  vertex: [
    ['Clic', 'crear un punto guía en el punto amarillo (no se exporta)'],
    ['Alt', 'puntos libres sobre la arista'],
    ['Puntos por arista', 'en cuántas partes se divide cada arista (panel): ×2, ×4, ×8 o ×16'],
    ['B', 'borrar puntos guía'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  mesh: [
    ['Clic en un vértice', 'elegirlo (Shift: sumar a los elegidos)'],
    ['Arrastrar un vértice', 'moverlo con imán a ¼ de celda; Ctrl lo suelta'],
    ['Mover en: Libre · X · Y · Z', 'control único del panel (el mismo de Elegir, aquí para los vértices); botones (o, con vértices elegidos, teclas 1 / 2 / 3 de la fila de arriba: X / Y / Z; con Mayús, el plano que deja fuera ese eje): limitan el movimiento a un eje y se mantienen hasta que los cambies; R, T y las deformaciones empiezan con ese eje'],
    ['Ctrl+arrastrar en vacío', 'recuadro: elige todos los vértices dentro, también los de detrás'],
    ['Flechas', 'mover la cámara (Ctrl: más rápido); los vértices se mueven solo con el ratón'],
    ['Supr', 'quitar los vértices elegidos'],
    ['Teclado numérico', '1 frente · 3 derecha · 7 arriba (con Ctrl, la opuesta) · 5 alterna vista ortográfica o con perspectiva'],
    ['Panel (deformar)', 'Afinar, Torcer o Curvar los vértices elegidos a lo largo de un eje (Y por defecto): mueve el ratón a los lados, 1/2/3 cambia el eje X/Y/Z, clic confirma'],
    ['R / T', 'girar / escalar los vértices elegidos alrededor de su centro: mueve el ratón, 1/2/3 fija el eje X/Y/Z, clic confirma, Esc cancela (Ctrl: sin imán)'],
    ['Shift+clic en una cara', 'elegir todos sus vértices (se suman a los elegidos)'],
    ['Doble cara · Sin sombra · Al fondo', 'casillas del panel: afectan a las caras cuyos vértices están todos elegidos'],
    ['A', 'enciende y apaga el modo añadir vértice (lo mismo que el botón «+ Vértice»; en Malla sustituye a la A que oculta esta ayuda)'],
    ['U', 'trazar segmento: con dos vértices elegidos de una misma cara traza el segmento entre ellos y parte la cara; con dos que no comparten cara, deja un segmento suelto entre ellos (lo mismo que el botón; con vértices elegidos sustituye a la U que refleja piezas en Y)'],
    ['F', 'crear cara con los vértices elegidos (tres o más; con tres, un triángulo), lo mismo que el botón; con vértices elegidos sustituye a la F que abre el modo Cara'],
    ['B', 'borrar cara: quita las caras cuyos vértices están todos elegidos (la pieza queda abierta); Supr quita los vértices; con vértices elegidos sustituye a la B que abre el modo Borrar'],
    ['S', 'deslizar: enciende y apaga el modo (botón «Deslizar vértice»); con él, el vértice que arrastras y que está en medio de un segmento solo se mueve por ese segmento, sin deformar la pieza; con vértices elegidos sustituye a la S que abre el modo Elegir'],
    ['Q', 'quitar segmento: con los dos vértices de un segmento suelto, lo borra; con los de uno que separa dos caras del mismo plano, las junta en una (lo contrario de Trazar segmento; con vértices elegidos sustituye a la Q que baja las piezas)'],
    ['L', 'alinear en línea: con tres o más vértices elegidos, deja rectos los de en medio sobre la línea que une el primero y el último que elegiste (los extremos no se mueven; con vértices elegidos sustituye a la L que rellena)'],
    ['Clic en un segmento', 'elige sus dos vértices (sustituye la elección anterior); doble clic en el mismo segmento sigue en línea recta por todos los segmentos que continúan. Con varias piezas a la vista, elige primero una pieza con un clic en su cara. Shift+clic en una cara elige sus vértices'],
    ['N', 'empujar cara: con todos los vértices de una o más caras elegidos, mueve el ratón en la dirección de la cara para empujarla o jalarla sin torcerla; clic confirma, Esc cancela'],
    ['Triangular (botón)', 'junto a Quitar segmento, en «Segmentos»: parte en triángulos las caras de cuatro o más lados cuyos vértices están todos elegidos; la forma no cambia. Para juntar triángulos otra vez: Quitar segmento (Q)'],
    ['Chaflán (botón)', 'con los dos vértices de una arista elegidos, corta sus esquinas y deja una cara nueva entre las dos caras de la arista; el tamaño se pone en «Tamaño del chaflán», el mismo que usa la herramienta Chaflán. Cada extremo tiene que tocar tres caras'],
    ['Corte en anillo (botón)', 'con los dos vértices de una arista elegidos, parte por la mitad la fila de caras de cuatro lados que atraviesa (la vuelta entera si cierra) y deja elegidos los vértices nuevos para moverlos o escalarlos juntos'],
    ['M', 'extruir cara: saca las caras cuyos vértices están todos elegidos y deja elegidos los de arriba para moverlos (lo mismo que el botón «Extruir cara»; en Malla sustituye a la M que refleja piezas en X)'],
    ['K', 'tapar hueco: con un vértice elegido del borde abierto de una pieza, cierra ese contorno con una cara que mira hacia el mismo lado que sus vecinas'],
    ['P', 'aplanar en plano: lleva los vértices elegidos (tres o más, por ejemplo los de una cara chueca) al plano que mejor se ajusta a todos; con vértices elegidos sustituye a la P que abre el modo Pintar'],
    ['Simetrizar (botón)', 'con la simetría activa, deja exactamente iguales los dos lados de las piezas elegidas (o de todas): promedia cada vértice con el espejo de su gemelo y pega al plano los que están casi sobre él. Los vértices sin gemelo se ven en rosa'],
    ['D', 'quitar vértice: enciende y apaga el modo (botón «− Vértice»); con él, un clic en un vértice lo quita (con el espejo activo, también el de enfrente). En Malla sustituye a la D que hunde las piezas'],
    ['Ver vértices de atrás (casilla)', 'marcada se ven y se pueden elegir todos los vértices; sin marcar, solo los que dan a la cámara'],
    ['+ Vértice (panel)', 'activa el modo añadir: clic en una arista (en cuartos; Ctrl: donde pulses) o dentro de una cara le pone un vértice nuevo, que queda elegido para moverlo. Arrastrar sigue girando la cámara'],
    ['Alt+clic en una arista', 'ponerle un vértice nuevo sin activar el modo (en cuartos; Ctrl: donde hagas clic)'],
    ['Panel', 'Elegir: Elegir todos. Vértices: Punta (saca una copia unida al original por un segmento; con la casilla «Punta con caras», también con caras) · Fusionar vértices (junta los elegidos en uno) · Borrar vértices · Vértices a la rejilla · Soldar cercanos'],
    ['Soldar cercanos (botón)', 'junta los vértices que están a menos de la «Distancia» (por defecto 0,002 celdas) de otro, cada grupo en su punto medio, y quita las caras que se quedan sin superficie. Con vértices elegidos solo actúa sobre ellos; sin elegir ninguno, sobre todas las piezas que se ven. Con simetría el modelo sigue simétrico. Al abrir un proyecto la barra de estado avisa si hay pares así'],
    ['Panel (caras)', 'Crear cara con tres o más vértices · Borrar / Invertir / Extruir las caras cuyos vértices están todos elegidos'],
    ['Clic en una cara', 'elige solo los vértices de esa cara (Shift suma otra); en vacío suelta todo. Para elegir la pieza entera usa Elegir (S)'],
    ['Simetría', 'con sus casillas X / Y / Z activas (en el panel Simetría o con las teclas X / Y / Z, también en Malla) el movimiento se refleja en las piezas espejo'],
    ['Malla libre', 'una pieza con un vértice hundido deja de ser convexa: se puede mover, extruir y pintar, pero no cortar, restar ni unir'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  grow: [
    ['Clic', 'hacer crecer la cara apuntada la cantidad elegida en el panel'],
    ['Ctrl+clic', 'invierte “Toda la cara conectada” solo para ese clic'],
    ['Arrastrar', 'elegir otra distancia al momento'],
    ['Esc', 'cancelar el arrastre / volver a Colocar'],
    ['Panel “Cuánto”', '¼, ½, ¾, 1 celda, valor exacto o Auto'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  sink: [
    ['Clic', 'hundir la cara apuntada la cantidad elegida en el panel (la parte roja es lo que se quita)'],
    ['Ctrl+clic', 'invierte “Toda la cara conectada” solo para ese clic'],
    ['Arrastrar', 'elegir otra distancia al momento (hacia dentro)'],
    ['Esc', 'cancelar el arrastre / volver a Colocar'],
    ['Panel “Cuánto”', '¼, ½, ¾, 1 celda, valor exacto o Auto'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  paint: [
    ['Clic', 'pintar la cara apuntada'],
    ['Ctrl+clic', 'pintar toda la pieza'],
    ['Alt+clic', 'tomar el color de la cara (cuentagotas)'],
    ['Casilla “Píxeles”', 'pinta píxeles sueltos en vez de la cara entera: arrastra con lápiz, borrador o relleno (Alt toma el color del píxel); un trazo es un solo paso de deshacer'],
    ['Doble clic / Plano', 'con “Píxeles” abre la cara en plano, ampliada, para pintarla de frente con las mismas herramientas (Esc cierra)'],
    ['Texturas', 'se conservan al mover, girar, espejar, cortar, hundir y guardar; al crecer una cara, la de arriba del cuerpo nuevo hereda sus píxeles; las caras nuevas de un corte nacen sin pintar'],
    ['Colores', 'selector de la sección “Colores” y los últimos 10 usados'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  shape: [
    ['Clic', 'apoyar la forma sobre lo que apuntas'],
    ['Panel', 'medidas, lados y, en la esfera, anillos y detalle (Bajo · Medio · Alto)'],
    ['Sección', 'esfera completa, hemisferio, casquete (altura del corte), gajo (ángulo) u octante'],
    ['Girar° X · Y · Z', 'giro propio de la forma antes de colocarla'],
    ['R', 'girar 90° la forma sobre su eje (dónde queda el gajo)'],
    ['Cara plana contra la superficie', 'la sección se apoya por su corte en la cara que apuntas, sea suelo, pared o techo'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  bevel: [
    ['Clic', 'cortar la arista marcada en amarillo en chaflán'],
    ['Panel', 'tamaño del chaflán'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
  face: [
    ['Clic', 'aplicar directamente la acción elegida en el panel (Extruir / cavar o Dividir) a la cara apuntada'],
    ['Extruir', 'distancia positiva: sale un cuerpo · negativa: cava; “Punta” estrecha el extremo'],
    ['Dividir', 'parte la pieza en dos paralelamente a la cara'],
    ['Esc', 'volver a Colocar'],
    ...VIEW_GUIDE.slice(0, 2),
  ],
};

export interface Help {
  setHelp(open: boolean): void;
  isOpen(): boolean;
  /** ¿Es el buscador de la ayuda? (con el foco ahí, «?» es una letra más). */
  isSearch(target: EventTarget | null): boolean;
}

/** La ventana de ayuda: se abre y se cierra, y su buscador filtra la ayuda escrita y los atajos de cada herramienta. */
export function setupHelp(): Help {
  const helpModal = document.getElementById('helpModal')!;
  let setHelp = (open: boolean): void => {
    helpModal.hidden = !open;
  };
  document.getElementById('helpOpen')!.addEventListener('click', () => setHelp(true));
  document.getElementById('helpClose')!.addEventListener('click', () => setHelp(false));

  // Buscador de la ayuda: filtra la ayuda escrita y lista los atajos de cada herramienta que coinciden (por ejemplo "rotar").
  const helpSearchEl = document.getElementById('helpSearch') as HTMLInputElement;
  const helpResultsEl = document.getElementById('helpResults')!;
  const helpBodyEl = document.getElementById('helpBody')!;
  const plain = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const SYNONYMS: string[][] = [
    ['rot', 'gir', 'giro', 'tumb', 'volte'],
    ['mov', 'desplaz', 'trasl'],
    ['borr', 'elimin', 'quit', 'supr'],
    ['cort', 'tajo'],
    ['copi', 'duplic', 'peg'],
    ['ocult', 'escond', 'ojo'],
    ['bloque', 'candado'],
    ['capa', 'piso'],
    ['escal', 'tamano', 'tamaño', 'agrand'],
    ['color', 'pint'],
    ['deshac', 'undo', 'rehac', 'redo'],
    ['espej', 'reflej', 'simetr'],
  ];
  function searchHelp(): void {
    const words = plain(helpSearchEl.value).split(/\s+/).filter(Boolean);
    // Palabras que significan lo mismo: buscar "rotar" también encuentra "girar" o "tumbar".
    const alike = (word: string): string[] => [word, ...(SYNONYMS.find((group) => group.some((w) => word.startsWith(w) || (word.length >= 3 && w.startsWith(word))))?.filter((w) => w !== word) ?? [])];
    const matches = (text: string): boolean => {
      const haystack = plain(text);
      // Cada palabra debe empezar una palabra del texto: así "gir" encuentra "girar" pero no "elegir".
      return words.every((word) => alike(word).some((option) => new RegExp(`(^|[^a-z0-9])${option.replace(/[^a-z0-9]/g, '')}`).test(haystack)));
    };
    // La ayuda escrita: se esconden las entradas que no coinciden y los títulos que se quedan vacíos.
    let shown = 0;
    for (const dl of helpBodyEl.querySelectorAll('dl')) {
      let any = false;
      for (const dt of dl.querySelectorAll('dt')) {
        const dd = dt.nextElementSibling as HTMLElement | null;
        const ok = words.length === 0 || matches(`${dt.textContent} ${dd?.textContent ?? ''}`);
        dt.hidden = !ok;
        if (dd) dd.hidden = !ok;
        any = any || ok;
        if (ok) shown++;
      }
      dl.hidden = !any;
      (dl.previousElementSibling as HTMLElement | null)?.toggleAttribute('hidden', !any);
    }
    // Los atajos de cada herramienta (la barra de ayuda de abajo): los repetidos entre herramientas se juntan.
    helpResultsEl.replaceChildren();
    helpResultsEl.hidden = words.length === 0;
    if (words.length === 0) return;
    const seen = new Map<string, { keys: string; text: string; modes: string[] }>();
    for (const [name, entries] of Object.entries(GUIDE) as [Mode, [string, string][]][]) {
      for (const [keys, text] of entries) {
        if (!matches(`${keys} ${text} ${MODE_INFO[name].name}`)) continue;
        const entry = seen.get(`${keys}|${text}`) ?? { keys, text, modes: [] };
        entry.modes.push(MODE_INFO[name].name);
        seen.set(`${keys}|${text}`, entry);
      }
    }
    if (seen.size > 0) {
      const title = document.createElement('h3');
      title.textContent = 'Atajos por herramienta';
      const list = document.createElement('div');
      list.className = 'hrow';
      for (const { keys, text, modes } of seen.values()) {
        const k = document.createElement('b');
        k.textContent = keys;
        const t = document.createElement('span');
        t.textContent = text;
        const where = document.createElement('small');
        where.className = 'hmode';
        where.textContent = modes.length > 4 ? ` · en varias herramientas` : ` · ${modes.join(', ')}`;
        t.append(where);
        list.append(k, t);
      }
      helpResultsEl.append(title, list);
    }
    if (seen.size === 0 && shown === 0) {
      const none = document.createElement('div');
      none.id = 'helpNone';
      none.textContent = 'No hay nada con esa palabra. Prueba con otra (por ejemplo: girar, borrar, copiar).';
      helpResultsEl.append(none);
    }
  }
  helpSearchEl.addEventListener('input', searchHelp);
  const openHelp = setHelp;
  setHelp = (open: boolean): void => {
    openHelp(open);
    if (open) {
      helpSearchEl.value = '';
      searchHelp();
      helpSearchEl.focus();
    } else {
      // El campo oculto no debe conservar el foco: se comería los atajos siguientes.
      helpSearchEl.blur();
    }
  };
  helpModal.addEventListener('pointerdown', (e) => {
    if (e.target === helpModal) setHelp(false);
  });
  return { setHelp: (open) => setHelp(open), isOpen: () => !helpModal.hidden, isSearch: (target) => target === helpSearchEl };
}
