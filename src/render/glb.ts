import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { groupCentre, sampleTrack, trackOf, type Animation } from '../core/animation';
import { buildExportMeshes, type ExportMode } from '../core/export';
import { FACE_DOUBLE, FACE_UNLIT, type Piece } from '../core/piece';
import { textureMeshes } from './textures';

/** Nombre de nodo seguro: sin espacios ni símbolos que el exportador confundiría con rutas de animación. */
const nodeName = (name: string): string => name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'Grupo';

/**
 * Genera un GLB. Sin normales, glTF se interpreta como sombreado plano, que es lo que pide una pieza facetada.
 * Con una animación, cada grupo animado sale como un nodo propio (con sus piezas dentro, una por objeto) cuyo movimiento,
 * giro y escala se guardan fotograma a fotograma en un clip llamado "Animacion".
 */
export async function exportGlb(pieces: Piece[], mode: ExportMode, layerName?: (layer: number) => string, animation?: Animation): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  root.name = 'Gridfacet';
  const materials = new Map<string, THREE.MeshStandardMaterial | THREE.MeshBasicMaterial>();

  const animatedGroups = new Set((animation?.tracks ?? []).map((t) => t.group));
  const animatedPieces = pieces.filter((p) => p.group !== undefined && animatedGroups.has(p.group));
  const fixedPieces = animatedPieces.length > 0 ? pieces.filter((p) => !animatedPieces.includes(p)) : pieces;

  const addMeshes = (target: THREE.Object3D, list: Piece[], exportMode: ExportMode): void => {
    for (const mesh of buildExportMeshes(list, exportMode, layerName)) target.add(buildMesh(mesh));
    // Los píxeles pintados van como mallas aparte, pegadas a su cara, con la textura en vecino más cercano y recorte por transparencia.
    for (const mesh of textureMeshes(list)) target.add(mesh);
  };
  const buildMesh = (mesh: ReturnType<typeof buildExportMeshes>[number]): THREE.Mesh => {
    const flags = mesh.flags ?? 0;
    const key = `${mesh.color}:${flags}`;
    let material = materials.get(key);
    if (!material) {
      const side = flags & FACE_DOUBLE ? THREE.DoubleSide : THREE.FrontSide;
      // Sin sombra: un material básico, que el exportador escribe con KHR_materials_unlit.
      material = flags & FACE_UNLIT ? new THREE.MeshBasicMaterial({ color: mesh.color, side }) : new THREE.MeshStandardMaterial({ color: mesh.color, roughness: 0.8, metalness: 0, side });
      material.name = `color_${mesh.color.toString(16).padStart(6, '0')}${flags & FACE_DOUBLE ? '_doble' : ''}${flags & FACE_UNLIT ? '_sinluz' : ''}`;
      materials.set(key, material);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices);
    const object = new THREE.Mesh(geometry, material);
    object.name = mesh.name;
    return object;
  };

  addMeshes(root, fixedPieces, mode);

  const clips: THREE.AnimationClip[] = [];
  if (animation && animatedPieces.length > 0) {
    const tracks: THREE.KeyframeTrack[] = [];
    const times = Array.from({ length: animation.frames }, (_, i) => i / animation.fps);
    for (const group of animatedGroups) {
      const members = animatedPieces.filter((p) => p.group === group);
      if (members.length === 0) continue;
      const centre = groupCentre(members);
      const wrapper = new THREE.Group();
      wrapper.name = `${nodeName(members[0].groupName ?? 'Grupo')}_${group}`;
      wrapper.position.set(...centre);
      const inner = new THREE.Group();
      inner.name = `${wrapper.name}_piezas`;
      inner.position.set(-centre[0], -centre[1], -centre[2]);
      addMeshes(inner, members, 'perPiece');
      wrapper.add(inner);
      root.add(wrapper);

      const track = trackOf(animation, group);
      const positions: number[] = [];
      const quaternions: number[] = [];
      const scales: number[] = [];
      const euler = new THREE.Euler();
      const quaternion = new THREE.Quaternion();
      for (let frame = 0; frame < animation.frames; frame++) {
        const pose = sampleTrack(track, frame);
        positions.push(centre[0] + pose.pos[0], centre[1] + pose.pos[1], centre[2] + pose.pos[2]);
        euler.set((pose.rot[0] * Math.PI) / 180, (pose.rot[1] * Math.PI) / 180, (pose.rot[2] * Math.PI) / 180);
        quaternion.setFromEuler(euler);
        quaternions.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        scales.push(pose.scale[0], pose.scale[1], pose.scale[2]);
      }
      tracks.push(
        new THREE.VectorKeyframeTrack(`${wrapper.name}.position`, times, positions),
        new THREE.QuaternionKeyframeTrack(`${wrapper.name}.quaternion`, times, quaternions),
        new THREE.VectorKeyframeTrack(`${wrapper.name}.scale`, times, scales),
      );
    }
    clips.push(new THREE.AnimationClip('Animacion', (animation.frames - 1) / animation.fps, tracks));
  }

  const result = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips });
  return result as ArrayBuffer;
}

export function downloadBlob(data: BlobPart, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
