import { describe, expect, it } from 'vitest';
import { searchCommands, type Command } from './commands';

const run = () => {};
const commands: Command[] = [
  { name: 'Girar 90° sobre Y', keywords: 'rotar giro', run },
  { name: 'Rotar a un ángulo', keywords: 'girar', run },
  { name: 'Espejo en X', keywords: 'reflejar simetria', run },
  { name: 'Guardar', run },
];

describe('searchCommands', () => {
  it('sin texto devuelve todo en su orden', () => {
    expect(searchCommands(commands, '').map((c) => c.name)).toEqual(commands.map((c) => c.name));
  });

  it('ignora mayúsculas y tildes y mira las palabras clave', () => {
    expect(searchCommands(commands, 'ANGULO').map((c) => c.name)).toEqual(['Rotar a un ángulo']);
    expect(searchCommands(commands, 'simetría').map((c) => c.name)).toEqual(['Espejo en X']);
  });

  it('pone primero los que empiezan por lo escrito', () => {
    expect(searchCommands(commands, 'rotar').map((c) => c.name)).toEqual(['Rotar a un ángulo', 'Girar 90° sobre Y']);
  });

  it('exige todas las palabras', () => {
    expect(searchCommands(commands, 'espejo guardar')).toEqual([]);
  });
});
