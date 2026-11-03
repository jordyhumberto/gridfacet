import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildExportMeshes, type ExportMode } from '../core/export';
import type { Piece } from '../core/piece';
import { textureMeshes } from './textures';

/** Genera un GLB. Sin normales, glTF se interpreta como sombreado plano, que es lo que pide una pieza facetada. */
export async function exportGlb(pieces: Piece[], mode: ExportMode, layerName?: (layer: number) => string): Promise<ArrayBuffer> {
  const root = new THREE.Group();
  root.name = 'Gridfacet';
  const materials = new Map<number, THREE.MeshStandardMaterial>();

  for (const mesh of buildExportMeshes(pieces, mode, layerName)) {
    let material = materials.get(mesh.color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color: mesh.color, roughness: 0.8, metalness: 0 });
      material.name = `color_${mesh.color.toString(16).padStart(6, '0')}`;
      materials.set(mesh.color, material);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geometry.setIndex(mesh.indices);
    const object = new THREE.Mesh(geometry, material);
    object.name = mesh.name;
    root.add(object);
  }

  // Los píxeles pintados van como mallas aparte, pegadas a su cara, con la textura en vecino más cercano y recorte por transparencia.
  for (const mesh of textureMeshes(pieces)) root.add(mesh);

  const result = await new GLTFExporter().parseAsync(root, { binary: true });
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
