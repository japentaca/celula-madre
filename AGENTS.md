# AGENTS.md — Música Generativa Algorítmica

Guía para agentes de IA que trabajen en este repositorio. Es el único documento
de referencia; ante cualquier duda manda el código actual.

## Qué es

Aplicación web de música generativa: compone piezas aleatorias a partir de una
célula binaria madre y sus variaciones, las distribuye en pistas y secciones
formales (A-B-A…), y las reproduce con Tone.js mientras dibuja un piano roll.
Todo se **pre-computa antes de reproducir**; no hay generación en tiempo real.

## Stack y ejecución

- JavaScript vanilla (ES6, sin build, sin npm, sin frameworks).
- Tone.js 14.8.49 por CDN (`index.html`).
- THREE.js 0.170 por CDN con importmap, solo para la vista 3D
  (`js/visualizer3d.js`, único módulo ESM; si el CDN falla la app sigue en 2D).
- **No funciona desde `file://`**: Tone.js necesita contexto seguro. Servir por
  HTTP local, p. ej. `python -m http.server 8000` en la raíz y abrir
  `http://localhost:8000`. Ver skill `run-app`.
- No hay tests automatizados ni linter. La lógica de generación se puede probar
  headless con Node (ver skill `test-generator`).

## Arquitectura

Diez módulos IIFE (scripts clásicos) más uno ESM (`visualizer3d.js`), cada uno
expone un objeto global. El orden de carga en `index.html` importa (no hay
imports; `generator.js` va antes que los pases porque comparte utilidades):

| Módulo | Global | Responsabilidad |
|---|---|---|
| `js/audio.js` | `AudioEngine` | Grafo de audio Tone.js: presets de sintes (nombre de fábrica o definición `{ base, params, chain }`), una instancia por pista, cadena de efectos de inserción por pista (sinte→fx→panner), envíos a reverb/delay, paneo, master. Se puede deshabilitar desde el topbar (checkbox Audio) sin parar el Transport. `setupTracks` no desecha en seco las pistas de la pieza anterior: las desvanece (`RETIRE_FADE`, 4 s) para no cortar colas de release ni notas en vuelo, y las desecha después. |
| `js/syntheditor.js` | `SynthEditor` | Editor modal por pista: esquemas declarativos de parámetros por tipo de sinte, cadena de efectos (catálogo curado, reordenable), edición en vivo vía `AudioEngine`, presets de usuario en localStorage (`binario.userPresets`, id `user:Nombre`) con export/import JSON. Comunica cambios a `App` por callbacks (`trackSettings.edited`). |
| `js/midi.js` | `MidiEngine` | Salida Web MIDI hacia VSTs/hardware: puerto global (topbar), canal 1-16 por pista (strip), note-on/off con timestamps en dominio `performance.now()`, y al parar `clear()` + note-off explícito por nota activa + CC 123/120 (muchos VSTs ignoran los CCs de modo). Sin puerto seleccionado no hace nada. |
| `js/visualizer.js` | `Visualizer` | Piano roll en canvas (offscreen + blit), cursor con autoscroll, colores por motivo (`MOTIF_COLORS` y `midiRange`, compartidos con la vista 3D). Lienzo HiDPI con el dpr acotado para no pasar los límites de tamaño de canvas en piezas largas; el cursor solo repinta su columna desde el offscreen, así que cualquier cambio de la pieza exige `renderPiece` completo (en `App`, `vizRefresh` lo hace y repone el cursor). |
| `js/visualizer3d.js` | `Visualizer3D` | Vistas 3D con THREE.js, cuatro modos que comparten renderer, bloom, cursor y seguimiento de cámara: «city» (ciudad de notas: bloques instanciados, tiempo en X, pistas en Z, altura en Y), «tunnel» (túnel helicoidal: una vuelta = una célula, cada pista un anillo concéntrico, cámara interior; «Encuadrar» alterna interior/exterior), «terrain» (heightfield continuo con crestas por pista, biomas por motivo y frente de onda luminoso en el shader) y «stars» (cada nota una estrella con flare y onda expansiva al sonar, bloques enlazados como constelaciones, secciones como nebulosas). Misma interfaz que `Visualizer` más `setMode`; `App` conmuta con el selector «Vista» del topbar (persistido) y despacha a la vista activa (`viz()`/`vizRender`). Módulo ESM (los addons de THREE no existen como script clásico): se carga con `<script type="module">` y publica `window.Visualizer3D`. El render (con bloom a resolución reducida) baja a ~30 fps en reposo y vuelve a plena tasa con `dirty`, cursor en marcha o cámara en movimiento: todo cambio de estado visible fuera de `tick` debe poner `dirty = true`. |
| `js/generator.js` | `Generator` | Material musical: célula madre con contorno orgánico, variaciones (invertir, rotar, retrogradar…), formas, escalas, grados→MIDI. |
| `js/humanizer.js` | `Humanizer` | Pase de humanización sobre el `grid` compuesto: mutación de repeticiones, notas de paso, articulación contextual, arcos de dinámica y respiraciones. Sin efecto sobre el tempo. |
| `js/energy.js` | `Energy` | Pase determinista de balance de energía entre pistas: por ventanas de una célula cuenta ataques audibles (velocity > `GHOST_VELOCITY`) frente a un presupuesto que sigue un arco con clímax hacia el 65% de la pieza; si se excede, las pistas de fondo (menos salientes por velocity y agudeza, medidas solo sobre sus notas protegidas para que el pase sea idempotente) ceden en ronda sus notas más débiles y la nota anterior se alarga hacia el hueco. Nunca toca el primer plano, tiempos fuertes, la primera pasada ni la última nota de cada bloque, ni la pista de recapitulación. Solo borra celdas y sube sustain; no toca grados ni midi. |
| `js/counterpoint.js` | `Counterpoint` | Pase determinista de consonancia vertical entre pistas: resuelve disonancias duras (segundas, séptimas, tritono) moviendo ±1 grado, apagando o acortando notas; abre unísonos a la octava. Tolera notas de paso en tiempo débil. |
| `js/composer.js` | `Composer` | Composición lineal de la pieza (secciones, bloques por pista, recapitulación) y transporte de reproducción. `planDuration` traduce una duración objetivo en pasos a largo de célula y repeticiones por letra. Llama a `Humanizer.humanize`, `Energy.balance` y `Counterpoint.enforce`, en ese orden, antes de calcular duraciones. Cada nota se despacha a la vez a `AudioEngine.playNote` y `MidiEngine.playNote`; cada motor decide si suena. |
| `js/app.js` | `App` | UI: topbar, barra de la pieza (tonalidad, forma, tiempo y secciones clicables que saltan con `Composer.seek`), panel de pistas tipo mezclador, estado persistente por pista, orquestación generar/play/stop. Transporte: ▶ alterna reproducir/pausa (también Espacio), ■ para y rebobina; F alterna pantalla completa. Encadenado de piezas (Auto-generar / Auto-reinicio) con un respiro de `PIECE_GAP_MS` y modo kiosco (ver abajo). |

Flujo de una generación (`App.generate`):
sorteo de pistas/duración/tempo si tienen «azar» → forma (`generateForm`) →
plan de duración (`Composer.planDuration`: largo de célula y repeticiones) →
célula madre (`Generator.generateMotherCell`) → motivos (`generateMotifs`) →
pieza (`Composer.compose`: rejilla de bloques →
`Humanizer` → `Energy` → `Counterpoint` → duraciones y `stepEvents`) → render
(`Visualizer.renderPiece`) + configuración de pistas (`AudioEngine.setupTracks`).

## Modelo de datos

- **Paso de célula**: `{ note: bool, degree: entero, velocity: 0..1, sustain: 0.25..1 }`.
  El sustain sale de una onda lenta de legato por célula (tramos ligados y
  tramos picados), no de un sorteo por nota.
  El ritmo avanza por **valores de nota** (1/2/3/4/6/8 pasos, `NOTE_VALUES`):
  cada ataque o silencio ocupa un valor entero sorteado con pesos que
  interpola la onda de respiración (frase activa → valores cortos, reposo →
  largos), en vez de sortear nota sí/no en cada paso. Así los huecos entre
  ataques varían y la duración final (`sustain × hueco`, en `Composer`) da
  también notas tenidas, no solo semicorcheas. Los valores que dejan el
  siguiente ataque en tiempo (paso múltiplo de 4) pesan `BEAT_PULL` veces más,
  para que el ritmo vuelva al pulso tras una síncopa, y la velocity lleva un
  acento métrico leve en tiempo y cabeza de compás. Las variaciones preservan
  esa alineación: `rotate` solo gira por tiempos enteros (múltiplos de 4).
  `degree` es un **grado de escala** (no semitonos) en [-7, 7]; la octava sale de
  dividir por el largo de la escala. Solo se convierte a MIDI en
  `Generator.degreeToMidi`.
- **Célula**: array de pasos; largo siempre potencia de 2 (16/32/64).
  Toda célula (madre y variaciones) lleva `cell.contour` con el nombre del
  algoritmo de contorno de sus alturas.
- **Motivos**: `motifs[0]` es siempre la célula madre; siguen 2+ variaciones.
  Una variación puede (prob. 0.4, `recontour`) redibujar sus alturas con otro
  algoritmo de contorno distinto al de la madre, conservando ritmo, dinámica y
  sustain. El transporte de una variación solo elige desplazamientos que
  mantienen sus notas en [-7, 7] y la máscara final se recorta al rango
  (invariante 3).
- **Contornos permitidos**: el multiselect de contorno del topbar restringe el
  sorteo (madre y `recontour`) a los marcados (`resolveContourPool` acepta
  nombre, lista o nada); sin ninguno marcado se sortea entre todos, y con uno
  solo las variaciones nunca cambian de algoritmo.
- **Duración en minutos**: el slider Duración (1–20) es una duración objetivo
  al tempo con que se genera (`minutos × bpm × 4` pasos). `planDuration`
  prueba cada largo de célula con repeticiones base/2, base y base×2 por letra,
  y sortea entre los planes con un error relativo de hasta `DURATION_TOLERANCE`
  por encima del mejor. Prefiere los que no pasan de `REPEAT_SOFT_CAP`
  repeticiones por sección y, si no hay ninguno, los de célula más larga. Todo
  sigue siendo potencia de 2, así que la duración real se desvía hasta un ~10%.
  Sin `repeatsByLetter`, `compose` sortea repeticiones como antes
  (`SECTION_REPEAT_CHOICES`).
- **Pistas, duración y tempo al azar**: en el diálogo Generación cada uno
  tiene un interruptor «azar» con un rango mín–máx (`RANDOM_RANGES` en
  `app.js`, rango doble de dos sliders superpuestos). Se sortean en
  `App.generate`, una vez por pieza, de modo que con Auto-generar cada pieza
  del modo kiosco sale distinta. El número de pistas se lee después de
  `piece.numTracks`, no del slider; el tempo sorteado se escribe en el slider
  del topbar.
- **Encadenado y modo kiosco** (`app.js`): al terminar una pieza, si toca
  regenerar se compone la siguiente en el acto, para que las pistas salientes
  se desvanezcan durante el respiro, y suena tras `PIECE_GAP_MS`; parar o
  pausar cancela el arranque pendiente. El interruptor «Modo kiosco» (diálogo
  Salida, persistido) hace lo siguiente:
  - nunca deja la música parada: regenera aunque Auto-generar esté apagado,
    salvo con Auto-reinicio;
  - mantiene la pantalla encendida con Wake Lock, que vuelve a pedir al
    hacerse visible la pestaña;
  - oculta la interfaz (`body.ui-idle`) tras `IDLE_MS` sin actividad mientras
    suena. Los `pointermove` sin desplazamiento no cuentan;
  - al cargar intenta sonar sin gesto (`kioskBoot`). Si el navegador lo
    bloquea, muestra «Toca para comenzar» y el primer gesto en cualquier parte
    arranca el audio y pide pantalla completa.

  Activarlo con un clic real entra en el acto (pantalla completa + play);
  restaurarlo al cargar no, porque esos eventos no son de confianza.
- **Escala y tonalidad aleatorias**: los selectores del topbar tienen la
  opción «Aleatoria» (`random`), que se sortea en cada generación con
  `Generator.resolveScale` (entre `RANDOM_SCALES`, sin la cromática) y
  `Generator.resolveKey`; la opción muestra lo que suena, p. ej. «Aleatoria
  (Doria)». Lo resuelto vive en `piece.scale`/`piece.key`: `compose` siempre
  recibe valores concretos, y elegir «Aleatoria» no re-afina la pieza en curso.
- **Pieza** (`Composer.compose`): `{ sections, totalSteps, grid, stepEvents,
  blockMarkers, numTracks, cellLength, scale, key, contour }`.
  `grid[pista][paso]` (celda `{ midi, degree, keyOffset, velocity, sustain,
  motifIndex, durationSteps }` o `null`) para el visualizador;
  `stepEvents[paso]` para el transporte: lista de `{ trackIndex, cell }` donde
  `cell` es **la misma celda del `grid`** (referencia, no copia), así que
  cualquier cambio en el grid (p. ej. `retune`) se ve al reproducir.
- **Utilidades compartidas** en `Generator` (carga antes que los pases):
  `GHOST_VELOCITY` (0.18, umbral de nota fantasma usado por composer, energy y
  counterpoint), `MAX_SUSTAIN_STEPS` (16, tope de hueco en duraciones de
  composer y counterpoint), `buildBlockMap(ctx)` y `sectionAt(ctx, paso)`.
- **Plan tonal (modulación por quintas)**: la pieza sigue un **arco compuesto
  de antemano** sobre el ciclo de quintas, calculado en `compose` a partir de
  la forma. Se sortea un sentido por pieza (bemoles más probable en escalas
  menor y dórica, sostenidos en las demás) y una lejanía máxima `peak` en
  [1, min(4, ⌊(S−1)/2⌋)] con S secciones; el desplazamiento de la sección i es
  `dir × min(i, S−1−i, peak)` quintas: sale de la tónica, se aleja una quinta
  por sección hasta el clímax, se sostiene y regresa, **terminando siempre en
  la tonalidad base**. Las modulaciones solo caen en **fronteras de sección**,
  nunca en medio de un bloque. Cada sección guarda `fifthOffset` (quintas con
  signo) y `keyOffset` (semitonos mod 12, posibles {0, 2, 3, 4, 5, 7, 8, 9,
  10}); cada nota del `grid` copia el `keyOffset` de su sección
  para que `retune` pueda re-mapear sin perderlo. La modulación es **suave**
  (`Generator.degreeToMidiInKey`): la nota se calcula en la tonalidad base y
  solo se altera ±1 semitono si no pertenece a la escala transportada,
  siguiendo la armadura — sube hacia el lado de los sostenidos, baja hacia el
  de los bemoles, con lo que dos grados nunca colapsan en la misma altura —
  conserva alturas, no transpone; la cromática es insensible.

## Invariantes (no romper)

1. **Potencias de 2 en todas partes**: largos de célula, repeticiones de sección,
   particiones de bloques (`partitionRepeats` bisecciona). El algoritmo
   `fractal` y `subsequence` dependen de esto.
2. **Dos pistas nunca tocan el mismo motivo a la vez** dentro de una sección
   (`slotUsage` en `composer.js`). Antes que duplicar, una pista calla.
3. **`degree` siempre entero en [-7, 7]** al salir del generador; los contornos
   crudos son floats y se normalizan en `normalizeContour`.
4. **Una instancia de sinte por pista**: los sintes monofónicos de Tone fallan al
   retriggerar si se comparten. `AudioEngine.setupTracks` crea y desecha
   instancias; nunca reutilizar un sinte entre pistas.
5. **Sin superposición dentro de una pista**: la duración de cada nota se recorta
   al hueco hasta la siguiente nota (legato como máximo, factor 0.95 al disparar).
6. **`retune` no regenera**: cambiar escala/tonalidad re-mapea los `degree`
   guardados a MIDI en la pieza existente, incluso durante la reproducción. Por
   eso cada celda del `grid` conserva `degree` y `keyOffset` junto a `midi`;
   `retune` solo recorre el `grid` y `stepEvents` lo ve porque referencia esas
   mismas celdas (no copiar campos de la celda en los eventos).
7. **Misma letra de forma = mismo material**: las secciones "A" comparten spec
   (`specByLetter`); no re-sortear por aparición. La tonalidad sí puede diferir
   entre apariciones (depende de la posición en la pieza, no de la letra). El
   humanizador introduce diferencias de superficie entre apariciones (notas
   caídas, adornos, respiraciones): es deliberado, el spec sigue compartido.
8. **El tempo es único por pieza y solo lo cambia el usuario** (slider en
   tiempo real). La única excepción es el «azar» de tempo, que `App.generate`
   sortea una vez al generar y escribe en ese mismo slider, antes de que suene
   la pieza. Ningún pase generativo o de humanización debe tocar
   `Transport.bpm` ni desplazar notas en el tiempo (nada de rubato, swing ni
   micro-timing).
9. **La humanización trabaja en grados, nunca en MIDI directo**: toda nota que
   `Humanizer` añade o altera escribe `degree`/`keyOffset` y deriva `midi` de
   ellos, para que `retune` siga funcionando. Conserva el `motifIndex` del
   bloque (invariante 2) y corre antes del cálculo de duraciones (invariante 5).
   Las notas insertadas (mordentes, notas de paso) copian el `keyOffset` de su
   nota ancla: si el adorno cae junto a una frontera de sección puede llevar el
   `keyOffset` de la sección vecina — es deliberado (el adorno decora su
   contexto armónico inmediato) y no rompe la equivalencia
   `midi === degreeToMidiInKey(...)`; el plan tonal de referencia vive en
   `section.fifthOffset`, no hace falta reconstruirlo de las notas.
10. **El contrapunto es determinista y acotado**: `Counterpoint.enforce` no usa
   azar (misma entrada → mismas correcciones, así la recapitulación sigue
   literal), no añade, quita ni desplaza notas en el tiempo (los huecos entre
   notas no cambian), trabaja en grados como el humanizador, e ignora las notas
   casi inaudibles (velocity ≤ `GHOST_VELOCITY`, 0.18). Garantiza: en tiempo fuerte (paso múltiplo
   de 4) ninguna pareja de notas audibles simultáneas es disonante dura. La
   clasificación por distancia de grados es estable frente a `retune` entre
   escalas del mismo largo; el chequeo de tritono (semitonos) puede variar tras
   un retune en vivo — se acepta.
11. **`Tone.start()` requiere gesto del usuario**: se llama desde Play
   (`AudioEngine.init`). La única excepción es el arranque del modo kiosco,
   que lo intenta al cargar sin esperar respuesta y comprueba
   `AudioEngine.isRunning()`. Solo funciona si la política de autoplay lo
   permite; si no, espera el primer gesto.

## Convenciones

- Comentarios y textos de UI en **español**; nombres de código en inglés.
- Estética «instrumento»: los colores y tipografías viven como tokens en
  `:root` de `css/style.css` (negro casi neutro, un único acento ámbar
  `--accent` para lo accionable/activo y la recapitulación, rojo `--live` solo
  para el cursor; Inter para texto, JetBrains Mono para cifras y etiquetas).
  No escribir colores sueltos en el CSS; los lienzos (`visualizer.js`,
  `visualizer3d.js`) repiten esos valores en constantes propias. Los sliders
  pintan su tramo activo con `--from`/`--to`, que sincroniza `App` en cada
  `input` y al crearse (bipolar si el mínimo es negativo).
- Comentarios solo para restricciones no evidentes en el código (estilo actual).
- Aleatoriedad vía `Math.random()` directo y `Generator.pickRandom`; no hay
  semilla/seed (si se añade, centralizar el RNG).
- Los ajustes por pista (`state.trackSettings` en `app.js`) **persisten entre
  generaciones**; los presets sorteados se conservan hasta que el usuario
  re-elige "Aleatorio".
- La edición en vivo del editor de sintes vive en `trackSettings.edited`
  (definición completa) y tiene prioridad sobre `preset` al configurar el
  motor; elegir cualquier preset en el selector de la pista la descarta.
- Commits en inglés, formato `Tipo: descripción` (ver `git log`).

## Extensiones frecuentes

- Nuevo algoritmo de contorno melódico → skill `add-contour`.
- Nuevo preset de instrumento o nueva escala → skill `add-instrument-or-scale`.
- Probar cambios de generación sin navegador → skill `test-generator`.
- Levantar y ver la app → skill `run-app`.
