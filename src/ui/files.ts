import type * as THREE from 'three';
import type { Animation } from '../core/animation';
import { pruneTracks } from '../core/animation';
import type { ExportMode } from '../core/export';
import { buildObj } from '../core/obj';
import type { Piece } from '../core/piece';
import { describeDiscarded, parseProjectFull } from '../core/project';
import { MAX_GENERATIONS, addGeneration, describeGeneration, parseGenerations, serializeGenerations, type RecoveryEntry } from '../core/recovery';
import { nearVertexCount } from '../core/vertices';
import { spriteFileName, type SpriteCamera } from '../core/sprites';
import { canPickOpen, canPickSave, PICKER_HELP, PickerUnresponsive, pickOpen, pickSave, writeHandle, type FileHandle } from '../fileAccess';
import { downloadBlob, exportGlb } from '../render/glb';
import { framesToPngs, framesToSheet, renderSprites } from '../render/sprites';
import { atlasToPng } from '../render/textures';
import type { ModelScene } from '../scene';
import { WELD_DISTANCE } from '../tools/meshTool';

/** Lo que Archivo necesita de la aplicación. */
export interface FilesHost {
  model: ModelScene;
  statusEl: HTMLElement;
  renderer: THREE.WebGLRenderer;
  /** El proyecto de ahora como texto; con `false` sin las imágenes de referencia (la copia automática las suelta si no caben). */
  serialize(withReferences: boolean): string;
  layerName(id: number): string;
  animation(): Animation;
  visiblePieces(): Piece[];
  /** Cambia toda la escena por la del proyecto (capas, animación, referencias, tamaño de sala). Vacía el historial. */
  loadProject(project: ReturnType<typeof parseProjectFull>): void;
}

export interface Files {
  readonly dirty: boolean;
  readonly fileName: string;
  /** Hay cambios sin guardar. */
  markDirty(): void;
  scheduleAutosave(): void;
  syncFileName(): void;
  saveProject(asNew?: boolean): Promise<void>;
  requestOpen(): Promise<void>;
  newProject(): void;
  /** Muestra u oculta la lista de copias recuperables. */
  toggleRecoverList(): void;
  /** Aparta la copia automática de la sesión anterior como una generación recuperable. Se llama una vez, al arrancar. */
  stashPreviousSession(): void;
}

/** Guardar, abrir, exportar, recuperar y la copia automática. */
export function createFiles(host: FilesHost): Files {
  const { model, statusEl } = host;
  // Nombre del archivo abierto o guardado; el punto avisa de cambios sin guardar.
  const fileNameEl = document.getElementById('fileName')!;
  let fileName = 'Sin título';
  let dirty = false;

  /** Copia automática de la escena en el navegador: si se cierra o recarga la página sin guardar, se recupera al volver. */
  const AUTOSAVE_KEY = 'gridfacet.autosave';
  /** Cuándo se hizo la última copia automática (para la lista de «Recuperar…»). */
  const AUTOSAVE_TIME_KEY = 'gridfacet.autosave.time';
  let autosaveTimer: number | undefined;
  function scheduleAutosave(): void {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      try {
        try {
          localStorage.setItem(AUTOSAVE_KEY, host.serialize(true));
        } catch {
          // Con imágenes la copia puede no caber: se guarda sin ellas antes que perder el modelo.
          localStorage.setItem(AUTOSAVE_KEY, host.serialize(false));
        }
        localStorage.setItem(AUTOSAVE_TIME_KEY, String(Date.now()));
      } catch {
        // Sin espacio o sin acceso al almacenamiento: no se copia, pero el trabajo sigue.
      }
    }, 800);
  }
  function syncFileName(): void {
    const label = `${dirty ? '● ' : ''}${fileName}`;
    fileNameEl.textContent = label;
    document.title = `${label} · Gridfacet`;
  }
  syncFileName();

  const openFileEl = document.getElementById('openFile') as HTMLInputElement;

  /** Archivo del sistema vinculado al proyecto: Guardar escribe ahí sin volver a preguntar. */
  let fileHandle: FileHandle | null = null;

  const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'error desconocido');

  /** Un fallo al guardar o abrir se muestra en un aviso: la línea de estado es pequeña y pasa desapercibida. */
  function fileProblem(message: string): void {
    statusEl.textContent = message;
    window.alert(message);
  }

  /** Guardar escribe sobre el archivo actual; "Guardar como" (o un proyecto nuevo) abre el diálogo para elegir carpeta y nombre. */
  async function saveProject(asNew = false): Promise<void> {
    const pieces = model.all();
    // Si esto falla (texturas o referencias dañadas, por ejemplo) no debe quedar mudo: antes la promesa fallaba sin avisar y parecía que Guardar no hacía nada.
    let data: string;
    try {
      data = host.serialize(true);
    } catch (error) {
      fileProblem(`No se pudo preparar el proyecto para guardarlo: ${errorText(error)}`);
      return;
    }
    const suggested = fileName === 'Sin título' ? 'gridfacet-proyecto.json' : fileName.replace(/(\.json)?$/i, '.json');
    let name = suggested;
    try {
      if (canPickSave()) {
        let handle = asNew ? null : fileHandle;
        if (!handle) {
          statusEl.textContent = 'Abriendo el selector de archivos…';
          try {
            handle = await pickSave(suggested, 'Proyecto de Gridfacet', 'application/json', '.json');
          } catch (error) {
            // No se guarda nada a escondidas: se explica por qué no salió el diálogo y cómo arreglarlo.
            fileProblem(error instanceof PickerUnresponsive ? `No se guardó. ${PICKER_HELP}` : `No se pudo guardar: ${errorText(error)}`);
            return;
          }
          if (!handle) {
            statusEl.textContent = 'Guardado cancelado';
            return;
          }
        }
        try {
          await writeHandle(handle, data);
          // Algunos navegadores dan por bueno el guardado y dejan el archivo vacío: se comprueba leyéndolo de vuelta.
          if ((await handle.getFile()).size === 0 && data.length > 0) throw new Error('el archivo quedó vacío');
          fileHandle = handle;
          name = handle.name;
        } catch (error) {
          // Algunos navegadores (o paneles integrados) crean el archivo pero no dejan escribir en él: queda vacío. Se guarda como descarga normal.
          fileHandle = null;
          downloadBlob(data, suggested, 'application/json');
          fileProblem(`No se pudo escribir en ${handle.name} (${errorText(error)}); se descargó ${suggested} en su lugar`);
          fileName = suggested;
          dirty = false;
          syncFileName();
          return;
        }
      } else {
        // Sin selector del sistema el archivo se descarga: «Guardar como» pide el nombre y va a la carpeta de descargas del navegador.
        let target = suggested;
        if (asNew) {
          const typed = window.prompt('Nombre del archivo', suggested);
          if (!typed) return;
          target = typed.replace(/(\.json)?$/i, '.json');
        }
        downloadBlob(data, target, 'application/json');
        name = target;
      }
    } catch (error) {
      fileProblem(`No se pudo guardar: ${errorText(error)}`);
      return;
    }
    fileName = name;
    dirty = false;
    syncFileName();
    statusEl.textContent = `Guardado ${name} (${pieces.length} piezas)`;
  }

  /** Abrir reemplaza todo el proyecto y vacía el historial: no se puede deshacer (Ctrl+Z no vuelve al archivo anterior). */
  async function openProject(file: File, handle: FileHandle | null = null): Promise<void> {
    try {
      const project = parseProjectFull(await file.text());
      replaceProject(project, file.name, handle);
      statusEl.textContent = `Abierto ${file.name} (${project.pieces.length} piezas)`;
      const lost = describeDiscarded(project.discarded);
      if (lost) statusEl.textContent += ` · ${lost}`;
      // Vértices que parecen soldados y no lo están: se avisa, sin tocar nada.
      const near = project.pieces.reduce((sum, piece) => sum + nearVertexCount(piece, WELD_DISTANCE), 0);
      if (near > 0) statusEl.textContent += ` · ${near} ${near === 1 ? 'vértice casi encima de otro' : 'vértices casi encima de otro'}: Soldar cercanos (en Malla) los junta`;
    } catch (error) {
      fileProblem(error instanceof Error ? `No se pudo abrir: ${error.message}` : 'No se pudo abrir el archivo');
    }
  }

  /** Con cambios sin guardar pide confirmación antes de tirarlos; devuelve si se puede seguir. */
  function confirmDiscard(question: string): boolean {
    return !dirty || window.confirm(`Hay cambios sin guardar. ${question}`);
  }

  /** Empieza de cero: lienzo en blanco sin piezas, capas, animación ni referencias, y sin archivo vinculado. No se puede deshacer. */
  function newProject(): void {
    if (!confirmDiscard('¿Empezar un proyecto nuevo de todas formas?')) return;
    replaceProject({ pieces: [], marks: [], references: [], discarded: { pieces: 0, faces: 0, segments: 0 } }, 'Sin título', null);
    statusEl.textContent = 'Proyecto nuevo en blanco';
  }

  /** Cambia toda la escena por la de un proyecto y lo deja vinculado al archivo `name`. Vacía el historial: lo anterior no se puede deshacer, porque el archivo vinculado ya no sería el mismo. */
  function replaceProject(project: ReturnType<typeof parseProjectFull>, name: string, handle: FileHandle | null): void {
    host.loadProject(project);
    fileHandle = handle;
    fileName = name;
    dirty = false;
    syncFileName();
  }

  /** Con el selector del sistema se conserva el archivo para poder guardar encima; si no, se usa el campo de archivo clásico. */
  async function requestOpen(): Promise<void> {
    if (!confirmDiscard('¿Abrir otro archivo de todas formas?')) return;
    if (!canPickOpen()) {
      openFileEl.click();
      return;
    }
    try {
      const handle = await pickOpen('Proyecto de Gridfacet', 'application/json', '.json');
      if (handle) await openProject(await handle.getFile(), handle);
    } catch (error) {
      if (error instanceof PickerUnresponsive) {
        fileProblem(`No se abrió nada. ${PICKER_HELP}`);
        return;
      }
      fileProblem(`No se pudo abrir: ${errorText(error)}`);
    }
  }

  document.getElementById('new')!.addEventListener('click', () => newProject());
  document.getElementById('save')!.addEventListener('click', () => void saveProject(false));
  document.getElementById('saveAs')!.addEventListener('click', () => void saveProject(true));
  document.getElementById('open')!.addEventListener('click', () => void requestOpen());
  openFileEl.addEventListener('change', () => {
    const file = openFileEl.files?.[0];
    openFileEl.value = '';
    if (file) void openProject(file);
  });

  document.getElementById('export')!.addEventListener('click', async () => {
    const pieces = model.all();
    if (pieces.length === 0) {
      statusEl.textContent = 'No hay piezas que exportar';
      return;
    }
    const exportMode = (document.getElementById('exportMode') as HTMLSelectElement).value as ExportMode;
    const suggested = fileName === 'Sin título' ? 'gridfacet.glb' : fileName.replace(/\.json$/i, '') + '.glb';
    try {
      // El selector de archivos se pide primero: necesita el gesto del usuario, que se pierde si antes se tarda en generar el modelo.
      const handle = canPickSave() ? await pickSave(suggested, 'Modelo GLB', 'model/gltf-binary', '.glb') : null;
      if (canPickSave() && !handle) return;
      const data = await exportGlb(pieces, exportMode, host.layerName, pruneTracks(host.animation(), pieces));
      let saved = suggested;
      if (handle) {
        await writeHandle(handle, data);
        saved = handle.name;
      } else {
        downloadBlob(data, suggested, 'model/gltf-binary');
      }
      statusEl.textContent = `Exportado ${saved} (${pieces.length} piezas)`;
    } catch (error) {
      statusEl.textContent = `No se pudo exportar: ${errorText(error)}`;
    }
  });

  /** OBJ con texturas: baja el .obj, el .mtl y, si hay píxeles pintados, el PNG del atlas (tres descargas que deben quedar juntas). */
  document.getElementById('exportObj')!.addEventListener('click', async () => {
    const pieces = model.all();
    if (pieces.length === 0) {
      statusEl.textContent = 'No hay piezas que exportar';
      return;
    }
    const base = (fileName === 'Sin título' ? 'gridfacet' : fileName.replace(/\.json$/i, '')).replace(/[\/:*?"<>|\s]+/g, '_');
    try {
      const { obj, mtl, atlas } = buildObj(pieces, base);
      downloadBlob(obj, `${base}.obj`, 'text/plain');
      downloadBlob(mtl, `${base}.mtl`, 'text/plain');
      if (atlas) downloadBlob(await atlasToPng(atlas), `${base}-texture.png`, 'image/png');
      statusEl.textContent = `Exportado ${base}.obj, .mtl${atlas ? ' y el PNG de texturas' : ''}: guárdalos en la misma carpeta`;
    } catch (error) {
      statusEl.textContent = `No se pudo exportar el OBJ: ${errorText(error)}`;
    }
  });

  /** Sprites de píxel art: cada vista se dibuja con cámara ortográfica directo al tamaño pedido. */
  document.getElementById('exportSprites')!.addEventListener('click', async () => {
    const pieces = host.visiblePieces();
    if (pieces.length === 0) {
      statusEl.textContent = 'No hay piezas visibles que exportar';
      return;
    }
    const read = (id: string): string => (document.getElementById(id) as HTMLSelectElement).value;
    const size = Number(read('spriteSize'));
    const views = Number(read('spriteViews'));
    const sheet = (document.getElementById('spriteSheet') as HTMLInputElement).checked;
    const project = fileName === 'Sin título' ? 'gridfacet' : fileName;
    try {
      const frames = renderSprites(host.renderer, pieces, {
        size,
        views,
        camera: read('spriteCamera') as SpriteCamera,
        shading: read('spriteShading') as 'flat' | 'shaded',
        outline: (document.getElementById('spriteOutline') as HTMLInputElement).checked,
        outlineColor: 0x000000,
      });
      if (sheet && frames.length > 1) {
        const { blob, cols, rows } = await framesToSheet(frames);
        downloadBlob(blob, spriteFileName(project, size, 0).replace('-view0', `-sheet-${cols}x${rows}`), 'image/png');
      } else {
        (await framesToPngs(frames)).forEach((blob, i) => downloadBlob(blob, spriteFileName(project, size, i + 1), 'image/png'));
      }
      statusEl.textContent = `Exportado ${frames.length === 1 || !sheet ? `${frames.length} PNG` : 'hoja de sprites'} de ${size} px`;
    } catch (error) {
      statusEl.textContent = `No se pudo exportar los sprites: ${errorText(error)}`;
    }
  });

  /** Las últimas copias de trabajos de sesiones anteriores (la más nueva primero), guardadas aparte para poder recuperarlas sin que se cuelen en la hoja nueva. */
  const RECOVERY_KEY = 'gridfacet.recovery';
  /** Clave de la versión anterior, que guardaba una sola copia: se aprovecha al leer. */
  const PREVIOUS_KEY = 'gridfacet.previous';

  function readRecovery(): RecoveryEntry[] {
    try {
      const list = parseGenerations(localStorage.getItem(RECOVERY_KEY));
      const legacy = localStorage.getItem(PREVIOUS_KEY);
      if (legacy) {
        const entry = describeEntry(legacy, 0);
        if (entry && !list.some((e) => e.data === entry.data)) return [...list, entry].slice(0, MAX_GENERATIONS);
      }
      return list;
    } catch {
      return [];
    }
  }

  /** Lee un proyecto guardado como texto y lo resume; sin piezas o ilegible da `null`. */
  function describeEntry(text: string, savedAt: number): RecoveryEntry | null {
    try {
      const { pieces } = parseProjectFull(text);
      return pieces.length === 0 ? null : { data: text, pieces: pieces.length, savedAt };
    } catch {
      return null;
    }
  }

  function writeRecovery(list: RecoveryEntry[]): void {
    // Si no caben todas se van soltando las más viejas: más vale guardar menos que nada.
    for (let keep = list.length; keep >= 0; keep--) {
      try {
        localStorage.setItem(RECOVERY_KEY, serializeGenerations(list.slice(0, keep)));
        localStorage.removeItem(PREVIOUS_KEY);
        return;
      } catch {
        // Sin espacio: se reintenta con una copia menos.
      }
    }
  }

  /**
   * Al abrir la página se empieza en una hoja en blanco: la última copia automática ya no se mete sola en la escena (se confundía con el
   * trabajo de ahora). Se aparta como una generación más (se conservan las 3 últimas) y se puede traer con «Recuperar…».
   * Una copia vacía o igual a la última generación no se guarda: dos recargas seguidas no pisan el trabajo bueno.
   */
  function stashPreviousSession(): void {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return;
      const savedAt = Number(localStorage.getItem(AUTOSAVE_TIME_KEY)) || Date.now();
      const entry = describeEntry(text, savedAt);
      localStorage.removeItem(AUTOSAVE_KEY);
      localStorage.removeItem(AUTOSAVE_TIME_KEY);
      if (!entry) return;
      const before = readRecovery();
      writeRecovery(addGeneration(before, entry));
      statusEl.textContent = `Hoja nueva. Tu trabajo anterior (${entry.pieces} piezas) sigue disponible: pulsa «Recuperar…» en Archivo`;
    } catch {
      // Una copia dañada o ilegible se ignora: se empieza con la escena vacía.
    }
  }
  stashPreviousSession();

  /** Trae a la escena una copia de una sesión anterior. Reemplaza la hoja actual y no se puede deshacer. */
  function recoverGeneration(entry: RecoveryEntry): void {
    try {
      if (!confirmDiscard('¿Reemplazar la hoja actual por el trabajo anterior?')) return;
      const project = parseProjectFull(entry.data);
      replaceProject(project, 'Sin título', null);
      dirty = true;
      syncFileName();
      statusEl.textContent = `Recuperado el trabajo anterior (${project.pieces.length} piezas). Guárdalo en un archivo para no perderlo${describeDiscarded(project.discarded) ? ` · ${describeDiscarded(project.discarded)}` : ''}`;
    } catch (error) {
      fileProblem(`No se pudo recuperar: ${errorText(error)}`);
    }
  }

  const recoverListEl = document.getElementById('recoverList')!;

  /** Muestra u oculta la lista de copias recuperables, cada una con su fecha y número de piezas. */
  function toggleRecoverList(): void {
    if (!recoverListEl.hidden) {
      recoverListEl.hidden = true;
      return;
    }
    const list = readRecovery();
    recoverListEl.replaceChildren();
    if (list.length === 0) {
      statusEl.textContent = 'No hay un trabajo anterior que recuperar';
      return;
    }
    for (const entry of list) {
      const button = document.createElement('button');
      button.textContent = describeGeneration(entry);
      button.title = 'Traer este trabajo a la hoja actual';
      button.addEventListener('click', () => {
        recoverListEl.hidden = true;
        recoverGeneration(entry);
      });
      recoverListEl.append(button);
    }
    recoverListEl.hidden = false;
  }
  document.getElementById('recover')!.addEventListener('click', toggleRecoverList);

  // Cerrar o recargar con cambios sin guardar: el navegador pregunta antes.
  window.addEventListener('beforeunload', (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  return {
    get dirty() {
      return dirty;
    },
    get fileName() {
      return fileName;
    },
    markDirty: () => {
      dirty = true;
    },
    scheduleAutosave,
    syncFileName,
    saveProject,
    requestOpen,
    newProject,
    toggleRecoverList,
    stashPreviousSession,
  };
}
