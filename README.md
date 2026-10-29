# Gridfacet

Editor web de modelos *low poly* hechos con **poliedros convexos** sobre una malla. Pensado para armar figuras con estética de PS1 (como Mega Man Legends), exportarlas a **GLB** y rigearlas o animarlas en Blender o Godot.

TypeScript + Three.js + Vite. Todo corre en el navegador; no hay servidor.

## Cómo usarlo

```bash
npm install
npm run dev      # editor en http://localhost:5173
npm test         # pruebas unitarias
npm run build    # compilación de producción
```

Dentro de la app, el botón **Ayuda y atajos (?)** explica cada herramienta.

## Qué se puede hacer

- **Colocar** cubo, placa, rampa, ladrillo, lámina, cilindro, arco y esquinas, con **tamaño** a elegir (1, ¾, ½, ⅓, ¼ o exacto).
- **Cortar** con planos o regiones, **rellenar** volúmenes entre puntos, **chaflán**, **formas** (esfera, cilindro, cono, cápsula).
- **Cara**: extruir, cavar (cráteres con paredes inclinadas y reborde) y dividir. **Excavar** resta una pieza de otras; **Fusionar** une piezas si el resultado es convexo.
- **Crecer** una cara o toda la cara conectada, con la cantidad que quieras (¼, ⅓, ½, 1…).
- **Repetir** en serie con desplazamiento, giro y escala; **simetría**, grupos con nombre, espejo, pintar por cara y últimos colores.
- **Contador de triángulos** con presupuesto, útil para mantenerse en el rango de un personaje PS1 (300–800).
- **Exportar GLB** (uniendo por color o una malla por pieza) y guardar/abrir proyectos `.gridfacet.json`. Los proyectos antiguos (`.novoxel.json`) se siguen abriendo.

## Ejemplos

En [`ejemplos/`](ejemplos) hay un gato, un árbol y un tiburón. Se generan con scripts reproducibles:

```bash
npx vite-node scripts/tiburon.ts
```

## Estructura

- `src/core/`: geometría y operaciones sobre piezas (corte, casco convexo, resta, extrusión, exportación…), con sus pruebas.
- `src/tools/`: herramientas interactivas (cortar, rellenar, vértices).
- `src/render/`: mallas, sombreado y GLB.
- `src/main.ts`: interfaz y cableado.

## Licencia

MIT. Ver [LICENSE](LICENSE).
