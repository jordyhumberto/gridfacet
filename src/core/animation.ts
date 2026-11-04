import type { Piece, Vec3 } from './piece';

/** Cómo está un grupo en un momento: desplazamiento, giro (grados, en X, Y, Z) y escala por eje. */
export interface Pose {
  pos: Vec3;
  rot: Vec3;
  scale: Vec3;
}

/** Una clave: la pose que tiene un grupo en un fotograma. */
export interface Keyframe extends Pose {
  frame: number;
}

/** Las claves de un grupo, ordenadas por fotograma. Entre claves la pose se interpola; antes de la primera y después de la última se mantiene. */
export interface Track {
  group: number;
  keys: Keyframe[];
}

export interface Animation {
  /** Cuántos fotogramas dura (los fotogramas van de 0 a frames − 1). */
  frames: number;
  fps: number;
  tracks: Track[];
}

export const MAX_FRAMES = 1000;
export const MAX_FPS = 60;

export const REST_POSE: Pose = { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] };

export const emptyAnimation = (): Animation => ({ frames: 24, fps: 12, tracks: [] });

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** La pose de un grupo en un fotograma (puede ser fraccionario). Sin claves, la pose de reposo. */
export function sampleTrack(track: Track | undefined, frame: number): Pose {
  const keys = track?.keys ?? [];
  if (keys.length === 0) return REST_POSE;
  if (frame <= keys[0].frame) return keys[0];
  const last = keys[keys.length - 1];
  if (frame >= last.frame) return last;
  const next = keys.findIndex((k) => k.frame > frame);
  const a = keys[next - 1];
  const b = keys[next];
  const t = (frame - a.frame) / (b.frame - a.frame);
  return { pos: lerp3(a.pos, b.pos, t), rot: lerp3(a.rot, b.rot, t), scale: lerp3(a.scale, b.scale, t) };
}

export const trackOf = (animation: Animation, group: number): Track | undefined => animation.tracks.find((t) => t.group === group);

/** Pone (o reemplaza) la clave de un grupo en un fotograma. */
export function setKey(animation: Animation, group: number, frame: number, pose: Pose): Animation {
  const at = Math.max(0, Math.min(animation.frames - 1, Math.round(frame)));
  const key: Keyframe = { frame: at, pos: [...pose.pos], rot: [...pose.rot], scale: [...pose.scale] };
  const existing = trackOf(animation, group);
  const keys = [...(existing?.keys.filter((k) => k.frame !== at) ?? []), key].sort((a, b) => a.frame - b.frame);
  const tracks = existing ? animation.tracks.map((t) => (t.group === group ? { group, keys } : t)) : [...animation.tracks, { group, keys }];
  return { ...animation, tracks };
}

/** Quita la clave de un grupo en un fotograma; si era la última, el grupo deja de animarse. */
export function removeKey(animation: Animation, group: number, frame: number): Animation {
  const existing = trackOf(animation, group);
  if (!existing || !existing.keys.some((k) => k.frame === frame)) return animation;
  const keys = existing.keys.filter((k) => k.frame !== frame);
  const tracks = keys.length > 0 ? animation.tracks.map((t) => (t.group === group ? { group, keys } : t)) : animation.tracks.filter((t) => t.group !== group);
  return { ...animation, tracks };
}

/** Cambia la duración; las claves que quedan fuera se descartan. */
export function resize(animation: Animation, frames: number, fps: number): Animation {
  const length = Math.max(1, Math.min(MAX_FRAMES, Math.round(frames)));
  const rate = Math.max(1, Math.min(MAX_FPS, Math.round(fps)));
  const tracks = animation.tracks.map((t) => ({ group: t.group, keys: t.keys.filter((k) => k.frame < length) })).filter((t) => t.keys.length > 0);
  return { frames: length, fps: rate, tracks };
}

/** Quita las pistas de grupos que ya no existen. */
export function pruneTracks(animation: Animation, pieces: Piece[]): Animation {
  const groups = new Set(pieces.flatMap((p) => (p.group !== undefined ? [p.group] : [])));
  const tracks = animation.tracks.filter((t) => groups.has(t.group));
  return tracks.length === animation.tracks.length ? animation : { ...animation, tracks };
}

/** El centro de la caja de las piezas de un grupo: alrededor de él giran y escalan. */
export function groupCentre(pieces: Piece[]): Vec3 {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const piece of pieces) {
    for (const face of piece.faces) {
      for (const p of face) {
        for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], p[k]);
          max[k] = Math.max(max[k], p[k]);
        }
      }
    }
  }
  if (!Number.isFinite(min[0])) return [0, 0, 0];
  return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
}

const finite3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Lee una animación guardada; lo que no es válido se descarta sin tirar el proyecto. */
export function parseAnimation(raw: unknown): Animation | undefined {
  const data = raw as Partial<Animation> | null;
  if (!data || !Number.isInteger(data.frames) || !Number.isInteger(data.fps) || !Array.isArray(data.tracks)) return undefined;
  const base = resize({ frames: data.frames!, fps: data.fps!, tracks: [] }, data.frames!, data.fps!);
  const tracks: Track[] = [];
  for (const t of data.tracks) {
    if (!t || !Number.isInteger(t.group) || t.group <= 0 || !Array.isArray(t.keys)) continue;
    const keys = t.keys
      .filter((k) => k && Number.isInteger(k.frame) && k.frame >= 0 && k.frame < base.frames && finite3(k.pos) && finite3(k.rot) && finite3(k.scale))
      .map((k) => ({ frame: k.frame, pos: k.pos, rot: k.rot, scale: k.scale }))
      .sort((a, b) => a.frame - b.frame)
      .filter((k, i, list) => i === 0 || k.frame !== list[i - 1].frame);
    if (keys.length > 0) tracks.push({ group: t.group, keys });
  }
  return { ...base, tracks };
}
