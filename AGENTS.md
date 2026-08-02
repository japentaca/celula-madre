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

Ocho módulos IIFE que exponen un objeto global cada uno. El orden de carga en
`index.html` importa (no hay imports):

| Módulo | Global | Responsabilidad |
|---|---|---|
| `js/audio.js` | `AudioEngine` | Grafo de audio Tone.js: presets de sintes (nombre de fábrica o definición `{ base, params, chain }`), una instancia por pista, cadena de efectos de inserción por pista (sinte→fx→panner), envíos a reverb/delay, paneo, master. Se puede deshabilitar desde el topbar (checkbox Audio) sin parar el Transport. |
| `js/syntheditor.js` | `SynthEditor` | Editor modal por pista: esquemas declarativos de parámetros por tipo de sinte, cadena de efectos (catálogo curado, reordenable), edición en vivo vía `AudioEngine`, presets de usuario en localStorage (`binario.userPresets`, id `user:Nombre`) con export/import JSON. Comunica cambios a `App` por callbacks (`trackSettings.edited`). |
| `js/midi.js` | `MidiEngine` | Salida Web MIDI hacia VSTs/hardware: puerto global (topbar), canal 1-16 por pista (strip), note-on/off con timestamps en dominio `performance.now()`, y al parar `clear()` + note-off explícito por nota activa + CC 123/120 (muchos VSTs ignoran los CCs de modo). Sin puerto seleccionado no hace nada. |
| `js/visualizer.js` | `Visualizer` | Piano roll en canvas (offscreen + blit), cursor con autoscroll, colores por motivo (`MOTIF_COLORS`, compartidos con la vista 3D). |
| `js/visualizer3d.js` | `Visualizer3D` | Vistas 3D con THREE.js, cuatro modos que comparten renderer, bloom, cursor y seguimiento de cámara: «city» (ciudad de notas: bloques instanciados, tiempo en X, pistas en Z, altura en Y), «tunnel» (túnel helicoidal: una vuelta = una célula, cada pista un anillo concéntrico, cámara interior; «Encuadrar» alterna interior/exterior), «terrain» (heightfield continuo con crestas por pista, biomas por motivo y frente de onda luminoso en el shader) y «stars» (cada nota una estrella con flare y onda expansiva al sonar, bloques enlazados como constelaciones, secciones como nebulosas). Misma interfaz que `Visualizer` más `setMode`; `App` conmuta con el selector «Vista» del topbar (persistido) y despacha a la vista activa (`viz()`/`vizRender`). Módulo ESM (los addons de THREE no existen como script clásico): se carga con `<script type="module">` y publica `window.Visualizer3D`. |
| `js/generator.js` | `Generator` | Material musical: célula madre con contorno orgánico, variaciones (invertir, rotar, retrogradar…), formas, escalas, grados→MIDI. |
| `js/humanizer.js` | `Humanizer` | Pase de humanización sobre el `grid` compuesto: mutación de repeticiones, notas de paso, articulación contextual, arcos de dinámica y respiraciones. Sin efecto sobre el tempo. |
| `js/counterpoint.js` | `Counterpoint` | Pase determinista de consonancia vertical entre pistas: resuelve disonancias duras (segundas, séptimas, tritono) moviendo ±1 grado, apagando o acortando notas; abre unísonos a la octava. Tolera notas de paso en tiempo débil. |
| `js/composer.js` | `Composer` | Composición lineal de la pieza (secciones, bloques por pista, recapitulación) y transporte de reproducción. Llama a `Humanizer.humanize` y luego `Counterpoint.enforce` antes de calcular duraciones. Cada nota se despacha a la vez a `AudioEngine.playNote` y `MidiEngine.playNote`; cada motor decide si suena. |
| `js/app.js` | `App` | UI: topbar, panel de pistas, estado persistente por pista, orquestación generar/play/stop. |

Flujo de una generación (`App.generate`):
célula madre (`Generator.generateMotherCell`) → motivos (`generateMotifs`) →
forma (`generateForm`) → pieza (`Composer.compose`) → render
(`Visualizer.renderPiece`) + configuración de pistas (`AudioEngine.setupTracks`).

## Modelo de datos

- **Paso de célula**: `{ note: bool, degree: entero, velocity: 0..1, sustain: 0.25..1 }`.
  El sustain sale de una onda lenta de legato por célula (tramos ligados y
  tramos picados), no de un sorteo por nota.
  `degree` es un **grado de escala** (no semitonos) en [-7, 7]; la octava sale de
  dividir por el largo de la escala. Solo se convierte a MIDI en
  `Generator.degreeToMidi`.
- **Célula**: array de pasos; largo siempre potencia de 2 (16/32/64).
  Toda célula (madre y variaciones) lleva `cell.contour` con el nombre del
  algoritmo de contorno de sus alturas.
- **Motivos**: `motifs[0]` es siempre la célula madre; siguen 2+ variaciones.
  Una variación puede (prob. 0.4, `recontour`) redibujar sus alturas con otro
  algoritmo de contorno distinto al de la madre, conservando ritmo, dinámica y
  sustain.
- **Contornos permitidos**: el multiselect de contorno del topbar restringe el
  sorteo (madre y `recontour`) a los marcados (`resolveContourPool` acepta
  nombre, lista o nada); sin ninguno marcado se sortea entre todos, y con uno
  solo las variaciones nunca cambian de algoritmo.
- **Pieza** (`Composer.compose`): `{ sections, totalSteps, grid, stepEvents,
  blockMarkers, numTracks, cellLength, scale, key, fifthSteps, contour }`.
  `grid[pista][paso]` para el visualizador; `stepEvents[paso]` para el transporte.
- **Modulación por quintas**: cada `fifthSteps` (4/8/16/32) **semicorcheas**
  (pasos del grid, la unidad de tiempo real de la pieza) desde el inicio, el
  viaje por el ciclo de quintas da un paso aleatorio de ±1 quinta (+7/−7
  semitonos), hacia adelante o hacia atrás, rebotando en el borde. Es
  independiente del tamaño de célula y de las repeticiones: el cambio puede caer
  en medio de una sección. El viaje está **acotado a ±4 pasos** desde la
  tonalidad base (`MAX_FIFTH_STEPS` en `composer.js`); los `keyOffset` posibles
  son {0, 2, 3, 4, 5, 7, 8, 9, 10} (mod 12). Cada nota de `grid` y
  `stepEvents` lo copia para que `retune` pueda re-mapear sin perderlo. La
  modulación es **suave** (`Generator.degreeToMidiInKey`): la nota se calcula en
  la tonalidad base y solo se altera ±1 semitono si no pertenece a la escala
  transportada, siguiendo la armadura — sube hacia el lado de los sostenidos,
  baja hacia el de los bemoles, con lo que dos grados nunca colapsan en la
  misma altura — conserva alturas, no transpone; la cromática es insensible.

## Invariantes (no romper)

1. **Potencias de 2 en todas partes**: largos de célula, repeticiones de sección,
   particiones de bloques (`partitionRepeats` bisecciona), pasos de quintas
   (4/8/16/32). El algoritmo `fractal` y `subsequence` dependen de esto.
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
   eso `grid` y `stepEvents` conservan `degree` y `keyOffset` junto a `midi`.
7. **Misma letra de forma = mismo material**: las secciones "A" comparten spec
   (`specByLetter`); no re-sortear por aparición. La tonalidad sí puede diferir
   entre apariciones (depende de la posición en la pieza, no de la letra). El
   humanizador introduce diferencias de superficie entre apariciones (notas
   caídas, adornos, respiraciones): es deliberado, el spec sigue compartido.
8. **El tempo es único y solo lo cambia el usuario** (slider en tiempo real).
   Ningún pase generativo o de humanización debe tocar `Transport.bpm` ni
   desplazar notas en el tiempo (nada de rubato, swing ni micro-timing).
9. **La humanización trabaja en grados, nunca en MIDI directo**: toda nota que
   `Humanizer` añade o altera escribe `degree`/`keyOffset` y deriva `midi` de
   ellos, para que `retune` siga funcionando. Conserva el `motifIndex` del
   bloque (invariante 2) y corre antes del cálculo de duraciones (invariante 5).
   Las notas insertadas (mordentes, notas de paso) copian el `keyOffset` de su
   nota ancla: si el adorno cae junto a un límite de tramo de `fifthSteps`
   pasos puede llevar el `keyOffset` del tramo vecino — es deliberado (el
   adorno decora su contexto armónico inmediato) y no rompe la equivalencia
   `midi === degreeToMidiInKey(...)`; solo significa que la caminata de
   quintas no se puede reconstruir de la pieza final, ver skill
   `test-generator`.
10. **El contrapunto es determinista y acotado**: `Counterpoint.enforce` no usa
   azar (misma entrada → mismas correcciones, así la recapitulación sigue
   literal), no añade, quita ni desplaza notas en el tiempo (los huecos entre
   notas no cambian), trabaja en grados como el humanizador, e ignora las notas
   casi inaudibles (velocity ≤ 0.18). Garantiza: en tiempo fuerte (paso múltiplo
   de 4) ninguna pareja de notas audibles simultáneas es disonante dura. La
   clasificación por distancia de grados es estable frente a `retune` entre
   escalas del mismo largo; el chequeo de tritono (semitonos) puede variar tras
   un retune en vivo — se acepta.
8. **`Tone.start()` requiere gesto del usuario**: solo se llama desde Play
   (`AudioEngine.init`).

## Convenciones

- Comentarios y textos de UI en **español**; nombres de código en inglés.
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
