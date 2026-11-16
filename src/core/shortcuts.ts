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
const MESH_FREE_KEYS = new Set(['m', 'n', 'u', 'k', 'o', 'i']);
/**
 * ¿Debe ignorarse esta tecla en Malla, una vez que `MeshTool.handleKey` no la tomó?
 * Los dígitos solo estorban cuando hay vértices elegidos (cambiar de herramienta los soltaría).
 */
export function meshIgnoresKey(key: string, chosenVertices: number): boolean {
  if (MESH_FREE_KEYS.has(key)) return true;
  return /^[1-9]$/.test(key) && chosenVertices > 0;
}
