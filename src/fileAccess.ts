/**
 * Guardar y abrir con el selector de archivos del sistema (File System Access API), para elegir carpeta y nombre.
 * Solo existe en navegadores basados en Chromium; sin ella se vuelve a la descarga normal.
 */

export interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
}

interface PickerOptions {
  suggestedName?: string;
  types: { description: string; accept: Record<string, string[]> }[];
}

type PickerWindow = Window & {
  showSaveFilePicker?: (options: PickerOptions) => Promise<FileHandle>;
  showOpenFilePicker?: (options: PickerOptions) => Promise<FileHandle[]>;
};

const picker = (): PickerWindow => window as PickerWindow;

const KEY = 'gridfacet.systemPicker';

/** El selector del sistema es opcional (apagado por defecto): en algunos navegadores el diálogo no aparece o nunca responde, y entonces ni se guarda ni se abre. */
export function systemPickerEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setSystemPicker(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // Sin almacenamiento la opción vale solo para esta sesión.
  }
}

export const canPickSave = (): boolean => systemPickerEnabled() && typeof picker().showSaveFilePicker === 'function';
export const canPickOpen = (): boolean => systemPickerEnabled() && typeof picker().showOpenFilePicker === 'function';

const isCancel = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

function types(description: string, mime: string, extension: string): PickerOptions['types'] {
  return [{ description, accept: { [mime]: [extension] } }];
}

/** Abre el diálogo de guardar; devuelve null si el usuario lo cancela. */
export async function pickSave(suggestedName: string, description: string, mime: string, extension: string): Promise<FileHandle | null> {
  try {
    return await picker().showSaveFilePicker!({ suggestedName, types: types(description, mime, extension) });
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

/** Abre el diálogo de abrir; devuelve null si el usuario lo cancela. */
export async function pickOpen(description: string, mime: string, extension: string): Promise<FileHandle | null> {
  try {
    const [handle] = await picker().showOpenFilePicker!({ types: types(description, mime, extension) });
    return handle ?? null;
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

export async function writeHandle(handle: FileHandle, data: BlobPart): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}
