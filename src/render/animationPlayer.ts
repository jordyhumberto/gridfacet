import * as THREE from 'three';
import { groupCentre, sampleTrack, trackOf, type Animation } from '../core/animation';
import type { Piece } from '../core/piece';
import { createPieceObject, disposeObject } from './meshes';
import { TextureLayer } from './textures';

/** Lo que el reproductor necesita del resto del editor para tapar las piezas reales mientras se ve la animación. */
export interface PlayerHooks {
  /** Deja de dibujar estas piezas (las sustituyen las del reproductor). */
  hide(ids: number[]): void;
  /** Vuelve a dibujarlas como antes. */
  show(ids: number[]): void;
}

interface Animated {
  group: number;
  centre: THREE.Vector3;
  wrapper: THREE.Group;
  textures: TextureLayer;
  ids: number[];
}

/**
 * Dibuja el modelo con la animación puesta en un fotograma, sin tocar las piezas: los grupos con pista se sustituyen por copias
 * que se mueven, giran y escalan alrededor del centro de su caja. Al parar, todo vuelve a como estaba.
 */
export class AnimationPlayer {
  private animated = new Map<number, Animated>();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly hooks: PlayerHooks,
  ) {}

  get active(): boolean {
    return this.animated.size > 0;
  }

  /** Pone el modelo en el fotograma (puede ser fraccionario). */
  show(pieces: Piece[], animation: Animation, frame: number): void {
    const wanted = new Set(animation.tracks.map((t) => t.group));
    // Quita los grupos que ya no tienen pista.
    for (const [group, entry] of [...this.animated]) {
      if (wanted.has(group)) continue;
      this.remove(entry);
      this.animated.delete(group);
    }
    for (const track of animation.tracks) {
      if (this.animated.has(track.group)) continue;
      const members = pieces.filter((p) => p.group === track.group);
      if (members.length === 0) continue;
      this.animated.set(track.group, this.build(track.group, members));
    }
    for (const entry of this.animated.values()) {
      const pose = sampleTrack(trackOf(animation, entry.group), frame);
      const w = entry.wrapper;
      w.position.set(entry.centre.x + pose.pos[0], entry.centre.y + pose.pos[1], entry.centre.z + pose.pos[2]);
      w.rotation.set((pose.rot[0] * Math.PI) / 180, (pose.rot[1] * Math.PI) / 180, (pose.rot[2] * Math.PI) / 180);
      w.scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);
    }
  }

  /** Vuelve a dibujar las piezas reales y quita las copias. */
  stop(): void {
    const ids: number[] = [];
    for (const entry of this.animated.values()) {
      ids.push(...entry.ids);
      this.remove(entry);
    }
    this.animated.clear();
    if (ids.length > 0) this.hooks.show(ids);
  }

  private build(group: number, members: Piece[]): Animated {
    const centre = new THREE.Vector3(...groupCentre(members));
    const wrapper = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.copy(centre).negate();
    const textures = new TextureLayer();
    for (const piece of members) {
      inner.add(createPieceObject(piece));
      textures.add(piece);
    }
    inner.add(textures.group);
    wrapper.add(inner);
    this.scene.add(wrapper);
    const ids = members.map((p) => p.id);
    this.hooks.hide(ids);
    return { group, centre, wrapper, textures, ids };
  }

  private remove(entry: Animated): void {
    this.scene.remove(entry.wrapper);
    disposeObject(entry.wrapper);
    for (const piece of entry.ids) entry.textures.remove(piece);
  }
}
