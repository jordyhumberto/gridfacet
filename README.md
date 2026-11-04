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

- **Colocar** cubo, placa, rampa, ladrillo, lámina, cilindro, arco y esquinas, con **tamaño** a elegir (1, ¾, ½, ⅓, ¼ o exacto). La pieza sigue al cursor en pasos de ¼, con imán a las aristas y a la rejilla, tanto en el suelo y las paredes de la sala como sobre otras piezas, sin saltar de celda en celda.
- **Cortar** con planos o regiones, **rellenar** volúmenes entre puntos, **chaflán**, **formas** (esfera, cilindro, cono, cápsula).
- **Cara**: extruir, cavar (cráteres con paredes inclinadas y reborde) y dividir. **Excavar** resta una pieza de otras; **Fusionar** une piezas si el resultado es convexo.
- **Crecer** una cara o toda la cara conectada, con la cantidad que quieras (¼, ⅓, ½, 1…).
- **Repetir** en serie con desplazamiento, giro y escala; **simetría**, grupos con nombre, espejo, pintar por cara y últimos colores.
- **Malla libre (estilo picoCAD)**: además de poliedros convexos, las piezas se pueden volver mallas libres (abiertas, cóncavas, de una sola cara). Con la herramienta **Malla** eliges vértices (clic, recuadro con Ctrl, *Todos*) y los mueves, **giras** (R), **escalas** (T), **afinas**, **tuerces** o **curvas**; también **fusionar** y **borrar** vértices, **a la rejilla**, partir una arista con un vértice nuevo y respetar la **simetría**. Los botones **Mover en: Libre · X · Y · Z** limitan el movimiento a un solo eje y se mantienen entre arrastres. Una **brújula de ejes** en la esquina del visor (X rojo, Y verde, Z azul) gira con la cámara y resalta el eje bloqueado; un clic en una letra mira desde ese eje. Al arrastrar, tres líneas guía cruzan el vértice agarrado. Con los vértices elegidos puedes **crear**, **borrar**, **invertir** y **extruir caras**.
- **Propiedades de cara**: *Doble cara* (hojas, ropa), *Sin sombra* (se ve con su color tal cual) y *Al fondo* (se dibuja bajo todo lo demás: huellas, sombras pintadas; solo en el editor, porque el GLB no guarda el orden de dibujo). Doble cara y Sin sombra sí viajan al GLB.
- **Vistas ortogonales**: teclado numérico 1 (frente), 3 (lado), 7 (arriba) y 5 (alternar perspectiva/ortogonal) para modelar con precisión.
- **Animación por claves, por grupo**: panel *Animación* con fotogramas y FPS; eliges un grupo, pones **claves** de posición, giro y escala (en los campos o **posando con el ratón**: Mover, Girar, Escalar) y reproduces en bucle. Ctrl+Z y Ctrl+Y deshacen y rehacen también las claves, en orden con el resto de cambios. La animación se guarda en el proyecto y sale en el GLB como un clip llamado `Animacion` (un nodo por grupo animado), validado con `gltf-validator`.
- **Deshacer sin perder la selección**: al deshacer o rehacer, los vértices elegidos vuelven a como estaban. Abrir un archivo se deshace de una vez, piezas y animación.
- **Contador de triángulos** con presupuesto, útil para mantenerse en el rango de un personaje PS1 (300–800).
- **Exportar GLB** (uniendo por color o una malla por pieza) y guardar/abrir proyectos `.gridfacet.json`. Los proyectos antiguos (`.novoxel.json`) se siguen abriendo.

## Ejemplos

En [`ejemplos/`](ejemplos) hay un gato, un árbol, un tiburón y una cabeza low poly (`cabeza.gridfacet.json`, de 22 piezas, para abrir con “Abrir”). Los tres primeros se generan con scripts reproducibles:

```bash
npx vite-node scripts/tiburon.ts
```

## Estructura

- `src/core/`: geometría y operaciones sobre piezas (corte, casco convexo, resta, extrusión, exportación…), con sus pruebas.
- `src/tools/`: herramientas interactivas (cortar, rellenar, vértices y malla libre).
- `src/core/animation.ts` y `src/render/animationPlayer.ts`: claves, muestreo y reproducción de la animación.
- `src/render/`: mallas, sombreado y GLB.
- `src/main.ts`: interfaz y cableado.

## Licencia

MIT. Ver [LICENSE](LICENSE).
