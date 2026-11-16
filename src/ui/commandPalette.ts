import { searchCommands, type Command } from '../core/commands';

export interface CommandPalette {
  /** Abre Comandos (Ctrl+K) con el buscador vacío. */
  open(): void;
}

/** Comandos (Ctrl+K): busca cualquier acción por nombre y la ejecuta. La lista de comandos la arma la aplicación. */
export function createCommandPalette(commands: Command[]): CommandPalette {
  const paletteEl = document.getElementById('palette')!;
  const paletteInput = document.getElementById('paletteInput') as HTMLInputElement;
  const paletteList = document.getElementById('paletteList')!;
  let paletteMatches: Command[] = [];
  let paletteIndex = 0;
  const isPaletteOn = (c: Command): boolean => c.enabled?.() ?? true;

  function renderPalette(): void {
    paletteMatches = searchCommands(commands, paletteInput.value);
    paletteIndex = Math.max(0, paletteMatches.findIndex(isPaletteOn));
    paletteList.replaceChildren();
    paletteMatches.forEach((command, i) => {
      const row = document.createElement('div');
      row.className = `pcmd${i === paletteIndex ? ' active' : ''}${isPaletteOn(command) ? '' : ' off'}`;
      row.append(Object.assign(document.createElement('span'), { textContent: command.name }));
      if (command.shortcut) row.append(Object.assign(document.createElement('kbd'), { textContent: command.shortcut }));
      row.addEventListener('click', () => runPaletteCommand(command));
      paletteList.appendChild(row);
    });
  }
  function runPaletteCommand(command: Command): void {
    if (!isPaletteOn(command)) return;
    setPalette(false);
    command.run();
  }
  function setPalette(on: boolean): void {
    paletteEl.hidden = !on;
    if (!on) {
      // Sin esto el campo oculto conserva el foco y se come los atajos siguientes.
      paletteInput.blur();
      return;
    }
    paletteInput.value = '';
    renderPalette();
    paletteInput.focus();
  }
  paletteInput.addEventListener('input', renderPalette);
  paletteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setPalette(false);
    else if (e.key === 'Enter' && paletteMatches[paletteIndex]) runPaletteCommand(paletteMatches[paletteIndex]);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      paletteIndex = (paletteIndex + step + paletteMatches.length) % Math.max(1, paletteMatches.length);
      [...paletteList.children].forEach((row, i) => row.classList.toggle('active', i === paletteIndex));
      paletteList.children[paletteIndex]?.scrollIntoView({ block: 'nearest' });
    }
    e.stopPropagation();
  });
  paletteEl.addEventListener('pointerdown', (e) => {
    if (e.target === paletteEl) setPalette(false);
  });
  return { open: () => setPalette(true) };
}
