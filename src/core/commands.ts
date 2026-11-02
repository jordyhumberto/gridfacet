/** Una acción que se puede lanzar desde la paleta de comandos. */
export interface Command {
  name: string;
  /** Otras palabras con las que se busca (sinónimos, atajo). */
  keywords?: string;
  /** Atajo de teclado, solo para mostrarlo. */
  shortcut?: string;
  /** Se atenúa y no se ejecuta cuando no hay nada sobre lo que actuar. */
  enabled?: () => boolean;
  run: () => void;
}

/** Minúsculas y sin tildes, para que "rotar", "Rotár" y "ROTAR" coincidan. */
export const plain = (text: string): string => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Comandos que coinciden con la búsqueda: cada palabra escrita debe aparecer en el nombre o en las palabras clave.
 * Primero los que empiezan por lo escrito, luego los demás en su orden; sin texto salen todos.
 */
export function searchCommands(commands: Command[], query: string): Command[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const scored: { command: Command; rank: number }[] = [];
  commands.forEach((command, index) => {
    const name = plain(command.name);
    const text = `${name} ${plain(command.keywords ?? '')}`;
    if (!words.every((word) => text.includes(word))) return;
    const starts = words.length > 0 && name.startsWith(words[0]) ? 0 : 1;
    scored.push({ command, rank: starts * 1000 + index });
  });
  return scored.sort((a, b) => a.rank - b.rank).map((entry) => entry.command);
}
