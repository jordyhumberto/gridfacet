# Plan de revisión de Gridfacet

Plan de trabajo salido de una revisión completa del programa (núcleo, herramientas e interfaz) hecha sobre el commit `d57f8af` de `main`. Está escrito para que lo ejecute otra persona u otro modelo sin más contexto que este archivo y el repositorio.

- **Estado de partida:** `npx tsc --noEmit` limpio, 587 pruebas en verde (`npx vitest run`), `npx vite build` correcto.
- **Qué contiene:** 8 fases, de la más urgente a la menos. Cada tarea trae dónde está, qué pasa, cómo reproducirlo, qué hacer y cómo saber que está hecha.
- **Qué no contiene:** funciones nuevas grandes. Solo hay una herramienta nueva (`Soldar cercanos`, tarea 4.4), porque ataca un problema que ya sufrió el usuario.

## Cómo leer las referencias

- Las rutas son relativas a la raíz del repositorio.
- **Los números de línea son del commit `d57f8af` y se desplazan con cada cambio.** Cada tarea da también el nombre de la función o un texto para buscar: úsalo, no te fíes del número.
- **Nivel de certeza** de cada defecto:
  - `[comprobado]`: se reprodujo ejecutando algo, o se leyó el código y es inequívoco.
  - `[leído]`: sale de leer el código una vez; **reprodúcelo antes de arreglarlo** y, si no se reproduce, anótalo en la tabla de seguimiento y sigue.

## Reglas de trabajo

1. **Una rama y un PR por tarea o por grupo pequeño de tareas relacionadas** (los grupos sugeridos están al principio de cada fase). Ramas `fix/...`, `feat/...` o `refactor/...`.
2. **No fusionar sin permiso del dueño.** Se abre el PR, se explica y se espera a que diga «Sí, fusiona». Fusionar con squash y borrar la rama.
3. **Mensajes de commit y PR en español**, con el estilo del historial: `fix(malla): …`, `feat(malla): …`, `fix(archivo): …`, `refactor(main): …`.
4. **Cada arreglo lleva su prueba.** Primero la prueba que falla, luego el arreglo. La lógica nueva va en `src/core/` como función pura con su `*.test.ts`; lo que depende de `MeshTool` se prueba como en `src/tools/meshSymmetry.test.ts` (un host falso con `ModelScene` real).
5. **Antes de abrir el PR:** `npx tsc --noEmit`, `npx vitest run` y, si el cambio se ve en pantalla, comprobarlo en el navegador (`npm run dev`, puerto 5173). En desarrollo existe `window.__mesh` (la instancia de `MeshTool`) para pruebas desde la consola.
6. **Textos de la interfaz en español**, con el tono del resto: frases completas, sin tecnicismos, diciendo qué hacer.
7. **El dueño prefiere atajos de una sola tecla.** No añadir atajos con modificadores salvo los estándar (Ctrl+Z, Ctrl+S…).
8. **No tocar los modelos del dueño** (`../novoxelProjects/`). Para probar con uno, copiarlo a una carpeta temporal `public/` y borrarla antes de hacer commit.
9. **Al terminar cada tarea, marcarla en la tabla de seguimiento** del final de este archivo, en el mismo PR.

## Contexto técnico mínimo

- **Pieza:** `{ id, faces: Vec3[][], color, faceColors?, faceTextures?, faceFlags?, group?, groupName?, layer? }` (`src/core/piece.ts`). Los arrays por cara van en paralelo con `faces`.
- **Los vértices no tienen identificador.** Dos esquinas son «el mismo vértice» cuando coincide `vertexKey` (coordenadas redondeadas a 1e-5, `src/core/vertices.ts`). Casi todos los problemas de costuras y simetría vienen de aquí.
- **Modelo:** `ModelScene` (`src/scene.ts`) guarda las piezas y una pila de deshacer de `Change { added, removed }`. `apply` escribe y anota; `preview` escribe sin anotar; `commitPreview` solo anota.
- **Malla:** `MeshTool` (`src/tools/meshTool.ts`). La elección es `Map<idPieza, Set<vertexKey>>`. `change(operation)` aplica una operación por pieza como un solo paso de deshacer. Con simetría, `buildTargets()` da `Target { original, keys, parts }`; cada `Part { keys, full, dir, mirror? }` es o bien lo elegido o bien su imagen en el espejo. **Las operaciones por grupo deben usar `part.full`, no `target.keys`.**
- **Aplicación:** casi todo el cableado está en `src/main.ts` (5 050 líneas) y el marcado y los estilos en `index.html`.

---

## Fase 1 — No perder trabajo

Lo más urgente. PR sugeridos: 1.1+1.2+1.3 juntos (flujo de archivo), 1.4, 1.5, 1.6.

### 1.1 Abrir un archivo, deshacer y guardar sobrescribe el archivo equivocado `[leído]`
- **Dónde:** `src/main.ts`, `replaceProject` (~3363–3384) y `undo` (~4788).
- **Qué pasa:** `replaceProject` cambia las piezas con `model.apply` (deshacible) pero fija `fileHandle`, `fileName`, capas, referencias y tamaño de sala fuera del historial. El mensaje de estado invita a pulsar Ctrl+Z.
- **Reproducir:** abrir A, abrir B, Ctrl+Z, Ctrl+S. El archivo B queda con el contenido de A, sin preguntar.
- **Arreglo:** abrir un proyecto no debe ser deshacible. Al abrir, vaciar el historial (añadir `clearHistory()` a `ModelScene` si no existe) y quitar del mensaje la invitación a Ctrl+Z. Las pilas de animación (`animationUndo`/`animationRedo`) ya se vacían ahí: seguir el mismo criterio.
- **Hecho cuando:** tras abrir B, Ctrl+Z no hace nada y Ctrl+S guarda B con el contenido de B. Prueba en `src/scene.test.ts` para `clearHistory`.

### 1.2 Abrir no pregunta con cambios sin guardar `[comprobado]`
- **Dónde:** `src/main.ts`, `requestOpen` (~3387) y `openProject` (~3345). Comparar con lo que hacen Nuevo y Recuperar.
- **Arreglo:** si `dirty` es verdadero, pedir confirmación con el mismo diálogo y texto que usa Nuevo, antes de mostrar el selector de archivo. Cubrir también arrastrar un archivo a la ventana, si existe ese camino.
- **Hecho cuando:** con cambios sin guardar, Ctrl+O pregunta; cancelar deja todo igual.

### 1.3 No hay aviso al cerrar la pestaña y la recuperación guarda una sola copia `[comprobado lo primero, leído lo segundo]`
- **Dónde:** `src/main.ts`, `stashPreviousSession` (~4975) y el autoguardado de alrededor (~4968–5007).
- **Qué pasa:** no existe `beforeunload`. La copia de recuperación tiene una sola generación: recargar, poner una pieza de prueba y recargar otra vez pisa el trabajo. El aviso solo sale en la barra de estado y «Recuperar» solo está en Ctrl+K.
- **Arreglo:**
  1. `window.addEventListener('beforeunload', …)` que pida confirmación solo si `dirty`.
  2. No guardar una generación nueva si la sesión que se cierra está vacía o no cambió nada.
  3. Guardar las 3 últimas generaciones con fecha y número de piezas, en vez de una.
  4. Botón «Recuperar…» visible en la sección Archivo, que liste esas generaciones.
- **Hecho cuando:** dos recargas seguidas no pierden el trabajo; cerrar con cambios pregunta; el botón existe y funciona. Extraer la lógica de generaciones a `src/core/` con pruebas.

### 1.4 Supr en Malla sin vértices elegidos borra la pieza entera `[leído]`
- **Dónde:** `src/main.ts`, manejador global de teclado, `if (key === 'delete' || key === 'backspace') deleteSelected();` (~4452). `MeshTool.handleKey` devuelve `false` cuando no hay vértices elegidos.
- **Reproducir:** Elegir una pieza, entrar en Malla, no elegir vértices, pulsar Supr.
- **Arreglo:** en modo `mesh`, Supr y Retroceso no borran piezas nunca: sin vértices elegidos, mensaje «Borrar vértices (Supr): elige los vértices que quieres quitar» (añadirlo a `NEEDS_SELECTION` en `meshTool.ts`). Retroceso tampoco debe borrar la selección en Cortar, Rellenar y Figura, donde ya sirve para otra cosa.
- **Hecho cuando:** el caso de arriba deja la pieza intacta.

### 1.5 Editar con otra capa activa cambia de capa las piezas de la capa 1 `[comprobado]`
- **Dónde:** `src/scene.ts`, `apply` (~61): `if (piece.layer === undefined && this.activeLayer !== 1) piece.layer = this.activeLayer`.
- **Qué pasa:** las piezas de la capa 1 no llevan `layer`, así que cualquier edición que pase por `apply` las confunde con piezas nuevas. `preview`/`commitPreview` no lo hacen: arrastrar y mover con teclas dan resultados distintos.
- **Arreglo:** la capa activa solo se asigna a piezas **nuevas de verdad**. Opción recomendada: cuando un `Change` tiene `removed`, las `added` son derivadas y no se tocan; solo se asigna capa si `removed` está vacío. Revisar los casos de colocar, pegar, duplicar y espejo-copia para confirmar que siguen cayendo en la capa activa.
- **Hecho cuando:** prueba en `src/scene.test.ts`: pieza en capa 1, capa activa 2, se aplica un cambio que la sustituye, y la nueva sigue sin `layer`.

### 1.6 Los grupos se mezclan al abrir un proyecto `[comprobado]`
- **Dónde:** `src/core/piece.ts` (~37): `let nextGroup = 1`. `replaceProject` no adelanta el contador.
- **Reproducir:** abrir un proyecto con `group: 1`, agrupar piezas nuevas: reciben el grupo 1 y se funden con el guardado (se eligen juntas y heredan su animación).
- **Arreglo:** exportar `reserveGroupIds(pieces)` que deje `nextGroup` por encima del mayor `group` presente, y llamarlo al abrir, al recuperar y al pegar.
- **Hecho cuando:** prueba unitaria: tras reservar con piezas de grupo 5, `newGroupId()` devuelve 6.

---

## Fase 2 — Malla con simetría

PR sugeridos: 2.1, 2.2+2.3, 2.4, 2.5+2.6, 2.7, 2.8.

### 2.1 La elección crece al lado espejo y el siguiente arrastre rompe la simetría `[comprobado el crecimiento, leído el efecto]`
- **Dónde:** `src/tools/meshTool.ts`, el `select` que devuelven las operaciones dentro de `change(...)`: `connectSelected`, `dissolveSelected`, `straightenSelected`, `flattenSelected`, `extrudeSelected`, `growFaceFromEdge`, `bevelSelected`, `ringCutSelected` (~1582–1800). Buscar `select: new Set(keys)` y los `select` que acumulan `created` de todos los `parts`.
- **Qué pasa:** `keys` (de `target.keys`) trae lo elegido **y** sus imágenes en espejo, así que tras la operación quedan elegidos los dos lados. En el siguiente arrastre `buildTargets` no crea parte espejo (ya está todo elegido) y los dos lados se mueven en la misma dirección.
- **Reproducir:** cubo que cruza el plano X, simetría X, elegir 2 vértices de la derecha, pulsar U: quedan 4 elegidos. Arrastrar: los dos lados van hacia el mismo sitio.
- **Arreglo:** el `select` devuelto debe contener solo lo que corresponde a las partes **sin** `mirror`. Para las operaciones que crean vértices (extruir, biselar, anillo, cara desde segmento), acumular solo los creados por la parte sin `mirror`. Añadir un ayudante `ownKeys(parts)` y usarlo en todas.
- **Hecho cuando:** en `meshSymmetry.test.ts`, para cada operación de la lista: tras ejecutarla con una elección de un solo lado, todos los vértices elegidos siguen en ese lado (o sobre el plano), y un arrastre simulado posterior deja el modelo simétrico (`isSymmetric`).

### 2.2 Simetrizar cambia el identificador de la pieza `[comprobado]`
- **Dónde:** `src/tools/meshTool.ts`, `symmetrizeAll` (~507): `placeVertices(piece, …)` sin conservar el id.
- **Qué pasa:** la pieza deja de estar elegida en Elegir (se ven los vértices de todas), pierde sus pistas de animación (`pruneTracks`) y su estado de oculta.
- **Arreglo:** envolver el resultado con `sameId(fixed, piece)` como el resto de operaciones y volver a indexar la elección por `piece.id`.
- **Hecho cuando:** prueba: el id de la pieza es el mismo antes y después de `symmetrizeAll`.

### 2.3 Simetrizar puede abrir una grieta entre dos piezas que compartían un vértice `[comprobado]`
- **Dónde:** `src/core/symmetry.ts`, `symmetrize`, el emparejamiento uno a uno (introducido en el PR 116).
- **Qué pasa:** si dos piezas tienen un vértice en la misma posición, solo una se empareja con el gemelo del otro lado; la otra queda «sin gemelo» y no se mueve.
- **Reproducir:** izquierda, una pieza con vértice en x=−1,02; derecha, dos piezas que comparten (1, 1, 1). Simetrizar mueve uno a 1,01 y deja el otro en 1,00.
- **Arreglo:** antes de emparejar, agrupar las entradas por posición (misma `vertexKey`) en un solo punto lógico; emparejar puntos lógicos y aplicar el resultado a todas las entradas del grupo. Mantener el emparejamiento exclusivo entre puntos lógicos.
- **Hecho cuando:** prueba con el caso de arriba: los dos vértices coincidentes acaban en la misma posición y no hay ninguno sin gemelo. Las pruebas actuales de `symmetrize` siguen pasando, incluida la de malla densa.

### 2.4 Biselar con simetría puede quedar a medias `[comprobado]`
- **Dónde:** `src/tools/meshTool.ts`, `bevelSelected` (~1593).
- **Qué pasa:** la parte espejo se aplica sobre la pieza ya biselada. Si el segmento que cruza el plano quedó más corto que el tamaño, el segundo bisel falla y el resultado es asimétrico. Lo mismo si un extremo está sobre el plano. `[leído]`
- **Reproducir:** cubo de ancho 1 que cruza el plano, tamaño de bisel 0,6: «1 arista biselada», 7 caras.
- **Arreglo:** hacer la operación todo o nada. Calcular todos los biseles sobre una copia; si alguna parte falla, no aplicar ninguna y explicar por qué («ese tamaño no cabe con la simetría activa: prueba con menos de X»). Calcular ese máximo y decirlo.
- **Hecho cuando:** prueba: con tamaño 0,6 no cambia nada y el mensaje da el máximo; con 0,25 quedan 8 caras y el modelo simétrico.

### 2.5 Ctrl+Z y Supr actúan en mitad de un arrastre `[comprobado en parte]`
- **Dónde:** `src/tools/meshTool.ts`, `handleKey` (~1131 y ~1195); `src/main.ts`, rama Ctrl+Z del teclado (~4305) y los botones del panel de Malla (`button[data-mesh]`, ~2275).
- **Qué pasa:** con un arrastre o un modal activos, Ctrl+Z ejecuta `model.undo()` sobre la vista previa y al soltar se vuelve a anotar un estado incoherente. Supr no comprueba `!this.drag`. Los botones del panel tampoco miran si hay un modal en marcha.
- **Arreglo:** exponer `MeshTool.busy` (arrastre, modal o recuadro activos). Con `busy`: Ctrl+Z, Ctrl+Y y Supr se ignoran, y los botones de acción del panel no hacen nada. Además R y T no deben arrancar un modal con el recuadro activo (~1116).
- **Hecho cuando:** prueba: iniciar un arrastre simulado, llamar a `handleKey` con Ctrl+Z y con Supr, y comprobar que el modelo y la profundidad del historial no cambian.

### 2.6 Un arrastre que no mueve nada crea un paso de deshacer vacío `[comprobado]`
- **Dónde:** `src/tools/meshTool.ts`, `finishDrag` (~1008–1036). También `finishModal`.
- **Qué pasa:** con el imán, un eje bloqueado o un tope por colisión, `moved` es verdadero con desplazamiento cero y `commitPreview({ added: [original], removed: [original] })` añade un paso inútil que además borra el rehacer.
- **Arreglo:** antes de anotar, comparar las piezas finales con las originales (misma geometría); si son iguales, restaurar y no anotar. Mejor aún, que `ModelScene.commitPreview` descarte los cambios cuya `added` y `removed` son la misma pieza.
- **Hecho cuando:** prueba en `scene.test.ts` y otra en `meshSymmetry.test.ts`: `undoDepth` no sube tras un arrastre sin desplazamiento.

### 2.7 Solo el vértice agarrado respeta el plano de simetría `[leído]`
- **Dónde:** `src/tools/meshTool.ts`, zona del arrastre (~853–863); los modales no tienen tope.
- **Reproducir:** elegir un vértice del plano y otro de fuera; arrastrar por el de fuera en X, o girar, escalar o empujar. El del plano se sale y queda sin gemelo.
- **Arreglo:** en `place`/`placedMap`, todo vértice que estaba sobre un plano de simetría activo (a menos de `MIRROR_TOLERANCE`) conserva esa coordenada. Aplicarlo a arrastre y a modales.
- **Hecho cuando:** prueba: tras arrastrar y tras escalar con esa elección, el vértice sigue con x igual al centro.

### 2.8 Pequeños de Malla `[leídos]`
Un PR con todos:
- **Elección de piezas ocultas o bloqueadas:** `refresh` (~428) no suelta la elección de una pieza que deja de mostrarse; Supr borra vértices invisibles. Soltarla al dejar de mostrarse. `[comprobado]`
- **`deactivate`** no limpia `pendingEdge`, `lastEdgeClick` ni el cursor.
- **`snapToGrid`** redondea las imágenes espejo por separado: asimétrico si el centro de simetría no es múltiplo del paso. Redondear el lado elegido y reflejar.
- **`updateUnpaired`** solo empareja entre piezas visibles: con una mitad elegida y el gemelo en otra pieza, todo sale en rosa. Emparejar contra todas las piezas editables y pintar solo las visibles.
- **Tope `MODAL_REACH`:** tras un salto grande del ratón el mensaje dice un valor y se aplica otro. Que el mensaje muestre el valor aplicado.
- **`down` del anfitrión queda viejo** (`src/main.ts`, `pointerdown`/`pointerup` del lienzo, ~2706 y ~2775) tras un clic en segmento o al añadir un vértice. Poner `down = null` cuando la herramienta consume el evento (exponer un aviso desde `MeshTool`).

---

## Fase 3 — Teclado

PR sugeridos: 3.1, 3.2, 3.3.

### 3.1 E con una pieza elegida no entra en Malla `[comprobado]`
- **Dónde:** `src/main.ts`, teclado: `if (key === 'pageup' || key === 'e') moveSelectionBy(0, stepY, 0)` (~4413) se ejecuta antes que `if (key === 'e') setMode(...)` (~4441).
- **Qué pasa:** el flujo natural (S, clic en la pieza, E) sube la pieza un cuarto de celda en silencio. Q hace lo contrario.
- **Arreglo:** E siempre entra y sale de Malla. Subir y bajar la selección se queda en RePág y AvPág. Actualizar la ayuda y los títulos de los botones.
- **Hecho cuando:** con una pieza elegida, E entra en Malla y la pieza no se mueve.

### 3.2 Atajos que no deben actuar en Malla `[leído]`
- **Dónde:** `src/main.ts`, teclado (~4423–4449).
- **Qué pasa:** en Malla, M refleja la pieza entera, O e I la ocultan o aíslan, y los dígitos 1–9 saltan a Colocar perdiendo los vértices elegidos.
- **Arreglo:** en modo `mesh`, esas teclas no hacen nada salvo que `MeshTool.handleKey` las tome. Los dígitos, si hay vértices elegidos, no cambian de herramienta.
- **Hecho cuando:** en Malla con vértices elegidos, pulsar M, O, I y 3 no cambia nada.

### 3.3 Atajos estándar `[comprobado el primero]`
- **Ctrl+Shift+Z** deshace en vez de rehacer (~4305): debe rehacer.
- **Ctrl+S con el foco en un campo numérico** abre «Guardar página» del navegador (~4267): los atajos con Ctrl deben evaluarse antes del filtro de «estoy escribiendo».
- **«?» dentro de un campo de texto** abre la ayuda (~4261): ignorarlo si el foco está en un campo.
- **Esc en Crecer y Hundir** no vuelve a Colocar como dice la guía (~4475): hacer lo que dice la guía.
- **Hecho cuando:** los cuatro casos se comportan como se describe.

---

## Fase 4 — Datos, costuras y exportación

PR sugeridos: 4.1, 4.2, 4.3, 4.4, 4.5.

### 4.1 Exportar «unido» borra piezas apoyadas en una pieza abierta `[comprobado]`
- **Dónde:** `src/core/convex.ts` (`isConvex`, ~22), `src/core/union.ts` (~24), `src/core/export.ts` (~109).
- **Qué pasa:** `isConvex` no exige que la pieza esté cerrada. Una caja sin tapa «es convexa», sus planos describen un prisma infinito y todo lo que cae dentro se elimina. Afecta también a cortar y restar.
- **Reproducir:** cubo sin tapa con otro cubo encima; exportar GLB u OBJ en modo unido: el de arriba desaparece.
- **Arreglo:** añadir `isClosed(piece)` (toda arista tiene su contraria; se puede apoyar en `openLoops` y en el recuento de aristas dirigidas de `vertices.ts`) y exigirlo donde se trata la pieza como sólido. Las piezas abiertas se exportan tal cual, sin pasar por la unión.
- **Hecho cuando:** prueba en `export.test.ts` con ese caso: el cubo de arriba conserva sus triángulos.

### 4.2 Una sola definición de «mismo punto» `[leído]`
- **Dónde:** claves de vértice repetidas con precisiones distintas: 1e-5 en `vertices.ts`, `bevel.ts`, `modeling.ts`, `selfIntersect.ts`, `scene.ts`; 1e-6 en `export.ts` (~19) y `merge.ts` (~5); 1e-7 en `piece.ts` (~83); 1e-4 en `guides.ts` (~35).
- **Qué pasa:** dos esquinas que el editor trata como el mismo vértice pueden exportarse sin soldar.
- **Arreglo:** un módulo `src/core/key.ts` con `vertexKey` y `VERTEX_EPSILON`, importado por todos. Donde haya motivo para otra precisión, dejar una constante con nombre y un comentario que lo explique.
- **Hecho cuando:** `grep -rn "Math.round(v \* 1e" src/` solo da resultados en `key.ts`. Las pruebas siguen pasando.

### 4.3 `vertexKey` redondea, no tolera `[comprobado la aritmética]`
- **Dónde:** `src/core/vertices.ts` (~6) y `rebuild`.
- **Qué pasa:** dos números casi idénticos a ambos lados de una frontera de redondeo dan claves distintas (por ejemplo 0,015625 y un pelo menos). Se llega ahí con tres puntos medios seguidos sobre la rejilla. Cada esquina conserva su propio número y con el tiempo se separan.
- **Arreglo:** que `rebuild` canonice: todas las esquinas con la misma clave comparten exactamente el mismo `Vec3` (el primero que aparece). Hacer lo mismo al cargar un proyecto.
- **Hecho cuando:** prueba: dos esquinas con la misma clave y distinto valor quedan con valores idénticos tras `rebuild`.

### 4.4 Herramienta «Soldar cercanos» `[nueva]`
- **Por qué:** el modelo `cara` del dueño tenía 15 pares de vértices a menos de 1 mm que parecían soldados y no lo estaban; hubo que arreglarlo a mano.
- **Qué hacer:**
  - `weldVertices(piece, tolerance)` en `src/core/vertices.ts`: agrupa los vértices a menos de `tolerance`, lleva cada grupo a su punto medio y quita las caras que se quedan sin superficie. Devuelve la pieza y cuántos se soldaron.
  - En Malla, sección «Elegir y borrar»: botón «Soldar cercanos» y campo «Distancia» (por defecto 0,002). Actúa sobre los vértices elegidos o, sin elección, sobre todas las piezas visibles. Con simetría debe dejar el modelo simétrico.
  - Mensaje con el número de vértices soldados; si no hay ninguno, decirlo.
  - Al abrir un proyecto, si hay pares a menos de 0,002, avisar en la barra de estado («N vértices casi encima de otro: Soldar cercanos los junta»), sin tocar nada.
- **Hecho cuando:** pruebas del núcleo (se sueldan, no se sueldan los lejanos, se quitan caras degeneradas, conserva colores y propiedades por cara) y prueba de simetría en `meshSymmetry.test.ts`.

### 4.5 Pequeños de datos `[comprobados salvo donde se indica]`
Un PR con todos:
- **`mergeVertices`** (`vertices.ts`, ~81) solo quita repetidos consecutivos: fundir dos esquinas opuestas de un cuadrilátero deja una cara `[c, B, c, D]` sin superficie. Quitar las caras con menos de tres vértices distintos.
- **`makePiece`** (`piece.ts`, ~89) valida la longitud de texturas y propiedades pero no la de `faceColors`.
- **`parseProjectFull`** (`project.ts`, ~88): un solo vértice no numérico hace ilegible todo el archivo. Descartar la cara o la pieza dañada, cargar el resto y avisar de cuántas se descartaron.
- **`layers.load`** (`layers.ts`, ~102) lanza un error con una entrada `null`, y lo hace después de cambiar las piezas: quedan las capas y el archivo viejos y el siguiente Guardar escribe donde no debe. Validar en `parseProjectFull` antes de tocar nada.
- **`collapsed`** (`main.ts`, ~4083) no se valida como lista al leerlo de `localStorage`. `[leído]`

---

## Fase 5 — Interfaz y textos

PR sugeridos: 5.1, 5.2, 5.3.

### 5.1 Cambios que no marcan «sin guardar» `[leído]`
- **Dónde:** `src/main.ts`, `refreshLayers` (~1018), `removeLayer` (~963), `setGridSize` (~4107).
- **Qué pasa:** crear, renombrar, ocultar, bloquear o quitar una capa, y cambiar el tamaño de la sala, no ponen el ●. `removeLayer` además cambia piezas sin pasar por el historial.
- **Arreglo:** marcar `dirty` en todos, y que `removeLayer` use `model.apply`.

### 5.2 Animación y deshacer `[leído]`
- **Dónde:** `src/main.ts`, `pruneTracks` dentro del `onChange` del modelo (~4850).
- **Qué pasa:** borrar o desagrupar un grupo animado y deshacer devuelve las piezas pero no sus claves de animación.
- **Arreglo:** no podar en cada cambio. Podar solo al guardar y al exportar, o guardar la poda en la pila de deshacer de animación.

### 5.3 Coherencia de modos y textos `[leídos]`
- **«Figura» falta en cuatro listas** de `main.ts`: cursor (~338), acciones de selección (~1274) y las dos de flechas (~4378 y ~4385). Las flechas mueven piezas mientras se marca un contorno.
- **El recuadro Ctrl+arrastrar elige piezas ocultas** (`finishMarquee`, ~1383); Ctrl+A sí las filtra. Alt+O muestra piezas de capas marcadas como ocultas (~4432).
- **La fila «Plano:»** se ve al arrancar en Colocar (`index.html`, ~235) y solo se oculta tras el primer cambio de herramienta.
- **Textos que contradicen el código:**
  - `index.html` ~420: «flechas empujan (Ctrl: fino)». En Malla las flechas mueven la cámara. Quitar esa parte o implementarla (decidir con el dueño).
  - `index.html` ~188: el botón de unir **piezas** se llama «Fusionar vértices». Renombrar a «Unir piezas».
  - `index.html` ~677: dice que avisa si la pieza no es convexa, pero las junta igual (`mergeSelected`, `main.ts` ~1645).
  - `index.html` ~709 contra ~707 y `main.ts` ~3985: lo que se dice sobre texturas en GLB, sprites y al cortar no coincide.
  - `main.ts` ~4007: Cara dice «elegir la cara y abrir sus acciones»; el clic aplica directamente.
  - `main.ts` ~3881: «Panel Selección: fusionar, excavar»; están en Herramientas.
  - `index.html` ~722: alto «en placas»; el código muestra celdas.
  - La ayuda no tiene entrada para Malla (E) ni para Figura.
- **Hecho cuando:** cada texto dice lo que el programa hace. Revisar la ayuda entera una vez contra el teclado real.

---

## Fase 6 — Rendimiento

PR sugeridos: 6.1, 6.2.

### 6.1 Malla recalcula todo en cada movimiento del ratón `[leído]`
- **Dónde:** `src/main.ts`, el `onChange` del modelo llama a `meshTool.refresh()` (~225) también con `model.preview`. `refresh` repite `uniqueVertices` de todo, `updateWarnings`, `updateUnpaired` (que ejecuta `symmetrize` con hasta 12 pasadas) y `syncMeshActions`.
- **Arreglo:**
  1. Durante un arrastre o un modal, actualizar solo las posiciones de los puntos (`paint`), y dejar avisos, gemelos y panel para cuando se suelta.
  2. `updateUnpaired`: no recalcular si no cambiaron ni las piezas ni la simetría (guardar una firma).
  3. `occluded()` recorre todas las caras por vértice: guardar por fotograma la lista de triángulos ya transformados.
  4. `splitEdgeAt` (~2032) recorre `shown` por vértice en vez de por pieza.
- **Hecho cuando:** medir antes y después con un modelo de unos 2 000 vértices (la esfera de la herramienta Forma sirve): el tiempo por movimiento durante el arrastre baja al menos a la mitad. Anotar las cifras en el PR.

### 6.2 Otras herramientas y comprobaciones caras `[leído]`
- **Cortar, Rellenar y Figura** reconstruyen todo el dibujo de ayuda en cada movimiento (`setHover` llama a `refresh`), y de paso borran los avisos de la barra de estado. Separar «cambió el cursor» de «cambió la forma».
- **Vértice** (`vertexTool.ts`): `hoverAt` reconstruye todos los puntos por movimiento y los candidatos no se recalculan tras deshacer.
- **`collapses`** (`src/core/selfIntersect.ts`, ~86) es cuadrático y corre en cada movimiento. Descartar antes con cajas envolventes.
- **Paquete de producción:** 860 kB en un archivo. Separar Three.js en su propio trozo con `build.rollupOptions.output.manualChunks`. Prioridad baja.

---

## Fase 7 — Orden de las herramientas

**Esta fase cambia cosas a las que el dueño ya está acostumbrado. Enseñarle la propuesta y esperar su visto bueno antes de empezar, y hacerla en pasos pequeños.** PR sugeridos: uno por apartado.

### 7.1 Nombres (sin mover nada)
- «Vértice» (V) no crea vértices: pasa a **«Punto guía»**.
- La casilla «Malla» de Vista y «Límite de la malla» pasan a **«Rejilla»**; «Malla» queda solo para la herramienta.
- «Paleta» de Ctrl+K pasa a **«Comandos»**; «Paleta» queda para los colores.
- Un solo verbo por idea: **Elegir** (no Seleccionar), **Unir** para piezas y **Fusionar** para vértices, **Reflejar** para girar al otro lado, **Simetría** para el modo.
- «Biselar arista» de Malla pasa a **«Chaflán»**, igual que la herramienta J, y comparten el mismo tamaño guardado.
- Un solo control de densidad con un solo nombre (hoy hay tres, dos llamados «Cantidad de vértices»).

### 7.2 Panel de Malla
- «Fusionar vértices», «Vértices a la rejilla» y «Soldar cercanos» van a una sección nueva **«Limpiar»**; «Elegir y borrar» se queda con Elegir todos y Borrar vértices.
- «Triangular» va junto a su inversa «Quitar segmento», en «Segmentos».
- «Mover en» y «Plano» existen dos veces (Elegir y Malla): un solo componente.
- Atajos de una tecla para las acciones que no tienen (Triangular, Chaflán, Corte en anillo, Extruir cara, Elegir todos). Hacer primero la tabla de la tarea 8.3 para ver qué teclas quedan libres en Malla.
- Bajo cada botón apagado, o en su título, el motivo («necesita 3 vértices de la misma pieza»).

### 7.3 Barra de herramientas
Agrupar los botones con títulos, sin cambiar las teclas:
```
Crear      Colocar (1–9, con Tamaño, Pendiente y Grosor) · Forma (T) · Rellenar (L)
Elegir     Elegir (S) · Borrar (B)
Caras      Crecer (G) · Hundir (D) · Cara (F) · Figura · Cortar (C) · Chaflán (J)
Vértices   Malla (E)
Pintar     Pintar (P): cara o píxeles
Guías      Punto guía (V) · Plano de trabajo · Imán
```
Mover Tamaño, Pendiente y Grosor (hoy en Piezas) junto a Colocar. Dar una tecla a Figura.

### 7.4 Un solo panel de selección
Las acciones sobre piezas elegidas están en cuatro sitios (Herramientas, sección Selección, Capas y Ctrl+K). Reunirlas en un panel «Selección» que aparece al elegir algo, y sacar a botones lo que hoy solo está en Ctrl+K: alinear, distribuir, al suelo, redimensionar, espejo-copia y limpiar astillas.

### 7.5 Unificar «sacar o meter una cara» (opcional, solo si el dueño lo pide)
Hoy hay siete caminos y tres campos de cantidad: Crecer, Hundir, Cara → Extruir, Figura, y en Malla Extruir, Empujar y Cara desde segmento. Propuesta: una sola herramienta «Empujar/Jalar» sobre piezas (une Crecer, Hundir y Cara → Extruir; Figura como opción «dibujar contorno») con un solo campo de cantidad compartido con Malla. Es un cambio grande: no empezarlo sin acuerdo.

---

## Fase 8 — Mantenimiento del código

Sin cambios de comportamiento: cada PR debe dejar la aplicación idéntica. PR sugeridos: uno por apartado.

### 8.1 Partir `src/main.ts` (5 050 líneas)
En este orden, de menor a mayor riesgo. Los rangos son del commit `d57f8af`:
1. Ayuda, `MODE_INFO`, comandos y guía (~3521–4077): casi solo datos → `src/ui/help.ts`.
2. Animación con su historial (~4485–4858) → `src/ui/animationPanel.ts`.
3. Guardar, abrir, exportar y recuperar (~3264–3511 y ~4968–5007) → `src/ui/files.ts`. Hacerlo después de la fase 1.
4. Teclado (~4250–4483) → ver 8.3.
5. Píxeles (~1836–2100 y ~2305–2357), panel de Malla (~2103–2303), capas y grupos (~923–1094), colocación (~547–868).

### 8.2 Un solo punto de aviso de cambios
`model.onChange` se envuelve tres veces (`main.ts` ~194, ~1928 y ~4847) y `selection.onChange` dos; solo el orden del archivo lo sostiene. Sustituir por una lista de suscriptores (`model.subscribe(fn)`).

### 8.3 El teclado como tabla
Convertir la cadena de `if (key === …)` en una tabla `{ tecla, modos, condición, acción, descripción }`. Con ella:
- se detectan en una prueba las teclas repetidas en un mismo modo;
- la ayuda y los títulos de los botones se generan de la tabla y dejan de contradecir al código;
- se ve qué teclas quedan libres.
Incluir en la tabla las teclas que toma `MeshTool.handleKey`.

### 8.4 Código repetido en el núcleo
- **`pieceEdges`** existe dos veces con significado distinto: `bevel.ts` (~22, solo aristas con dos caras) y `vertices.ts`. Dejar una, con una opción.
- **Copia de `group`, `groupName` y `layer`** escrita a mano en `vertices.ts` (~41, ~182, ~574, ~747): usar `keepGroup`.
- **Caja envolvente** calculada en cinco sitios (`transform.boundsOf`, `animation.groupCentre`, `union.boxOf`, `rotationCenter`, `mirrorCenter`): una sola.
- **Base 2D de un plano** en `cut.ts` (~73) y `vertices.ts` (~260): una sola.
- Las claves de vértice se resuelven en la tarea 4.2.

### 8.5 Pruebas que faltan
- `src/core/pixels.ts` no se revisó en esta pasada: leerlo con las mismas preguntas (arrays por cara en paralelo, casos degenerados) antes de tocarlo.
- El escritor de GLB tampoco se abrió: revisarlo junto con la tarea 4.1.
- Añadir pruebas de `MeshTool` para arrastres y modales simulados (hoy solo hay pruebas de acciones de un paso).
- `faceEditor.ts`: `up()` (~249) no comprueba si la pieza sigue existiendo; Ctrl+Z en mitad de un trazo y soltar deja la pieza duplicada. `close()` con un trazo en curso deja la vista previa sin revertir. `[leído]` Arreglarlo con su prueba.

---

## Lo que se revisó y está bien

Para no volver a mirarlo sin motivo:
- `fileAccess.ts`, `animation.ts`, `texture.ts`, `transform.ts`, `cut.ts`, `obj.ts`, `merge.ts`: sin defectos encontrados.
- `project.ts` guarda y recupera todos los campos de una pieza.
- En `vertices.ts` los arrays por cara van siempre en paralelo con `faces`.
- Deshacer y rehacer de `scene.ts` son coherentes; `record` e `historyMoved` de `MeshTool` también.
- En `MeshTool`: el recuadro y el arrastre devuelven la órbita y la captura del puntero; `deactivate` cancela modal, arrastre y recuadro; `fillHolesSelected`, `ringCutSelected`, `triangulateSelected` y Empujar cara usan los grupos de simetría correctos.
- Cortar con la región sobre el plano de espejo no corta dos veces.

## Seguimiento

Marcar cada tarea al fusionar su PR. Si un defecto `[leído]` no se reproduce, poner «no se reproduce» y una línea de por qué.

| Tarea | Estado | PR | Notas |
|---|---|---|---|
| 1.1 Abrir, deshacer, guardar | hecha | rama fix/plan-revision | `ModelScene.clearHistory()`; `replaceProject` vacía el historial y las pilas de animación (también Nuevo y Recuperar) y los mensajes ya no invitan a Ctrl+Z |
| 1.2 Abrir pregunta | hecha | rama fix/plan-revision | `confirmDiscard` compartido por Abrir, Nuevo y Recuperar; no existe arrastrar archivos a la ventana |
| 1.3 Aviso al cerrar y recuperación | hecha | rama fix/plan-revision | `beforeunload` si hay cambios; 3 generaciones en `core/recovery.ts` (clave `gridfacet.recovery`, migra `gridfacet.previous`); botón «Recuperar…» en Archivo |
| 1.4 Supr en Malla | hecha | rama fix/plan-revision | Reproducido (`handleKey` devolvía false). En Malla Supr/Retroceso nunca borran piezas; Retroceso tampoco en Cortar, Rellenar y Figura (Supr sí sigue borrando la selección ahí, porque el plan solo cita Retroceso) |
| 1.5 Capa al editar | hecha | rama fix/plan-revision | `apply` solo asigna la capa activa si el cambio no quita piezas (las derivadas conservan la suya) |
| 1.6 Grupos al abrir | hecha | rama fix/plan-revision | `reserveGroupIds` en `core/piece.ts`; se llama desde `replaceProject` (abrir, nuevo y recuperar). Pegar no lo necesita: usa `newGroupId` y el contador ya va por delante |
| 2.1 Elección crece al espejo | hecha | rama fix/plan-revision | Reproducido. `ownKeys(parts)` y `oneSide` en `meshTool.ts`: conectar, quitar segmento, alinear, aplanar, extruir, cara desde segmento, biselar y anillo dejan elegido solo el lado de quien eligió (en el anillo y el bisel que cruzan el plano, de cada pareja espejo se queda la más cercana a lo elegido) |
| 2.2 Simetrizar conserva el id | hecha | rama fix/plan-revision | Reproducido. `symmetrizeAll` conserva el id con `sameId` y reindexa la elección por `piece.id` |
| 2.3 Simetrizar y piezas que comparten vértice | hecha | rama fix/plan-revision | Reproducido. `symmetrize` junta las entradas con la misma `vertexKey` en un punto lógico, empareja puntos y aplica el resultado a todas las entradas |
| 2.4 Bisel todo o nada | hecha | rama fix/plan-revision | Reproducido (cubo de 1, tamaño 0,6: 7 caras). `bevelSelected` prueba antes en una copia (`bevelParts`) y, si algún lado no cabe, no aplica nada y da el máximo (búsqueda binaria, redondeado hacia abajo a centésimas); si el espejo comparte un extremo lo dice |
| 2.5 Teclas durante un arrastre | hecha | rama fix/plan-revision | Reproducido. `MeshTool.busy` (arrastre, modal o recuadro): `handleKey` ignora Ctrl+Z/Ctrl+Y/Supr/Retroceso, R y T no arrancan con el recuadro, `change`, `beginTransform`, `symmetrizeAll` y `bevelSelected` no hacen nada, y `undo`/`redo` y los botones del panel de `main.ts` también se detienen |
| 2.6 Paso de deshacer vacío | hecha | rama fix/plan-revision | Reproducido. `ModelScene.commitPreview` descarta las piezas cuya geometría no cambió (`sameGeometry`) y no anota ni borra el rehacer; `finishDrag` y `finishModal` solo anotan la elección si el historial subió |
| 2.7 Vértices del plano | pendiente | | |
| 2.8 Pequeños de Malla | pendiente | | |
| 3.1 Tecla E | pendiente | | |
| 3.2 Atajos en Malla | pendiente | | |
| 3.3 Atajos estándar | pendiente | | |
| 4.1 Exportar piezas abiertas | pendiente | | |
| 4.2 Una sola clave de vértice | pendiente | | |
| 4.3 Canonizar vértices | pendiente | | |
| 4.4 Soldar cercanos | pendiente | | |
| 4.5 Pequeños de datos | pendiente | | |
| 5.1 Marca de sin guardar | pendiente | | |
| 5.2 Animación y deshacer | pendiente | | |
| 5.3 Modos y textos | pendiente | | |
| 6.1 Rendimiento de Malla | pendiente | | |
| 6.2 Otras herramientas | pendiente | | |
| 7.1 Nombres | pendiente | | Pedir visto bueno |
| 7.2 Panel de Malla | pendiente | | Pedir visto bueno |
| 7.3 Barra de herramientas | pendiente | | Pedir visto bueno |
| 7.4 Panel de selección | pendiente | | Pedir visto bueno |
| 7.5 Empujar/Jalar unificado | pendiente | | Solo si el dueño lo pide |
| 8.1 Partir main.ts | pendiente | | |
| 8.2 Suscriptores de cambios | pendiente | | |
| 8.3 Teclado como tabla | pendiente | | |
| 8.4 Código repetido | pendiente | | |
| 8.5 Pruebas que faltan | pendiente | | |
