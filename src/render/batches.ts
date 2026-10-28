import * as THREE from 'three';
import { faceColorOf, type Piece } from '../core/piece';
import { edgeKey, faceVertexNormals, smoothEdges } from './shading';
import { wireColor } from './meshes';

/** Lado de cada zona, en celdas. Cambiar una pieza solo reconstruye la malla de su zona. */
const CHUNK_SIZE = 8;
const OUTLINE = new THREE.Color(0x14161b);

interface Chunk {
  pieces: Map<number, Piece>;
  mesh: THREE.Mesh;
  outline: THREE.LineSegments;
  points: THREE.Points;
  /** Para cada triángulo de la malla, la pieza a la que pertenece. */
  owners: Int32Array;
  dirty: boolean;
}

/**
 * Dibuja muchas piezas con pocas llamadas a la GPU: las agrupa por zonas y funde cada zona en una
 * sola malla con colores por vértice y un solo juego de contornos. Las llamadas de dibujo pasan a
 * depender del número de zonas y no del de piezas.
 */
export class PieceBatches {
  readonly group = new THREE.Group();

  private chunks = new Map<string, Chunk>();
  private chunkOf = new Map<number, string>();
  private material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  private lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
  private pointMaterial = new THREE.PointsMaterial({ color: 0xe6e8ee, size: 5, sizeAttenuation: false });
  private wireframe = false;

  /** Vista de solo líneas y vértices: se ocultan las caras (siguen siendo apuntables) y las aristas toman el color de cada pieza. */
  private smooth = false;

  setSmooth(on: boolean): void {
    if (on === this.smooth) return;
    this.smooth = on;
    for (const chunk of this.chunks.values()) chunk.dirty = true;
  }

  setWireframe(on: boolean): void {
    if (on === this.wireframe) return;
    this.wireframe = on;
    for (const chunk of this.chunks.values()) chunk.dirty = true;
  }

  add(piece: Piece): void {
    const key = chunkKey(piece);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.createChunk();
      this.chunks.set(key, chunk);
    }
    chunk.pieces.set(piece.id, piece);
    chunk.dirty = true;
    this.chunkOf.set(piece.id, key);
  }

  remove(id: number): void {
    const key = this.chunkOf.get(id);
    if (key === undefined) return;
    this.chunkOf.delete(id);
    const chunk = this.chunks.get(key)!;
    chunk.pieces.delete(id);
    chunk.dirty = true;
  }

  has(id: number): boolean {
    return this.chunkOf.has(id);
  }

  /** Mallas que conviene usar al apuntar con el ratón. */
  meshes(): THREE.Mesh[] {
    return [...this.chunks.values()].map((chunk) => chunk.mesh);
  }

  /** Pieza a la que pertenece un impacto sobre una de las mallas de lotes. */
  pieceIdAt(hit: THREE.Intersection): number | undefined {
    const chunk = [...this.chunks.values()].find((c) => c.mesh === hit.object);
    return chunk && hit.faceIndex != null ? chunk.owners[hit.faceIndex] : undefined;
  }

  /** Reconstruye las zonas que cambiaron desde la última vez. */
  flush(): void {
    for (const [key, chunk] of this.chunks) {
      if (!chunk.dirty) continue;
      chunk.dirty = false;
      if (chunk.pieces.size === 0) {
        this.group.remove(chunk.mesh, chunk.outline, chunk.points);
        chunk.mesh.geometry.dispose();
        chunk.outline.geometry.dispose();
        chunk.points.geometry.dispose();
        this.chunks.delete(key);
        continue;
      }
      this.rebuild(chunk);
    }
  }

  private createChunk(): Chunk {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    const outline = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
    const points = new THREE.Points(new THREE.BufferGeometry(), this.pointMaterial);
    this.group.add(mesh, outline, points);
    return { pieces: new Map(), mesh, outline, points, owners: new Int32Array(0), dirty: true };
  }

  private rebuild(chunk: Chunk): void {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const owners: number[] = [];
    const linePositions: number[] = [];
    const lineColors: number[] = [];
    const vertexPositions: number[] = [];
    const color = new THREE.Color();
    const line = new THREE.Color();

    for (const piece of chunk.pieces.values()) {
      const edge = this.wireframe ? line.set(wireColor(piece.color)) : OUTLINE;
      const vertexNormals = faceVertexNormals(piece, this.smooth);
      const hideEdges = this.smooth && !this.wireframe ? smoothEdges(piece) : null;
      const seen = new Set<string>();
      for (const [faceIndex, face] of piece.faces.entries()) {
        color.set(faceColorOf(piece, faceIndex));
        for (let i = 1; i < face.length - 1; i++) {
          for (const v of [0, i, i + 1]) {
            const p = face[v];
            const n = vertexNormals[faceIndex][v];
            positions.push(p[0], p[1], p[2]);
            normals.push(n[0], n[1], n[2]);
            colors.push(color.r, color.g, color.b);
          }
          owners.push(piece.id);
        }
        for (let i = 0; i < face.length; i++) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          if (!hideEdges?.has(edgeKey(a, b))) {
            linePositions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
            lineColors.push(edge.r, edge.g, edge.b, edge.r, edge.g, edge.b);
          }
          if (this.wireframe) {
            const key = a.map((v) => Math.round(v * 1e5)).join(',');
            if (!seen.has(key)) {
              seen.add(key);
              vertexPositions.push(a[0], a[1], a[2]);
            }
          }
        }
      }
    }

    chunk.owners = Int32Array.from(owners);
    replaceGeometry(chunk.mesh, { position: positions, normal: normals, color: colors });
    replaceGeometry(chunk.outline, { position: linePositions, color: lineColors });
    replaceGeometry(chunk.points, { position: vertexPositions });
    chunk.mesh.visible = !this.wireframe;
    chunk.points.visible = this.wireframe;
  }
}

function replaceGeometry(object: THREE.Mesh | THREE.LineSegments | THREE.Points, attributes: Record<string, number[]>): void {
  const geometry = new THREE.BufferGeometry();
  for (const [name, values] of Object.entries(attributes)) {
    geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, 3));
  }
  geometry.computeBoundingSphere();
  object.geometry.dispose();
  object.geometry = geometry;
}

function chunkKey(piece: Piece): string {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const face of piece.faces) {
    for (const p of face) {
      x += p[0];
      y += p[1];
      z += p[2];
      count++;
    }
  }
  const c = (v: number) => Math.floor(v / count / CHUNK_SIZE);
  return `${c(x)},${c(y)},${c(z)}`;
}
