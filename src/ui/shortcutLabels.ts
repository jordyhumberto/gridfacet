import { shortcutLabel } from '../core/shortcuts';

/**
 * Escribe el nombre de la tecla en los textos y títulos de la página: cada elemento con `data-shortcut="acción"` (ver `findShortcut`)
 * cambia su `{key}` por el atajo que dice la tabla de `core/shortcuts.ts`, así el botón y el teclado no se desacuerdan.
 * Va antes que los paneles que leen esos títulos.
 */
export function applyShortcutLabels(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-shortcut]')) {
    const key = shortcutLabel(el.dataset.shortcut!);
    if (!key) continue;
    if (el.title.includes('{key}')) el.title = el.title.replaceAll('{key}', key);
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.includes('{key}')) node.textContent = node.textContent.replaceAll('{key}', key);
    }
  }
}
