/**
 * Genera `ejemplos/tiburon.gridfacet.json`: un tiburón con lomo gris, vientre blanco, aletas y cola.
 * Se ejecuta con: npx vite-node scripts/tiburon.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { convexHull } from '../src/core/hull';
import { makePiece, newGroupId, type Piece, type Vec3 } from '../src/core/piece';
import { serializeProject } from '../src/core/project';
import { shapePoints } from '../src/core/shapes';

const BACK = 0x5f819e;
const BELLY = 0xe9eff3;
const FIN = 0x4b6a82;
const DARK = 0x1a2128;
const MOUTH = 0x3a2024;
const EYE = 0x0b0d10;
const TEETH = 0xffffff;

const pieces: Piece[] = [];
const bodyGroup = newGroupId();
const finGroup = newGroupId();
const tailGroup = newGroupId();
const headGroup = newGroupId();

function keep(points: Vec3[], color: number, group: number, name: string): void {
  const faces = convexHull(points);
  if (!faces) throw new Error(`Casco inválido en ${name}`);
  const piece = makePiece(faces, color);
  piece.group = group;
  piece.groupName = name;
  pieces.push(piece);
}

/** Altura del centro del cuerpo sobre el suelo: el tiburón "nada" en el aire. */
const Y0 = 1.6;

interface Section {
  z: number;
  /** Semiancho, semialtura del lomo y semialtura del vientre. */
  rx: number;
  top: number;
  bottom: number;
  /** Desplazamiento vertical del centro de la sección. */
  yc: number;
}

/** Perfil del cuerpo de morro (z mayor) a cola (z menor). */
const PROFILE: Section[] = [
  { z: 3.3, rx: 0.05, top: 0.05, bottom: 0.04, yc: -0.05 },
  { z: 2.7, rx: 0.34, top: 0.36, bottom: 0.26, yc: -0.04 },
  { z: 1.7, rx: 0.6, top: 0.64, bottom: 0.48, yc: 0 },
  { z: 0.5, rx: 0.7, top: 0.74, bottom: 0.56, yc: 0 },
  { z: -0.8, rx: 0.56, top: 0.6, bottom: 0.46, yc: 0.02 },
  { z: -2.0, rx: 0.32, top: 0.36, bottom: 0.26, yc: 0.06 },
  { z: -2.8, rx: 0.14, top: 0.17, bottom: 0.12, yc: 0.1 },
];

const SIDES = 12;

/** Medio anillo de una sección: la mitad superior (lomo) o la inferior (vientre), con los puntos del eje incluidos. */
function halfRing(s: Section, upper: boolean): Vec3[] {
  const points: Vec3[] = [];
  for (let j = 0; j <= SIDES / 2; j++) {
    const a = (Math.PI * j) / (SIDES / 2);
    const x = Math.cos(a) * s.rx;
    const y = Math.sin(a) * (upper ? s.top : -s.bottom);
    points.push([x, Y0 + s.yc + y, s.z]);
  }
  return points;
}

// Cuerpo: dos mitades (lomo y vientre) entre cada par de secciones consecutivas
for (let i = 0; i < PROFILE.length - 1; i++) {
  keep([...halfRing(PROFILE[i], true), ...halfRing(PROFILE[i + 1], true)], BACK, bodyGroup, 'Cuerpo');
  keep([...halfRing(PROFILE[i], false), ...halfRing(PROFILE[i + 1], false)], BELLY, bodyGroup, 'Cuerpo');
}

// Aleta dorsal, curvada hacia atrás
keep(
  [[-0.06, Y0 + 0.62, 1.0], [0.06, Y0 + 0.62, 1.0], [-0.06, Y0 + 0.66, -0.15], [0.06, Y0 + 0.66, -0.15], [-0.015, Y0 + 1.55, -0.55], [0.015, Y0 + 1.55, -0.55]],
  FIN, finGroup, 'Aletas',
);
// Segunda dorsal, pequeña
keep([[-0.04, Y0 + 0.18, -1.7], [0.04, Y0 + 0.18, -1.7], [-0.04, Y0 + 0.2, -2.1], [0.04, Y0 + 0.2, -2.1], [0, Y0 + 0.5, -2.2]], FIN, finGroup, 'Aletas');

for (const s of [-1, 1]) {
  // Aletas pectorales: largas, hacia abajo y atrás
  keep(
    [[s * 0.45, Y0 - 0.3, 1.45], [s * 0.45, Y0 - 0.22, 1.45], [s * 0.5, Y0 - 0.34, 0.6], [s * 0.5, Y0 - 0.26, 0.6], [s * 1.75, Y0 - 0.95, 0.0], [s * 1.75, Y0 - 0.92, 0.0]],
    FIN, finGroup, 'Aletas',
  );
  // Aletas pélvicas y anal
  keep([[s * 0.25, Y0 - 0.44, -0.7], [s * 0.25, Y0 - 0.4, -0.7], [s * 0.28, Y0 - 0.44, -1.1], [s * 0.28, Y0 - 0.4, -1.1], [s * 0.6, Y0 - 0.7, -1.25]], FIN, finGroup, 'Aletas');
  // Ojos
  keep(shapePoints({ kind: 'sphere', size: [0.14, 0.14, 0.14], sides: 8 }).map((p): Vec3 => [p[0] + s * 0.42, p[1] + Y0 + 0.18, p[2] + 2.35]), EYE, headGroup, 'Cabeza');
  // Branquias: cinco rajas oscuras a cada lado
  for (let k = 0; k < 5; k++) {
    const z = 1.45 - k * 0.15;
    const half = 0.62 + (k - 2) * 0.01;
    keep(
      [[s * (half - 0.02), Y0 - 0.25, z], [s * (half + 0.035), Y0 - 0.25, z], [s * (half - 0.02), Y0 + 0.4, z], [s * (half + 0.035), Y0 + 0.4, z], [s * (half - 0.02), Y0 - 0.25, z - 0.03], [s * (half + 0.035), Y0 - 0.25, z - 0.03], [s * (half - 0.02), Y0 + 0.4, z - 0.03], [s * (half + 0.035), Y0 + 0.4, z - 0.03]],
      DARK, headGroup, 'Cabeza',
    );
  }
}

// Boca: una banda oscura bajo el morro y una hilera de dientes
keep([[-0.3, Y0 - 0.24, 2.0], [0.3, Y0 - 0.24, 2.0], [-0.12, Y0 - 0.26, 3.0], [0.12, Y0 - 0.26, 3.0], [-0.3, Y0 - 0.19, 2.0], [0.3, Y0 - 0.19, 2.0], [-0.12, Y0 - 0.2, 3.0], [0.12, Y0 - 0.2, 3.0]], MOUTH, headGroup, 'Cabeza');
for (let k = 0; k < 7; k++) {
  const x = -0.27 + k * 0.09;
  keep([[x - 0.03, Y0 - 0.2, 2.1], [x + 0.03, Y0 - 0.2, 2.1], [x, Y0 - 0.32, 2.1], [x - 0.03, Y0 - 0.2, 2.15], [x + 0.03, Y0 - 0.2, 2.15], [x, Y0 - 0.32, 2.15]], TEETH, headGroup, 'Cabeza');
}

// Cola: lóbulo superior largo y lóbulo inferior más corto, con ancho de verdad en Z (no una aguja)
const lobe = (points: [number, number][], thick: number, group: number): void =>
  keep(points.flatMap(([y, z]) => [[-thick, Y0 + y, z] as Vec3, [thick, Y0 + y, z] as Vec3]), FIN, group, 'Cola');
lobe([[-0.02, -2.6], [0.22, -3.0], [1.62, -3.55], [1.5, -4.25], [0.35, -3.6]], 0.045, tailGroup);
lobe([[-0.05, -2.6], [0.12, -3.0], [-0.9, -3.45], [-0.85, -3.95], [-0.2, -3.3]], 0.04, tailGroup);

mkdirSync('ejemplos', { recursive: true });
writeFileSync('ejemplos/tiburon.gridfacet.json', serializeProject(pieces, [], 24));
console.log(`ejemplos/tiburon.gridfacet.json: ${pieces.length} piezas, ${pieces.reduce((s, p) => s + p.faces.length, 0)} caras`);
