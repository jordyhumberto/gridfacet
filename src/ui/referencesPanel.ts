import type * as THREE from 'three';
import { defaultReference, nextReferenceId, withPlane, type RefImage, type RefPlane } from '../core/references';
import { ReferenceLayer, loadReferenceFile } from '../render/references';

export interface ReferencesHost {
  scene3d: THREE.Scene;
  statusEl: HTMLElement;
  /** Celdas por lado de la sala: las imágenes nuevas se ajustan a ella. */
  gridSize(): number;
  /** Las imágenes cambiaron por una edición (no al abrir un proyecto): hay cambios sin guardar. */
  changed(): void;
}

export interface ReferencesPanel {
  readonly references: RefImage[];
  /** Pone estas imágenes (al abrir un proyecto) y redibuja lista y escena. */
  set(next: RefImage[]): void;
}

/** Imágenes de referencia: se ven al fondo de la escena, se guardan con el proyecto y no cuentan como piezas. */
export function createReferencesPanel(host: ReferencesHost): ReferencesPanel {
  const { scene3d, statusEl } = host;
  let references: RefImage[] = [];
  const referenceLayer = new ReferenceLayer();
  scene3d.add(referenceLayer.group);
  const refListEl = document.getElementById('refList')!;
  const refFileEl = document.getElementById('refFile') as HTMLInputElement;

  /** Cambia las imágenes (al abrir un proyecto o tras editar una) y redibuja lista y escena. */
  function setReferences(next: RefImage[], changed = false): void {
    references = next;
    referenceLayer.set(references);
    renderReferenceList();
    if (changed) {
      host.changed();
    }
  }

  function updateReference(id: number, change: Partial<RefImage> | ((r: RefImage) => RefImage)): void {
    setReferences(references.map((r) => (r.id === id ? (typeof change === 'function' ? change(r) : { ...r, ...change }) : r)), true);
  }

  const PLANE_LABELS: Record<RefPlane, string> = { front: 'De frente', side: 'De lado', top: 'Desde arriba' };

  function renderReferenceList(): void {
    refListEl.replaceChildren();
    for (const image of references) {
      const row = document.createElement('div');
      row.className = 'refItem';
      const head = document.createElement('div');
      head.className = 'row';
      const visible = document.createElement('input');
      visible.type = 'checkbox';
      visible.checked = image.visible;
      visible.title = 'Mostrar u ocultar la imagen';
      visible.addEventListener('change', () => updateReference(image.id, { visible: visible.checked }));
      const name = document.createElement('strong');
      name.textContent = image.name;
      name.title = image.name;
      const plane = document.createElement('select');
      plane.title = 'Hacia dónde mira la imagen';
      for (const key of Object.keys(PLANE_LABELS) as RefPlane[]) plane.add(new Option(PLANE_LABELS[key], key, false, key === image.plane));
      plane.addEventListener('change', () => updateReference(image.id, (r) => withPlane(r, plane.value as RefPlane, host.gridSize())));
      const remove = document.createElement('button');
      remove.textContent = '✕';
      remove.title = 'Quitar la imagen del proyecto';
      remove.addEventListener('click', () => setReferences(references.filter((r) => r.id !== image.id), true));
      head.append(visible, name, plane, remove);
      const numbers = document.createElement('div');
      numbers.className = 'row';
      const field = (label: string, title: string, key: 'u' | 'v' | 'depth' | 'width', step: number, min?: number): HTMLLabelElement => {
        const wrap = document.createElement('label');
        wrap.title = title;
        wrap.append(`${label} `);
        const input = document.createElement('input');
        input.type = 'number';
        input.step = String(step);
        if (min !== undefined) input.min = String(min);
        input.value = String(+image[key].toFixed(2));
        input.style.width = '4.2em';
        input.addEventListener('change', () => {
          const value = Number(input.value);
          if (Number.isFinite(value) && (min === undefined || value >= min)) updateReference(image.id, { [key]: value });
          else input.value = String(+image[key].toFixed(2));
        });
        wrap.append(input);
        return wrap;
      };
      numbers.append(
        field('Ancho', 'Ancho de la imagen en celdas', 'width', 1, 0.5),
        field('↔', 'Posición horizontal del centro de la imagen', 'u', 0.5),
        field('↕', 'Posición vertical del centro de la imagen', 'v', 0.5),
        field('Fondo', 'Distancia hacia delante (+) o hacia atrás (−) del plano de la imagen', 'depth', 0.5),
      );
      const opacity = document.createElement('div');
      opacity.className = 'row';
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '5';
      slider.max = '100';
      slider.value = String(Math.round(image.opacity * 100));
      slider.title = 'Opacidad de la imagen';
      slider.addEventListener('input', () => {
        references = references.map((r) => (r.id === image.id ? { ...r, opacity: Number(slider.value) / 100 } : r));
        referenceLayer.set(references);
      });
      slider.addEventListener('change', () => updateReference(image.id, { opacity: Number(slider.value) / 100 }));
      opacity.append('Opacidad ', slider);
      row.append(head, numbers, opacity);
      refListEl.append(row);
    }
  }

  document.getElementById('refAdd')!.addEventListener('click', () => refFileEl.click());
  refFileEl.addEventListener('change', async () => {
    const file = refFileEl.files?.[0];
    refFileEl.value = '';
    if (!file) return;
    try {
      const { data, aspect, name } = await loadReferenceFile(file);
      setReferences([...references, defaultReference(nextReferenceId(references), name, data, aspect, host.gridSize())], true);
      statusEl.textContent = `Imagen de referencia puesta al fondo: ${name}`;
    } catch {
      statusEl.textContent = 'No se pudo abrir la imagen';
    }
  });

  return {
    get references() {
      return references;
    },
    set: (next) => setReferences(next),
  };
}
