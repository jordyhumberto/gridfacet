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

export const canPickSave = (): boolean => typeof picker().showSaveFilePicker === 'function';
export const canPickOpen = (): boolean => typeof picker().showOpenFilePicker === 'function';

/**
 * El selector no llegó a mostrarse o Chrome lo cerró por su cuenta. Chrome cancela el diálogo de archivos cuando la ventana del diálogo
 * tapa Chrome por completo (lo marca como «ocluido»), algo que pasa si el diálogo está maximizado.
 */
export class PickerUnresponsive extends Error {}

/**
 * Ejecuta el selector del sistema con un vigilante: al abrirse el diálogo la ventana pierde el foco. Si pasan 3 s sin que eso ocurra y sin respuesta,
 * el diálogo no se está mostrando (algunos navegadores o paneles integrados lo bloquean sin avisar) y se rinde para que Guardar y Abrir no queden mudos.
 */
function watched<T>(start: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let blurred = !document.hasFocus();
    const onBlur = (): void => {
      blurred = true;
    };
    window.addEventListener('blur', onBlur);
    const done = (): void => {
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
    };
    const timer = setTimeout(() => {
      if (blurred) return;
      done();
      reject(new PickerUnresponsive('el selector de archivos no respondió'));
    }, 3000);
    const began = performance.now();
    start().then(
      (value) => {
        done();
        resolve(value);
      },
      (error) => {
        done();
        // Nadie cancela un diálogo en menos de medio segundo: un «cancelado» así de rápido es el navegador negándose a mostrarlo.
        if (isCancel(error) && performance.now() - began < 500) reject(new PickerUnresponsive('el navegador canceló el selector al instante'));
        // Si la persona cancela, la ventana del diálogo ya se cerró y la página recupera el foco. Un «cancelado» sin foco es Chrome rindiéndose con el diálogo aún abierto.
        else if (isCancel(error) && !document.hasFocus()) reject(new PickerUnresponsive('Chrome canceló el guardado con la ventana todavía abierta'));
        else reject(error);
      },
    );
  });
}

const isCancel = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

function types(description: string, mime: string, extension: string): PickerOptions['types'] {
  return [{ description, accept: { [mime]: [extension] } }];
}

/** Abre el diálogo de guardar; devuelve null si el usuario lo cancela. */
export async function pickSave(suggestedName: string, description: string, mime: string, extension: string): Promise<FileHandle | null> {
  try {
    return await watched(() => picker().showSaveFilePicker!({ suggestedName, types: types(description, mime, extension) }));
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

/** Abre el diálogo de abrir; devuelve null si el usuario lo cancela. */
export async function pickOpen(description: string, mime: string, extension: string): Promise<FileHandle | null> {
  try {
    const [handle] = await watched(() => picker().showOpenFilePicker!({ types: types(description, mime, extension) }));
    return handle ?? null;
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

/** Explicación para la persona de por qué no se abrió o se cerró el diálogo de archivos, y qué hacer. */
export const PICKER_HELP = 'Chrome cerró la ventana para elegir el archivo antes de terminar. Lo hace cuando esa ventana tapa Chrome por completo (por ejemplo, si está maximizada). Vuelve a pulsar el botón y, si la ventana sale a pantalla completa, hazla más pequeña con doble clic en su barra de título; Windows recordará el tamaño. Otra opción: en chrome://flags desactiva «Calculate window occlusion on Windows» y reinicia Chrome.';

export async function writeHandle(handle: FileHandle, data: BlobPart): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}
