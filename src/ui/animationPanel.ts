import * as THREE from 'three';
import { emptyAnimation, groupCentre, removeKey, resize as resizeAnimation, sampleTrack, setKey, trackOf, MAX_FPS, MAX_FRAMES, type Animation, type Pose } from '../core/animation';
import type { Piece } from '../core/piece';
import { AnimationPlayer } from '../render/animationPlayer';
import type { ModelScene } from '../scene';
import type { Selection } from '../selection';

/** Lo que el panel de animación necesita de la aplicación. */
export interface AnimationHost {
  scene3d: THREE.Scene;
  renderer: { domElement: HTMLCanvasElement };
  camera: THREE.PerspectiveCamera;
  controls: { enabled: boolean };
  model: ModelScene;
  selection: Selection;
  objects: Map<number, THREE.Object3D>;
  batches: { add(piece: Piece): void; remove(id: number): void };
  textureLayer: { add(piece: Piece): void; remove(id: number): void };
  hidden: Set<number>;
  layers: { isHidden(piece: Piece): boolean };
  statusEl: HTMLElement;
  selectedPieces(): Piece[];
  /** La animación cambió: hay cambios sin guardar. */
  touched(): void;
}

export interface AnimationPanel {
  /** La animación de ahora (para guardar y exportar). */
  readonly animation: Animation;
  /** ¿Se está reproduciendo? */
  readonly playing: boolean;
  /** Avanza la reproducción `dt` segundos y pone al día el reproductor y el control de fotogramas. */
  tick(dt: number): void;
  /** Termina la vista previa y vuelve a las piezas reales. */
  stop(): void;
  /** Sustituye la animación (al abrir, crear o recuperar un proyecto) y olvida su historial. */
  load(next: Animation): void;
  /** Ctrl+Z: deshace un paso de animación si fue lo último; si no, deshace el modelo. */
  undo(): void;
  /** Ctrl+Y: rehace un paso de animación si toca; devuelve false si toca rehacer el modelo. */
  redo(): boolean;
  /** Teclas durante el posado con el ratón; devuelve true si se usó la tecla. */
  poseKey(e: KeyboardEvent): boolean;
}

// Animación: claves de pose (mover, girar, escalar) por grupo de piezas. Se ve en un reproductor aparte que sustituye a las piezas
// mientras dura la vista previa; cualquier edición del modelo la termina.
export function createAnimationPanel(host: AnimationHost): AnimationPanel {
  const { scene3d, renderer, camera, controls, model, selection, objects, batches, textureLayer, hidden, layers, statusEl, selectedPieces } = host;
  let animation: Animation = emptyAnimation();
  let animFrame = 0;
  let animPlaying = false;
  let animClock = 0;
  const animPlayer = new AnimationPlayer(scene3d, {
    hide: (ids) => {
      for (const id of ids) {
        batches.remove(id);
        textureLayer.remove(id);
        const object = objects.get(id);
        if (object) object.visible = false;
      }
    },
    show: (ids) => {
      for (const id of ids) {
        const piece = model.get(id);
        if (!piece) continue;
        if (!hidden.has(id) && !selection.has(id)) batches.add(piece);
        if (!hidden.has(id)) textureLayer.add(piece);
        const object = objects.get(id);
        if (object) object.visible = true;
      }
    },
  });
  const animEl = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const animSlider = animEl<HTMLInputElement>('animFrame');
  const animPlayButton = animEl<HTMLButtonElement>('animPlay');
  const animStopButton = animEl<HTMLButtonElement>('animStop');
  const animFramesInput = animEl<HTMLInputElement>('animFrames');
  const animFpsInput = animEl<HTMLInputElement>('animFps');
  const animPoseInputs = [...document.querySelectorAll<HTMLInputElement>('input[data-anim]')];
  const animPoseInput = (name: string): HTMLInputElement => animPoseInputs.find((el) => el.dataset.anim === name)!;

  /** El grupo que se está animando: el del primer grupo entre las piezas elegidas. */
  function animGroup(): { id: number; name: string } | null {
    const piece = selectedPieces().find((p) => p.group !== undefined);
    return piece ? { id: piece.group!, name: piece.groupName ?? `Grupo ${piece.group}` } : null;
  }

  function visibleForAnimation(): Piece[] {
    return model.all().filter((piece) => !hidden.has(piece.id) && !layers.isHidden(piece));
  }

  function touchAnimation(): void {
    host.touched();
  }

  /** Vuelve a las piezas reales (termina la vista previa de la animación). */
  function stopAnimationView(): void {
    animPlaying = false;
    animPlayer.stop();
    animStopButton.hidden = true;
    animPlayButton.textContent = '▶ Reproducir';
  }

  function showAnimationFrame(frame = animFrame): void {
    if (animation.tracks.length === 0) {
      animPlayer.stop();
      animStopButton.hidden = true;
    } else {
      animPlayer.show(visibleForAnimation(), animation, frame);
      animStopButton.hidden = false;
    }
  }

  function refreshAnimationPanel(): void {
    animSlider.max = String(animation.frames - 1);
    animSlider.value = String(animFrame);
    animEl('animFrameLabel').textContent = `${animFrame + 1} / ${animation.frames}`;
    animFramesInput.value = String(animation.frames);
    animFpsInput.value = String(animation.fps);
    const group = animGroup();
    const track = group ? trackOf(animation, group.id) : undefined;
    animEl('animGroup').textContent = group
      ? `Grupo: ${group.name}`
      : 'Elige un grupo de piezas para animarlo (Ctrl+G agrupa las piezas elegidas)';
    for (const id of ['animPose', 'animPoseRot', 'animPoseScale', 'animKeyRow', 'animMouseRow']) animEl(id).hidden = !group;
    if (group) {
      const pose = sampleTrack(track, animFrame);
      const set = (name: string, value: number): void => {
        const input = animPoseInput(name);
        if (document.activeElement !== input) input.value = String(+value.toFixed(3));
      };
      set('px', pose.pos[0]); set('py', pose.pos[1]); set('pz', pose.pos[2]);
      set('rx', pose.rot[0]); set('ry', pose.rot[1]); set('rz', pose.rot[2]);
      set('s', pose.scale[0]);
    }
    animEl('animKeys').textContent = track
      ? `Claves: ${track.keys.map((k) => (k.frame === animFrame ? `[${k.frame + 1}]` : String(k.frame + 1))).join(', ')}`
      : group ? 'Sin claves: pon una en este fotograma' : '';
  }

  function setAnimation(next: Animation): void {
    animation = next;
    animFrame = Math.min(animFrame, animation.frames - 1);
    refreshAnimationPanel();
  }

  /**
   * Historial de la animación, entrelazado con el del modelo: cada paso recuerda cuántos cambios del modelo había (`depth`) y así
   * Ctrl+Z deshace en el orden en que se hicieron las cosas, sean piezas o claves.
   */
  interface AnimationStep {
    before: Animation;
    after: Animation;
    depth: number;
    /** En un paso deshecho, el contador del modelo en ese momento: si cambia, ya no se puede rehacer. */
    serial: number;
    /** El paso va pegado al cambio del modelo siguiente (abrir un archivo): un solo Ctrl+Z o Ctrl+Y deshace o rehace los dos. */
    withModel?: boolean;
  }
  const animationUndo: AnimationStep[] = [];
  let animationRedo: AnimationStep[] = [];

  function applyAnimation(next: Animation): void {
    animation = next;
    animFrame = Math.min(animFrame, animation.frames - 1);
    touchAnimation();
    showAnimationFrame();
    refreshAnimationPanel();
  }

  /** Cambia la animación como un paso que se puede deshacer. */
  function editAnimation(next: Animation): void {
    if (next === animation) return;
    animationUndo.push({ before: animation, after: next, depth: model.undoDepth, serial: model.serial });
    animationRedo = [];
    applyAnimation(next);
  }

  /** Deshace un paso de animación si fue lo último que se hizo; devuelve false si toca deshacer el modelo. */
  function undoAnimationStep(): boolean {
    const step = animationUndo[animationUndo.length - 1];
    if (!step || step.depth !== model.undoDepth) return false;
    animationUndo.pop();
    // Lo deshecho solo se puede rehacer mientras no haya un cambio nuevo en el modelo: se anota con el contador de ahora.
    animationRedo.push({ ...step, serial: model.serial });
    applyAnimation(step.before);
    statusEl.textContent = 'Animación: cambio deshecho';
    return true;
  }

  function redoAnimationStep(): boolean {
    animationRedo = animationRedo.filter((step) => step.serial === model.serial);
    const step = animationRedo[animationRedo.length - 1];
    if (!step || step.depth !== model.undoDepth) return false;
    animationRedo.pop();
    animationUndo.push(step);
    if (step.withModel) model.redo();
    applyAnimation(step.after);
    statusEl.textContent = 'Animación: cambio rehecho';
    return true;
  }

  /**
   * Posar con el ratón: mover, girar o escalar el grupo elegido en el fotograma actual moviendo el ratón sin pulsar.
   * Clic o Intro confirman (y ponen la clave), Esc o clic derecho cancelan, 1/2/3 fijan el eje X/Y/Z y Ctrl quita el imán (X, Y y Z son de la simetría y aquí no hacen nada).
   */
  const POSE_MOVE_STEP = 0.25;
  const POSE_ROTATE_STEP = 5;
  const POSE_SCALE_STEP = 0.05;
  let poseDrag: {
    kind: 'move' | 'rotate' | 'scale';
    group: number;
    start: Pose;
    /** Dónde está el centro del grupo ahora (con el desplazamiento de la pose). */
    pivot: THREE.Vector3;
    axis: number | null;
    /** Se fija con el primer movimiento del ratón. */
    reference: { x: number; y: number; angle: number; distance: number; point: THREE.Vector3 | null } | null;
    last: { x: number; y: number; free: boolean } | null;
    result: Animation | null;
  } | null = null;

  function beginPoseDrag(kind: 'move' | 'rotate' | 'scale'): void {
    const group = animGroup();
    if (!group || poseDrag) return;
    const members = model.all().filter((p) => p.group === group.id);
    const start = sampleTrack(trackOf(animation, group.id), animFrame);
    const centre = groupCentre(members);
    poseDrag = {
      kind,
      group: group.id,
      start,
      pivot: new THREE.Vector3(centre[0] + start.pos[0], centre[1] + start.pos[1], centre[2] + start.pos[2]),
      axis: null,
      reference: null,
      last: null,
      result: null,
    };
    controls.enabled = false;
    statusEl.textContent = `${{ move: 'Mover', rotate: 'Girar', scale: 'Escalar' }[kind]} el grupo: mueve el ratón${kind === 'scale' ? '' : ' · 1/2/3 fija el eje X/Y/Z'} · Ctrl sin imán · clic o Intro confirma · Esc cancela`;
  }

  function updatePoseDrag(): void {
    const drag = poseDrag;
    if (!drag || !drag.last) return;
    const { x, y, free } = drag.last;
    const rect = renderer.domElement.getBoundingClientRect();
    const projected = drag.pivot.clone().project(camera);
    const cx = rect.left + ((projected.x + 1) / 2) * rect.width;
    const cy = rect.top + ((1 - projected.y) / 2) * rect.height;
    const forward = camera.getWorldDirection(new THREE.Vector3());
    const onPlane = (): THREE.Vector3 | null => {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1), camera);
      return ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(forward, drag.pivot), new THREE.Vector3());
    };
    if (!drag.reference) {
      drag.reference = { x, y, angle: Math.atan2(y - cy, x - cx), distance: Math.max(Math.hypot(x - cx, y - cy), 8), point: drag.kind === 'move' ? onPlane() : null };
      return;
    }
    const ref = drag.reference;
    const pose: Pose = { pos: [...drag.start.pos], rot: [...drag.start.rot], scale: [...drag.start.scale] };
    let label = '';
    if (drag.kind === 'move') {
      const point = onPlane();
      if (!point || !ref.point) return;
      const delta = [point.x - ref.point.x, point.y - ref.point.y, point.z - ref.point.z];
      for (let k = 0; k < 3; k++) {
        if (drag.axis !== null && drag.axis !== k) continue;
        let value = drag.start.pos[k] + delta[k];
        if (!free) value = Math.round(value / POSE_MOVE_STEP) * POSE_MOVE_STEP;
        pose.pos[k] = value;
      }
      label = `Mover ${pose.pos.map((v) => +v.toFixed(2)).join(', ')}`;
    } else if (drag.kind === 'rotate') {
      // Eje: el elegido, o el del mundo más parecido a la dirección de la cámara; el giro suma al ángulo de ese eje.
      const abs = [Math.abs(forward.x), Math.abs(forward.y), Math.abs(forward.z)];
      const axis = drag.axis ?? abs.indexOf(Math.max(...abs));
      const towardsViewer = [forward.x, forward.y, forward.z][axis] < 0;
      let degrees = ((Math.atan2(y - cy, x - cx) - ref.angle) * 180) / Math.PI * (towardsViewer ? -1 : 1);
      degrees = ((degrees + 540) % 360) - 180;
      if (!free) degrees = Math.round(degrees / POSE_ROTATE_STEP) * POSE_ROTATE_STEP;
      pose.rot[axis] = drag.start.rot[axis] + degrees;
      label = `Girar ${'XYZ'[axis]} ${Math.round(pose.rot[axis])}°`;
    } else {
      let factor = Math.max(Math.hypot(x - cx, y - cy), 8) / ref.distance;
      if (!free) factor = Math.round(factor / POSE_SCALE_STEP) * POSE_SCALE_STEP;
      const scale = Math.max(drag.start.scale[0] * factor, 0.05);
      pose.scale = [scale, scale, scale];
      label = `Escalar ×${scale.toFixed(2)}`;
    }
    drag.result = setKey(animation, drag.group, animFrame, pose);
    animPlayer.show(visibleForAnimation(), drag.result, animFrame);
    animStopButton.hidden = false;
    statusEl.textContent = label;
  }

  function finishPoseDrag(commit: boolean): void {
    const drag = poseDrag;
    if (!drag) return;
    poseDrag = null;
    controls.enabled = true;
    if (commit && drag.result) editAnimation(drag.result);
    else {
      showAnimationFrame();
      refreshAnimationPanel();
    }
    statusEl.textContent = commit && drag.result ? 'Clave puesta' : 'Cancelado';
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-animpose]')) {
    button.addEventListener('click', () => {
      button.blur();
      animPlaying = false;
      animPlayButton.textContent = '▶ Reproducir';
      beginPoseDrag(button.dataset.animpose as 'move' | 'rotate' | 'scale');
    });
  }
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!poseDrag) return;
    poseDrag.last = { x: e.clientX, y: e.clientY, free: e.ctrlKey || e.metaKey };
    updatePoseDrag();
  });
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!poseDrag || e.target !== renderer.domElement) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.button === 0) finishPoseDrag(true);
      else if (e.button === 2) finishPoseDrag(false);
    },
    { capture: true },
  );
  /** Teclas durante el posado con el ratón; devuelve true si se usó la tecla. */
  function poseKey(e: KeyboardEvent): boolean {
    if (!poseDrag) return false;
    const key = e.key.toLowerCase();
    // 1 / 2 / 3 de la fila de arriba (por `code`: el teclado numérico son las vistas). X, Y y Z son de la simetría: aquí se consumen sin cambiarla a mitad del posado.
    if (/^Digit[123]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const axis = Number(e.code.slice(5)) - 1;
      poseDrag.axis = poseDrag.axis === axis ? null : axis;
      updatePoseDrag();
    } else if (key === 'escape') finishPoseDrag(false);
    else if (key === 'enter') finishPoseDrag(true);
    return true;
  }

  function poseFromInputs(): Pose {
    const n = (name: string, fallback: number): number => {
      const v = Number(animPoseInput(name).value);
      return Number.isFinite(v) ? v : fallback;
    };
    const scale = Math.max(n('s', 1), 0.05);
    return { pos: [n('px', 0), n('py', 0), n('pz', 0)], rot: [n('rx', 0), n('ry', 0), n('rz', 0)], scale: [scale, scale, scale] };
  }

  function writeKey(): void {
    const group = animGroup();
    if (!group) return;
    editAnimation(setKey(animation, group.id, animFrame, poseFromInputs()));
  }

  animSlider.addEventListener('input', () => {
    animPlaying = false;
    animPlayButton.textContent = '▶ Reproducir';
    animFrame = Number(animSlider.value);
    showAnimationFrame();
    refreshAnimationPanel();
  });
  animPlayButton.addEventListener('click', () => {
    animPlayButton.blur();
    if (animation.tracks.length === 0) {
      statusEl.textContent = 'Todavía no hay claves: elige un grupo, ponle una pose en un fotograma y otra en otro';
      return;
    }
    animPlaying = !animPlaying;
    animClock = animFrame;
    animPlayButton.textContent = animPlaying ? '⏸ Pausa' : '▶ Reproducir';
    showAnimationFrame();
  });
  animStopButton.addEventListener('click', () => {
    stopAnimationView();
    refreshAnimationPanel();
  });
  animEl('animSetKey').addEventListener('click', writeKey);
  animEl('animRemoveKey').addEventListener('click', () => {
    const group = animGroup();
    if (!group) return;
    editAnimation(removeKey(animation, group.id, animFrame));
  });
  for (const input of animPoseInputs) input.addEventListener('change', writeKey);
  for (const input of [animFramesInput, animFpsInput]) {
    input.addEventListener('change', () => {
      editAnimation(resizeAnimation(animation, Math.min(Number(animFramesInput.value) || 24, MAX_FRAMES), Math.min(Number(animFpsInput.value) || 12, MAX_FPS)));
    });
  }
  // Cualquier cambio del modelo termina la vista previa; al elegir otro grupo se muestran sus claves.
  // Va el primero: la vista previa se para antes de que el resto reaccione al cambio.
  model.subscribe(() => {
    if (animPlayer.active) stopAnimationView();
  }, true);
  // Las pistas de grupos que ya no existen se dejan: si se deshace el borrado vuelven con sus claves. Se podan al guardar y exportar.
  model.subscribe(() => refreshAnimationPanel());
  selection.subscribe(() => refreshAnimationPanel());
  refreshAnimationPanel();

  return {
    get animation() {
      return animation;
    },
    get playing() {
      return animPlaying;
    },
    tick(dt) {
      animClock = (animClock + dt * animation.fps) % animation.frames;
      animFrame = Math.floor(animClock);
      animPlayer.show(visibleForAnimation(), animation, animClock);
      animSlider.value = String(animFrame);
      animEl('animFrameLabel').textContent = `${animFrame + 1} / ${animation.frames}`;
    },
    stop: stopAnimationView,
    load(next) {
      setAnimation(next);
      animationUndo.length = 0;
      animationRedo = [];
    },
    undo() {
      if (undoAnimationStep()) return;
      model.undo();
      // Abrir un archivo cambió piezas y animación a la vez: se deshacen juntas.
      const step = animationUndo[animationUndo.length - 1];
      if (step?.withModel && step.depth === model.undoDepth) undoAnimationStep();
    },
    redo: redoAnimationStep,
    poseKey,
  };
}
