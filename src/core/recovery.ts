/** Una copia de recuperación: el texto del proyecto, cuántas piezas tenía y cuándo se guardó. */
export interface RecoveryEntry {
  data: string;
  pieces: number;
  /** Instante (milisegundos) en que se hizo la copia. */
  savedAt: number;
}

/** Cuántas copias se conservan: la más nueva primero. */
export const MAX_GENERATIONS = 3;

/**
 * Añade una copia al principio de la lista y deja solo las últimas `max`.
 * No añade nada si la copia está vacía (no hay trabajo que proteger) o si es idéntica a la más reciente (no cambió nada).
 */
export function addGeneration(list: readonly RecoveryEntry[], entry: RecoveryEntry, max = MAX_GENERATIONS): RecoveryEntry[] {
  if (entry.pieces <= 0) return [...list];
  if (list[0]?.data === entry.data) return [...list];
  return [entry, ...list].slice(0, max);
}

/** Texto para guardar la lista en el almacenamiento del navegador. */
export const serializeGenerations = (list: readonly RecoveryEntry[]): string => JSON.stringify(list);

/** Lee la lista guardada; lo dañado o con otra forma se descarta sin avisar (queda una lista más corta o vacía). */
export function parseGenerations(text: string | null): RecoveryEntry[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: RecoveryEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { data, pieces, savedAt } = item as Record<string, unknown>;
    if (typeof data !== 'string' || typeof pieces !== 'number' || typeof savedAt !== 'number') continue;
    out.push({ data, pieces, savedAt });
  }
  return out.slice(0, MAX_GENERATIONS);
}

/** «3 piezas · hoy 9:07»: lo que se muestra para elegir qué copia recuperar. */
export function describeGeneration(entry: RecoveryEntry, now = Date.now()): string {
  const count = `${entry.pieces} ${entry.pieces === 1 ? 'pieza' : 'piezas'}`;
  if (!entry.savedAt) return count;
  const date = new Date(entry.savedAt);
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const day = sameDay ? 'hoy' : `${date.getDate()}/${date.getMonth() + 1}`;
  return `${count} · ${day} ${time}`;
}
