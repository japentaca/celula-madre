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

Doce módulos IIFE (scripts clásicos) más uno ESM (`visualizer3d.js`), cada uno
expone un objeto global. El orden de carga en `index.html` importa (no hay
imports; `generator.js` va antes que los pases porque comparte utilidades,
`form.js` justo después — lo leen el compositor y los pases — y `harmony.js`
tras él, antes de `humanizer.js`, que usa su acorde final):

| Módulo | Global | Responsabilidad |
|---|---|---|
| `js/audio.js` | `AudioEngine` | Grafo de audio Tone.js: presets de sintes (nombre de fábrica o definición `{ base, params, chain }`), una instancia por pista, cadena de efectos de inserción por pista (sinte→fx→panner→canal), envíos **post-fader** a reverb/delay (cuelgan del canal: el volumen de la pista escala también su efecto), paneo, master. Se puede deshabilitar desde el topbar (checkbox Audio) sin parar el Transport. `setupTracks` no desecha en seco las pistas de la pieza anterior: las desvanece (`RETIRE_FADE`, 4 s) para no cortar colas de release ni notas en vuelo, y las desecha después. |
| `js/syntheditor.js` | `SynthEditor` | Editor modal por pista: esquemas declarativos de parámetros por tipo de sinte, cadena de efectos (catálogo curado, reordenable), edición en vivo vía `AudioEngine`, presets de usuario en localStorage (`binario.userPresets`, id `user:Nombre`) con export/import JSON. Comunica cambios a `App` por callbacks (`trackSettings.edited`). |
| `js/midi.js` | `MidiEngine` | Salida Web MIDI hacia VSTs/hardware: puerto global (topbar), canal 1-16 por pista (strip), note-on/off con timestamps en dominio `performance.now()`, y al parar `clear()` + note-off explícito por nota activa + CC 123/120 (muchos VSTs ignoran los CCs de modo). Sin puerto seleccionado no hace nada. El puerto **no se persiste**: hay que elegirlo en cada carga (recargar con un puerto abierto, p. ej. loopMIDI, llega a colgar Chrome entero en Windows), y por eso la casilla Audio tampoco se restaura y arranca siempre encendida. Reloj MIDI (casilla «Reloj MIDI» del diálogo Salida, `midiClock` en `binario.settings`, activa por defecto): `0xF8` 24 por negra con `Transport.scheduleRepeat` cada `PPQ/24` ticks, cada uno con el timestamp de su tiempo de audio (los cambios de tempo salen solos); `Composer.play` llama `startClock(paso)` antes de dar de alta las notas (start en el paso 0, song position + continue al reanudar) y `Composer.stop` llama `stopClock` (stop). En el respiro entre piezas encadenadas `keepClockAlive` sigue mandando `0xF8` en reposo (sin start) para que el receptor no pierda el tempo; `cancelNextPiece` lo corta. Si el reposo sonaba, `startClock` devuelve un instante alineado a su rejilla y `Composer.play` arranca ahí el Transport (menos de un tick después), así el primer tick de la pieza no deja un hueco que el receptor mida como bajón de tempo. Las notas salen 1 ms después del start/continue de su mismo instante (con igual timestamp el receptor llegó a ver la nota antes del start). Cambiar de salida o apagar la casilla manda stop por la salida vieja. `toMidiTimestamp` toma la correspondencia audio → `performance.now()` de `getOutputTimestamp()` del AudioContext nativo (`rawContext._nativeAudioContext`; si falta, `performance.now()` − `currentTime`), suavizada (τ 4 s) y menos la latencia de salida (`outputLatency + baseLatency`, fija desde cada reinicio), así el MIDI sale cuando Tone programa el audio, sin el atraso de ~55 ms: restar `currentTime`, que avanza a saltos de buffer, hacía bailar el reloj ±1,5 BPM. |
| `js/visualizer.js` | `Visualizer` | Piano roll en canvas (offscreen + blit), cursor con autoscroll, colores por motivo (`MOTIF_COLORS` y `midiRange`, compartidos con la vista 3D). Lienzo HiDPI con el dpr acotado para no pasar los límites de tamaño de canvas en piezas largas; el cursor solo repinta su columna desde el offscreen, así que cualquier cambio de la pieza exige `renderPiece` completo (en `App`, `vizRefresh` lo hace y repone el cursor). |
| `js/visualizer3d.js` | `Visualizer3D` | Vistas 3D con THREE.js, trece modos que comparten renderer, cursor y seguimiento de cámara: «city» (ciudad de notas: bloques instanciados, tiempo en X, pistas en Z, altura en Y), «tunnel» (túnel helicoidal: una vuelta = una célula, cada pista un anillo concéntrico, cámara interior; «Encuadrar» alterna interior/exterior), «terrain» (heightfield continuo con crestas por pista, biomas por motivo y frente de onda luminoso en el shader), «stars» (cada nota una estrella con flare y onda expansiva al sonar, bloques enlazados como constelaciones, secciones como nebulosas) y «musicbox» (caja de música: un rodillo metálico por pista que gira una vuelta por célula, un pino por nota cuyo giro se aplica en el shader, y un peine cuya púa vibra y brilla al pasar el pino; la pieza entera se extiende a lo largo del rodillo, con anillos por sección y un aro ámbar que avanza señalando por dónde va) y «fifths» (órbita de quintas: el plan tonal hecho visible — doce faros en círculo son el ciclo de quintas, con nombre de tonalidad, los visitados encendidos y la tónica ámbar; cada sección es una órbita de anillos concéntricos por pista alrededor del faro de su `fifthOffset` (la tónica local; las regiones en otro modo — relativo, homónimo — lo indican en la etiqueta de sección), las que repiten faro a radios crecientes, con estelas entre secciones consecutivas; las notas fuera de la armadura base o con `alter` se vuelcan hacia fuera y brillan; el cursor es una nave que recorre las órbitas, enciende el faro de la sección en curso y arrastra la cámara con «Seguir») y «pianola» (rollo de pianola: papel perforado tumbado con una banda por pista, cada nota un agujero oscuro cuyo largo es su duración y su columna la altura, marcas cada 4 pasos y fronteras de sección impresas; el cursor es el lector entero — rodillo metálico bajo el papel y lámpara encima — que recorre el rollo: cada agujero se enciende mientras la luz lo atraviesa, lo que exige la duración real del paso, medida en `setCursor` entre pasos consecutivos, y proyecta una mancha de su color en el suelo, ampliada desde el eje del papel para que caiga fuera de él y se vea) y «loom» (telar: cada pista un hilo de urdimbre tenso a lo largo del tiempo, una cinta de geometría única que sube y baja con la altura y en los silencios cae hacia la línea base; la onda de legato se ve como continuidad del hilo — tras una nota de sustain alto sigue liso y a ancho pleno hacia la siguiente, tras una de sustain bajo se estrecha a una puntada —, cada ataque un nudo sobre el hilo, cada bloque una trama translúcida del color de su motivo en el plano del hilo, travesaños metálicos arriba y abajo y peines en las fronteras de sección; el cursor es la lanzadera que cruza todos los hilos y un brillo que recorre cada uno desde `uCursorX`, como en el terreno) y «strings» (arpa: una cuerda horizontal fija por pista entre dos columnas metálicas, sin eje de tiempo; cada nota la pulsa y la vibración — onda estacionaria con amplitud por velocity, nodos por altura y decaimiento por sustain, del color del motivo — se calcula entera en el vertex shader desde arrays de uniforms por pista que estampa `setCursor`, sin `buildNotes` ni `hitIndex`; solo se ve lo que suena, ideal para kiosco; una regla de tiempo bajo las cuerdas, con marcas por célula, fronteras y etiquetas de sección, lleva un aro ámbar como cursor y la cámara no sigue) y «galaxy» (galaxia: vista cenital-oblicua de la pieza entera enrollada en una espiral de Arquímedes en el plano XZ — radio = tiempo, una vuelta = una célula, o varias si la pieza es tan larga que el radio pasaría de `G_RMAX` —, cada pista una sub-espira desplazada radialmente, cada nota una estrella (shader de la constelación más `aStep`/`uCursorStep`: lo ya sonado tira a ámbar, lo por venir a azul frío y tenue) con su onda expansiva, las secciones como anillos planos de distinta densidad y un núcleo que late; el cursor es un brazo de radar que barre desde el centro hasta el radio del paso y la cámara no sigue: el clímax de `Energy` se ve como la zona más poblada), «garden» (jardín: tiempo en X, hileras por pista en Z con un desorden determinista por paso dentro de la célula — las repeticiones de célula son hileras idénticas —; cada nota una flor de tres `InstancedMesh` que comparten índices, `iHit`, `iX` e `iAmber` — tallo de largo según la altura, corola de tamaño según la velocity y forma según el motivo (campana, botón o anillo de pétalos; las otras formas a escala 0), hoja tendida cuyo largo es la duración —; el vertex shader hace brotar cada flor desde su base al llegar `uCursorX` (lo por venir son muñones de semilla, con el cursor oculto todo florece) y el fragment la marchita un 25 % en 20 s desde su disparo; secciones como parterres con bordillo, la recapitulación teñida de ámbar, y una regadera de luz cálida como cursor), «swarm» (enjambre, el único modo con simulación viva por CPU en cada frame: una bandada de boids por pista en un único `Points` con estelas; vuela hacia un objetivo cuya altitud es la altura de su última nota y cuya X avanza con la pieza, se compacta con la densidad reciente de ataques audibles y se dispersa en el silencio, cada ataque la empuja hacia fuera y la hace destellar, toma el color del motivo en curso y el ámbar en la pista que recapitula; regla de tiempo con secciones en el suelo y etiquetas de pista que siguen a su bandada; con el cursor oculto sigue volando a la tasa de reposo) y «mobius» (cinta de Möbius: la pieza entera impresa en una sola vuelta de la cinta — media torsión, así que al terminar se vuelve al mismo punto por la otra cara, como el plan tonal vuelve a la tónica —, pistas repartidas a lo ancho y la altura tonal desplazando la nota dentro de su carril; cada nota una caja de pie orientada con la base local (tangente, normal y binormal por derivadas numéricas de la parametrización) para seguir la torsión, cinta de geometría única con franjas por sección (ámbar en la recapitulación), carriles y fronteras como líneas coplanarias y un resplandor alrededor del cursor por distancia angular en `u`, que en la costura une el final con el principio; el cursor es un aro que atraviesa la cinta; con «Seguir» la cámara va en raíl sobre la cara actual — a diferencia de los modos axiales no conserva el ángulo del usuario — y «Encuadrar» alterna en raíl/vista general). Misma interfaz que `Visualizer` más `setMode`; sin postproceso (se quitó el bloom: tapaba las notas), se renderiza directo con `renderer.render`; `App` conmuta con el selector «Vista» del topbar (persistido) y despacha a la vista activa (`viz()`/`vizRender`). Módulo ESM (los addons de THREE no existen como script clásico): se carga con `<script type="module">` y publica `window.Visualizer3D`. El render baja a ~30 fps en reposo y vuelve a plena tasa con `dirty`, cursor en marcha o cámara en movimiento: todo cambio de estado visible fuera de `tick` debe poner `dirty = true`. |
| `js/generator.js` | `Generator` | Material musical: célula madre con contorno orgánico, variaciones (invertir, rotar, retrogradar…), formas, escalas, grados→MIDI. Regiones tonales (`MODE_RELATIONS`, `regionOf`) y `cellMidi`, la única derivación de `midi` de una celda (ver «Plan tonal»). |
| `js/form.js` | `FormPlan` | Plan formal de la pieza, calculado por `plan` al inicio de `Composer.compose`, con las secciones ya posicionadas y antes de repartir bloques (ver «Plan formal»): carácter por letra (arquetipo, registro, densidad, orquestación, nivel dinámico, preferencia de motivos), frases por sección con sus cadencias internas, sección y paso del clímax, vuelta de A (`returnIndex`), sección de recapitulación, retransición y el perfil de intensidad (`intensityAt`) del que derivan el presupuesto de `Energy` (`budgetAt`), la dinámica del humanizador (`levelAt`, `phraseArc`, `phraseAt`) y el arco tonal de `planTonality`. Usa azar al planificar; quien lo lee después es determinista. |
| `js/harmony.js` | `Harmony` | Plan armónico y pase de armonía. `plan` (en `compose`, antes de humanizar) sortea por letra de forma un ritmo armónico (un acorde cada `cellLength/4` o `/2` pasos, en [8, 32]) y una progresión en bucle de la familia del modo (`FAMILIES`: mayor, menor, dórica y mixolidia con tríadas por terceras sin disminuidas; pentatónica con I y vi tríadas y V, ii quintas vacías; la cromática no tiene plan), ponderando por cuánto encaja ya con la melodía de la primera aparición de la letra. Los grados de acorde son relativos a la **tónica local** de la sección (marco tonal `frameOf`: con modulación real los grados ya se cuentan desde ella y la familia es la del modo local — el relativo de una pieza mayor usa la menor —; con la suave, `localTonic`, el grado base cuya altura alterada cae en `key + keyOffset`), así que en una sección modulada I es su tonalidad. El bucle arranca en cada frase del plan formal (`section.phrases`) y cada frase cierra en cadencia (`applyCadence`): las internas según el plan (antecedente en semicadencia, consecuente en perfecta o rota V–vi, `FAMILIES[…].deceptive`), la última según lo que sigue: semicadencia (V) si sigue la misma tonalidad, preparación (pivote común + V/x de la siguiente, deletreada en el marco propio con `spellChord`) si la siguiente modula, perfecta (V–I) la última; antes de la recapitulación la dominante se prolonga toda la retransición (acordes `retrans`); en menor y dórica el V de cadencia lleva sensible. Las alteraciones de cada acorde (`chord.alters`) las escribe `spell` en `cell.alter` y las mantiene `setPitch`, la única forma en que los pases escriben alturas. `apply` (pase determinista tras `Energy` y antes de `Counterpoint`) mueve ±1 grado al acorde las notas audibles de cabeza de acorde y de medio compás (`s % 8 === 0`) y las de los demás tiempos salvo notas de paso y bordaduras, y baja a la fundamental la voz más grave que ataca en cada cabeza de acorde (y en cada medio compás de la retransición: pedal de dominante) si la tiene 1–2 grados por debajo; no toca fantasmas, notas `final` ni la pista de recapitulación. `refresh` re-describe el plan tras `retune` (traduce grados por función entre escalas de distinto largo; inactivo en cromática) y reescribe `cell.alter`; `chordMap` da el acorde por paso (cacheado por plan), `alterAt`/`midiAt`/`setPitch` la altura de una nota según el plan y `finalChord` el acorde de cierre. |
| `js/humanizer.js` | `Humanizer` | Pase de humanización sobre el `grid` compuesto: mutación de repeticiones, notas de paso, articulación contextual, dinámica (nivel del plan formal — carácter de la letra × perfil de intensidad × rampa de la retransición, `FormPlan.levelAt` — por un arco por frase y un eco en repeticiones impares), respiraciones antes de cada final de frase (más leves, sin tocar la pista que recapitula) y de sección, y final de pieza (`shapeEnding`: diminuendo en las últimas células y la última nota de cada pista posada en el acorde de cierre del plan armónico, `Harmony.finalChord` — la I; sin plan, la tríada de tónica —, la más tardía en la fundamental, ligada y marcada `cell.final`). Sin efecto sobre el tempo. |
| `js/energy.js` | `Energy` | Pase determinista de balance de energía entre pistas: por ventanas de una célula cuenta ataques audibles (velocity > `GHOST_VELOCITY`) frente a un presupuesto que sigue el perfil de intensidad del plan formal (`FormPlan.intensityAt`, máximo en el clímax) escalado por la densidad del carácter de la sección (`FormPlan.budgetAt`); si se excede, las pistas de fondo (menos salientes por velocity y agudeza, medidas solo sobre sus notas protegidas para que el pase sea idempotente) ceden en ronda sus notas más débiles y la nota anterior se alarga hacia el hueco. Nunca toca el primer plano, tiempos fuertes, la primera pasada ni la última nota de cada bloque, ni la pista de recapitulación. Solo borra celdas y sube sustain; no toca grados ni midi. |
| `js/counterpoint.js` | `Counterpoint` | Pase determinista de consonancia vertical entre pistas: resuelve disonancias duras (segundas, séptimas, tritono) moviendo ±1 grado, apagando o acortando notas; abre unísonos a la octava. Tolera notas de paso en tiempo débil. Con plan armónico consulta el acorde vigente (`Harmony.chordMap`): en tiempo fuerte acepta primero los tonos del acorde (cede la nota ajena) y al mover prefiere el grado que cae en el acorde; las notas `final` siempre se aceptan primero. |
| `js/composer.js` | `Composer` | Composición lineal de la pieza (secciones, bloques por pista, recapitulación) y transporte de reproducción. `planDuration` traduce una duración objetivo en pasos a largo de célula y repeticiones por letra. Posiciona las secciones, pide el plan formal (`FormPlan.plan`), reparte los bloques de cada letra según su carácter (`buildSectionSpec`: orquestación, silencios de bloque y motivos ponderados en `fillSpan`), coloca la recapitulación en `form.recapIndex`, traza el plan tonal (`planTonality`) según `opts.modulation` y el clímax formal, elige el registro de cada sección (`planRegister`), calcula el plan armónico (`Harmony.plan`) sobre la rejilla recién colocada, aplica sus alteraciones (`Harmony.spell`) y llama a `Humanizer.humanize`, `Energy.balance`, `Harmony.apply` y `Counterpoint.enforce`, en ese orden y con un mismo `ctx` (que lleva `harmony`), antes de calcular duraciones. `retune` re-describe las regiones (`describeRegion`) y llama a `Harmony.refresh` antes de derivar `midi`. Cada nota se despacha a la vez a `AudioEngine.playNote` y `MidiEngine.playNote`; cada motor decide si suena. Tras el último paso el transporte sigue una coda de `ENDING_TAIL_STEPS` pasos sin notas nuevas: las notas `final` se alargan esa coda y `AudioEngine.fadeOutTracks` desvanece el canal de cada pista (los envíos, post-fader, lo siguen) (reverb y delay conservan su cola); los niveles se reponen al volver a reproducir (`restoreTrackLevels`), no al parar, o al saltar atrás durante la coda. |
| `js/app.js` | `App` | UI: topbar, barra de la pieza (tonalidad, forma, tiempo y secciones clicables que saltan con `Composer.seek`), panel de pistas tipo mezclador, estado persistente por pista, orquestación generar/play/stop. Transporte: ▶ alterna reproducir/pausa (también Espacio), ■ para y rebobina; F alterna pantalla completa. Guía de composición (botón «?» del topbar, popover `#dlg-guide` en `index.html`: texto estático que conviene actualizar si cambia la lógica compositiva, más el apartado «En esta pieza» que rellena `renderGuidePiece` al abrir). Encadenado de piezas (Auto-generar / Auto-reinicio) con un respiro de `PIECE_GAP_MS` y modo kiosco (ver abajo). |

Flujo de una generación (`App.generate`):
sorteo de pistas/duración/tempo si tienen «azar» → forma (`generateForm`) →
plan de duración (`Composer.planDuration`: largo de célula y repeticiones) →
célula madre (`Generator.generateMotherCell`) → motivos (`generateMotifs`) →
pieza (`Composer.compose`: posiciones de sección → plan formal (`FormPlan.plan`)
→ reparto de bloques por carácter → recapitulación → plan tonal
(`planTonality`) → registro (`planRegister`) → rejilla de bloques →
plan armónico (`Harmony.plan` + `Harmony.spell`) → `Humanizer` → `Energy` →
`Harmony.apply` → `Counterpoint`
→ duraciones y `stepEvents`) → render
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
  Toda célula (madre y variaciones) tiene al menos `max(3, 15% del largo)`
  ataques (`MIN_CELL_NOTES`/`MIN_CELL_DENSITY`): se re-sortea hasta cumplirlo,
  porque una célula casi vacía repetida por una pista sola deja la música muda.
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
  blockMarkers, numTracks, cellLength, scale, key, modulation, harmony, form,
  contour }`. `grid[pista][paso]` (celda `{ midi, degree, keyOffset, mode?,
  octave?, alter?, velocity, sustain, motifIndex, durationSteps, final? }` o `null`)
  para el visualizador;
  `stepEvents[paso]` para el transporte: lista de `{ trackIndex, cell }` donde
  `cell` es **la misma celda del `grid`** (referencia, no copia), así que
  cualquier cambio en el grid (p. ej. `retune`) se ve al reproducir.
- **Utilidades compartidas** en `Generator` (carga antes que los pases):
  `GHOST_VELOCITY` (0.18, umbral de nota fantasma usado por composer, energy y
  counterpoint), `MAX_SUSTAIN_STEPS` (16, tope de hueco en duraciones de
  composer y counterpoint), `buildBlockMap(ctx)` y `sectionAt(ctx, paso)`.
- **Plan formal** (`FormPlan.plan`, `piece.form`): `{ characters,
  returnIndex, recapIndex, tonalEnd, climaxSection, climax, climaxStep,
  retransition, peak, totalSteps }`. Se calcula en `compose` con las
  repeticiones por letra ya fijadas (las del plan de duración, que no cambia),
  antes de repartir bloques:
  - **Carácter por letra** (`section.character`, el mismo objeto en todas las
    apariciones, invariante 7): `{ letter, archetype, name, register,
    density, blockSilence, budget, level, tracks, motifWeights }`. La primera
    letra es la exposición (`'exposition'`: registro 0, densidad normal, nivel
    1, la madre pesa `MOTHER_WEIGHT_EXPOSITION`); las demás toman un arquetipo
    de `ARCHETYPES` (lírico: +1 octava, ralo, 0.86, frases dobles; sombrío: −1,
    ralo, 0.9; agitado: 0/−1, denso, 1.15; brillante: +1, denso, 1.1) sin
    repetir mientras queden, con la madre a `MOTHER_WEIGHT_CONTRAST` y dos
    variaciones favoritas propias. `register` en octavas; la pieza sortea un
    único sentido (`registerDir`) y las letras cuyo arquetipo prefiere el
    otro se quedan en 0, para que dos secciones nunca disten dos octavas.
    `density` (`DENSITIES`): cuántas pistas tocan (`tracks`: ralo ⌊n/2⌋,
    normal n − ⌈n/4⌉, denso n; las letras de contraste prefieren las pistas
    que callaban en la exposición), `blockSilence` (0.3/0.15/0.05) y `budget`
    (factor del presupuesto de Energy: 0.75/1/1.2). `level`: nivel dinámico
    base.
  - **Clímax** (`climaxSection`, `climaxStep`, `climax` en fracción): la
    sección que contiene un objetivo sorteado en [0.6, 0.7] de la pieza, entre
    la segunda y la anterior a `tonalEnd` y de otra letra que la exposición si
    se puede; dentro de ella entre su 30 % y su 90 %. Su letra toma un
    arquetipo intenso (agitado o brillante, el de más nivel si otra letra
    también lleva uno). `section.climax` lo marca.
  - **Perfil de intensidad** (`FormPlan.intensityAt(form, paso)`): arco
    lineal de 0 al principio a 1 en `climaxStep` y a 0 al final. Es la única
    curva de clímax de la pieza: de ella salen el presupuesto de Energy, el
    nivel dinámico del humanizador (`DYN_FLOOR + DYN_RANGE × intensidad`) y,
    vía `climaxSection`, el arco tonal. `section.intensity` es su media en la
    sección (informativa).
  - **Recapitulación y retransición**: `returnIndex` es la vuelta final de A
    (última aparición de la primera letra precedida de otra; −1 si no hay,
    p. ej. A-A-B-B); `recapIndex` = `returnIndex` o, si no hay, la última
    sección: ahí cae la recapitulación de siempre (`recap`, `recapTrack`, motivo
    madre con prob. 0.7 en la vuelta de A y 0.5 si no). `tonalEnd` =
    `recapIndex` (o la última): desde ahí todo está en la tonalidad base. La
    sección anterior lleva `retransition = { section, startStep, lengthSteps,
    shape }`: su última frase (o su segunda mitad si es de una sola), sobre la
    dominante de lo que sigue (ver «Plan armónico»); `shape` es
    `'crescendo'` si el clímax cae en su segunda mitad (la mitad de las veces
    que el clímax está en esa sección se lleva al final de la retransición) y
    `'diminuendo'` si ya pasó; el humanizador aplica la rampa
    (`RETRANS_RAMP`).
  - **Frases** (`section.phrases = [{ startStep, lengthSteps, cadence }]`):
    largo por letra `max(cellLength, 64)` (128 en el lírico), doblado
    mientras haya más de `MAX_PHRASES` (8), como mucho la sección entera;
    siempre potencias de 2 alineadas con las repeticiones de célula. Cadencias
    internas por letra: antecedente (`j` par) `'half'`, consecuente
    `'authentic'` o `'deceptive'` (prob. `DECEPTIVE_CHANCE`); la última frase
    la rellena `Harmony.plan` con `section.cadence`.
- **Modo de modulación** (selector «Modulación» del diálogo Generación,
  `ui.modulation` en `binario.settings`, `piece.modulation`; rige desde la
  próxima generación, no re-afina la pieza en curso): `'real'` (por defecto
  en el HTML y en `FIRST_VISIT_SETTINGS`; los ajustes guardados sin el campo
  se quedan con él), `'soft'` o `'none'` (`Generator.MODULATIONS`), o
  `'random'` («Aleatoria»): `Generator.resolveModulation` la sortea en cada
  generación (real 0.5, suave 0.3, ninguna 0.2) y la opción muestra lo que
  suena, como escala y tonalidad; `compose` siempre recibe un modo concreto.
- **Plan tonal** (`planTonality` en `composer.js`): **arco compuesto de
  antemano** sobre regiones tonales. Una región es `{ fifths, mode }`:
  `fifths` quintas con signo que se transporta la tonalidad de la pieza y
  `mode` ausente (el mismo modo), `'relative'` (relativo: cambia de género
  conservando la armadura — mayor→menor +9, menor→mayor +3, dórica→mayor
  +10, mixolidia→menor +2) o `'parallel'` (homónimo, misma tónica:
  mayor↔menor, dórica↔mixolidia; mixtura modal) según `Generator.MODE_RELATIONS`
  (pentatónica y cromática no tienen relaciones: solo quintas). Va
  coordinado con el plan formal: con c = `form.climaxSection` y E =
  `form.tonalEnd`, la lejanía máxima `peak` (`form.peak`) va de 1 a
  min(4, c, E − c) — la máxima con prob. 0.6, si no al azar —, así que
  nunca pasa de min(4, ⌊(S−1)/2⌋). Ruta de `peak` regiones **vecinas**
  encadenadas (`neighborRegions`: ±1 quinta en el mismo modo, cambio a/desde
  el relativo, y el homónimo solo desde la tónica y de vuelta; sin repetir
  región; pesos por escala en `ROUTE_WEIGHTS` — en menor el relativo mayor es
  lo más probable, en mixolidia la subdominante —, multiplicados por una
  tensión que crece hacia el clímax: la dominante ×(0.6 + 0.8·k/peak), la
  subdominante ×(1.4 − 0.8·k/peak)). La sección i toca
  `route[tonalLevel(i)]`, con nivel `round(peak·i/c)` hasta c y
  `round(peak·(E−i)/(E−c))` después, 0 desde E: sale de la tónica, llega a la
  región más lejana justo en la sección del clímax y vuelve por el mismo
  camino (mismo nivel → misma región), **terminando siempre en la tonalidad
  base** y con la recapitulación ya en casa. Entre secciones consecutivas el
  nivel cambia como mucho en 1. Las modulaciones
  solo caen en **fronteras de sección**. `'soft'` reproduce el viaje por
  quintas de antes (un sentido, bemoles más probable en menor y dórica) y
  `'none'` deja todo en la base.
  Cada sección guarda `fifths`, `keyOffset` (= 7·`fifths` mod 12, semitonos
  del transporte de la región; NO es la tónica local en relativos) y `mode`,
  y los derivados que `describeRegion` recalcula en cada `retune`: `tonic`
  (tónica local, semitonos 0-11 sobre la base), `localScale` (escala local),
  `shift` (transporte efectivo con signo en [-6, 5]) y `fifthOffset` (la
  tónica local en el ciclo de quintas, con signo: lo que dibuja la vista
  «fifths»; La menor desde Do = +3). Además `arrival` (`'dominant'`,
  `'subdominant'`, `'relative'`, `'parallel'` o null): cómo se llega a ella.
  Cada nota del `grid` copia `keyOffset`, `mode` y `octave` de su sección.
  **Registro** (`section.octave`, octavas enteras, `planRegister`): el
  transporte efectivo T = `shift` (solo con modulación real) + 12·`octave` se
  elige por programación dinámica sobre la pieza entera entre las octavas
  que dejan T a ≤ `REGISTER_WINDOW` (8) semitonos de 12·`character.register`
  y con |T| ≤ 17 — y, antes que eso, que dejan la sección audible: el
  percentil 10 de sus notas (con la tonalidad real) ≥ `REGISTER_FLOOR` (48,
  Do3) y el 90 ≤ `REGISTER_CEIL` (93); sin ese suelo, sombrío + transporte
  de la modulación + tónica grave hundían frases enteras bajo Do2 —, minimizando el salto de altura media entre secciones
  consecutivas (contenido de la letra, en la escala local, + T, descontado el
  cambio deliberado de registro entre caracteres) más `REGISTER_PULL` (0.5) ×
  la distancia al registro del carácter. Así una modulación real no arrastra
  la melodía de golpe y la vuelta de A cae en su registro. Se fija al
  componer; `retune` lo conserva.
  **Derivación de `midi`**: `Generator.cellMidi(degree, scale, key, cell,
  modulation)` es la única. Con modulación **real** la escala se transporta
  de verdad: `degreeToMidi(degree, localScale, key + shift) + alter +
  12·octave` — el grado 0 es la tónica local; `shift` es la octava más
  cercana y `octave` el registro elegido para la sección. Con **suave**,
  `degreeToMidiInKey(degree, scale, key, keyOffset) + alter + 12·octave`: la nota se
  calcula en la tonalidad base y solo se altera ±1 semitono si no pertenece a
  la escala transportada, siguiendo la armadura (sube hacia los sostenidos,
  baja hacia los bemoles; dos grados nunca colapsan); conserva alturas pero
  el centro tonal sigue en la base. La cromática es insensible a la suave.
- **Alteración cromática** (`cell.alter`, semitonos, ausente = 0): se suma
  tras el mapeo de grado. La escribe solo `Harmony` a partir del acorde
  vigente (`chord.alters`, alteración por clase de grado, en el marco de la
  sección): la sensible del V de cadencia en menor y dórica (+1 a la tercera)
  y las notas de una dominante secundaria de preparación (Fa# del V/V, Sib del
  V7/IV — la séptima no es tono del acorde pero sí tiñe su compás). Afecta a
  toda nota de esa clase de grado y de la región del acorde mientras dura,
  también en tiempo débil, para que no convivan Sol y Sol#. Siempre se cumple
  `cell.alter === Harmony.alterAt(piece, paso, cell, cell.degree)`; todo pase
  que cambia un grado lo hace con `Harmony.setPitch`, que recalcula `alter` y
  `midi`, y `retune` la recalcula (`Harmony.refresh` → `spell`): la sensible
  sobra al pasar a mayor y vuelve al volver a menor.
- **Plan armónico** (`Harmony.plan`): `piece.harmony = { scale, active,
  chords }` (o `null` en cromática) y en cada sección `chords` (los mismos
  objetos, contiguos y cubriéndola entera), `progression` (cifrados del bucle
  de su letra en el modo de la sección), `progressionSteps` (sus grados, lo
  que comparte la letra), `chordSteps` (ritmo armónico) y `cadence`
  (`'half'`, `'modulating'` o `'authentic'`, la de su última frase). Acorde:
  `{ startStep, lengthSteps, keyOffset, mode, step, ref?, role?, retrans?,
  root, tones, alters, quality, label, fn, pivotOf?, prepared?, cadence? }`;
  `cadence` va en el último acorde de cada frase (las internas `'half'`,
  `'authentic'` o `'deceptive'`). El bucle de la letra arranca en cada frase. Especificación
  simbólica (se re-describe en cada `retune`): `step` es el grado de la
  fundamental relativo a la tónica local (0 = I); `role: 'cadential'` marca el
  V de semicadencia o de la cadencia perfecta (sensible en menor/dórica);
  `ref: 'next'` con `role: 'prep'` es la dominante de la tonalidad siguiente
  (V/x, tríada mayor sobre su quinta, `prepared`) y con `role: 'pivot'` el
  grado `step` de la siguiente, diatónico en ambas (`pivotOf`, su cifrado
  allí; pivotes probados en `FAMILIES[…].pivots`, predominantes primero). La
  preparación sustituye la semicadencia de toda sección seguida de otra
  región: `… pivote – V/x` (sin pivote posible, como hacia el homónimo, el
  acorde del bucle; pivote solo con ≥ 2 acordes propios antes en la
  sección). En la sección con `retransition` los m = largo/`chordSteps`
  acordes que cubre son la dominante de lo que sigue (V `cadential` o V/x
  `prep`, marcados `retrans: true`); con m ≥ 4 el primero es el pivote o la
  predominante que la prepara. Derivados: `root` y
  `tones` son clases de grado en el marco de la sección (lo que los pases
  comparan con `degree mod n`); `alters` (o null) ver «Alteración
  cromática»; `quality` ∈ maj/min/sus2/sus4/5/aug (`other` solo en
  pentatónica con modulación suave, que colapsa grados a 3–4 quintas; con la
  real no ocurre); `label` es el cifrado romano con ♭ respecto a la mayor
  (`i`, `♭VII`, `V5`, `V/V`, `V7/IV`…) y `fn` la función T/S/D. La progresión
  se sortea por letra (invariante 7) en la familia de su primera aparición; si
  la letra reaparece en una región de otro modo se lee allí y la tríada
  disminuida se sustituye (`DIM_SUBSTITUTE`). Las cadencias, la preparación y
  la tónica local dependen de la posición, como la tonalidad. El número de
  acordes por sección es potencia de 2 y el largo de la progresión 2 o 4.

## Invariantes (no romper)

1. **Potencias de 2 en todas partes**: largos de célula, repeticiones de sección,
   particiones de bloques (`partitionRepeats` bisecciona). El algoritmo
   `fractal` y `subsequence` dependen de esto.
2. **Dos pistas nunca tocan el mismo motivo a la vez** dentro de una sección
   (`slotUsage` en `composer.js`). Antes que duplicar, una pista calla.
   **Sin silencios generales**: en cada repetición de célula de una sección
   al menos una pista tiene un bloque con motivo (`ensureCoverage`). Las
   pistas que callan la sección las decide la orquestación del carácter y los
   bloques mudos se sortean aparte (`blockSilence`); si coinciden en todas las
   pistas, una pista rellena el hueco (biseccionando su bloque mudo,
   invariante 1), con preferencia por las que no callan la sección entera:
   la cobertura manda sobre la orquestación. La preferencia de motivos solo
   pondera el sorteo entre los libres.
3. **`degree` siempre entero en [-7, 7]** al salir del generador; los contornos
   crudos son floats y se normalizan en `normalizeContour`. También tras los
   pases: humanizador y contrapunto no sacan un grado del rango (el unísono
   solo se abre a la octava si cabe). Una «octava» escrita como ±largo de
   escala fuera de rango se convierte en salto de registro al hacer `retune`
   a una escala de otro largo. Con modulación real el grado es relativo a la
   tónica local; el transporte efectivo (`shift`, [-6, 5]), el registro
   (`octave`, |T| ≤ 17) y `alter` (±1) no cuentan en ese rango: el `midi`
   resultante queda en ~24–108.
4. **Una instancia de sinte por pista**: los sintes monofónicos de Tone fallan al
   retriggerar si se comparten. `AudioEngine.setupTracks` crea y desecha
   instancias; nunca reutilizar un sinte entre pistas.
5. **Sin superposición dentro de una pista**: la duración de cada nota se recorta
   al hueco hasta la siguiente nota (legato como máximo, factor 0.95 al disparar).
6. **`retune` no regenera**: cambiar escala/tonalidad re-mapea los `degree`
   guardados a MIDI en la pieza existente, incluso durante la reproducción. Por
   eso cada celda del `grid` conserva `degree`, `keyOffset`, `mode`, `octave` y `alter`
   junto a `midi`, y `midi === Generator.cellMidi(degree, scale, key, cell,
   piece.modulation)` siempre. `retune` re-describe las regiones de las
   secciones, re-describe el plan y reescribe `alter` (`Harmony.refresh`) y
   luego deriva `midi` recorriendo el `grid`; `stepEvents` lo ve porque
   referencia esas mismas celdas (no copiar campos de la celda en los eventos).
   Ida y vuelta (escala A → B → A) devuelve exactamente los mismos `midi`.
7. **Misma letra de forma = mismo material**: las secciones "A" comparten spec
   (`specByLetter`) y carácter (`form.characters`); no re-sortear por
   aparición. La tonalidad, el registro exacto (`octave`), la intensidad, las
   cadencias y la retransición sí pueden diferir entre apariciones (dependen
   de la posición en la pieza, no de la letra). El
   humanizador introduce diferencias de superficie entre apariciones (notas
   caídas, adornos, respiraciones): es deliberado, el spec sigue compartido.
8. **El tempo es único por pieza y solo lo cambia el usuario** (slider en
   tiempo real). La única excepción es el «azar» de tempo, que `App.generate`
   sortea una vez al generar y escribe en ese mismo slider, antes de que suene
   la pieza. Ningún pase generativo o de humanización debe tocar
   `Transport.bpm` ni desplazar notas en el tiempo (nada de rubato, swing ni
   micro-timing).
9. **La humanización trabaja en grados, nunca en MIDI directo**: toda nota que
   `Humanizer` añade o altera escribe `degree` (y copia `keyOffset`/`mode`/`octave`)
   y obtiene `alter` y `midi` con `Harmony.setPitch`, para que `retune` siga
   funcionando. Conserva el `motifIndex` del bloque (invariante 2) y corre
   antes del cálculo de duraciones (invariante 5). Las notas insertadas
   (mordentes, notas de paso) copian la región de su nota ancla; hoy ambos
   adornos caen dentro del bloque de su ancla, así que nunca llevan la región
   de una sección vecina, pero si un adorno futuro cruzara una frontera sería
   aceptable (decora su contexto inmediato; `alterAt` no altera notas de otra
   región y `Counterpoint` compara en semitonos entre regiones distintas). El
   plan tonal de referencia vive en las secciones, no hace falta
   reconstruirlo de las notas.
10. **El contrapunto es determinista y acotado**: `Counterpoint.enforce` no usa
   azar (misma entrada → mismas correcciones, así la recapitulación sigue
   literal), no añade, quita ni desplaza notas en el tiempo (los huecos entre
   notas no cambian), trabaja en grados como el humanizador, e ignora las notas
   casi inaudibles (velocity ≤ `GHOST_VELOCITY`, 0.18). Garantiza: en tiempo fuerte (paso múltiplo
   de 4) ninguna pareja de notas audibles simultáneas es disonante dura. La
   clasificación por distancia de grados es estable frente a `retune` entre
   escalas del mismo largo y solo se usa entre notas de la misma región
   (`keyOffset` y `mode`); entre regiones distintas (una sostenida que cruza
   una modulación) y en pentatónica se clasifica en semitonos. El tritono y la
   segunda menor / séptima mayor (que con `alter` pueden caer en la misma clase
   de grado: Sol contra Sol#) se miran siempre en semitonos y pueden variar
   tras un retune en vivo — se acepta. Toda corrección de grado pasa por
   `Harmony.setPitch` (recalcula `alter`). Consultar el acorde vigente solo reordena
   preferencias (qué nota cede, hacia dónde se mueve), no cambia estas garantías.
11. **`Tone.start()` requiere gesto del usuario**: se llama desde Play
   (`AudioEngine.init`). La única excepción es el arranque del modo kiosco,
   que lo intenta al cargar sin esperar respuesta y comprueba
   `AudioEngine.isRunning()`. Solo funciona si la política de autoplay lo
   permite; si no, espera el primer gesto.
12. **El pase de armonía es determinista, idempotente y acotado**:
   `Harmony.apply` no usa azar (el azar vive solo en `Harmony.plan`, por
   letra), no añade, quita ni desplaza notas, ni toca velocity o sustain:
   solo escribe `degree` (±1 grado; 1–2 hacia abajo para llevar el bajo a la
   fundamental) dentro de [-7, 7] y su `alter` y `midi` con `setPitch`,
   conservando `motifIndex` y la región. Solo toca notas de la región del
   acorde. Re-ejecutarlo no mueve nada (las alteraciones dependen solo del
   grado y del acorde, no de lo que el pase decide). La
   tolerancia a notas de paso en `s % 8 === 4` solo mira vecinas en pasos que
   el pase no toca o que fija antes (cabezas de medio compás): no romper eso
   al ampliar las fases. Va tras `Energy` y antes de `Counterpoint`, que tiene
   la última palabra sobre los choques. El plan se re-describe en `retune`,
   pero las notas no se re-armonizan (invariante 6). En la retransición el
   bajo baja a la fundamental en cada `s % 8 === 0` (la nota más grave sigue
   siéndolo al bajar, así que también es idempotente).
13. **Un solo plan formal**: el clímax, el perfil de intensidad, el carácter
   de cada letra, las frases, la recapitulación y la retransición salen de
   `FormPlan.plan`, una vez por pieza y antes de colocar notas. No añadir
   constantes de clímax ni arcos de pieza propios en los pases: leer
   `ctx.form` (`intensityAt`, `levelAt`, `budgetAt`). El arco tonal culmina en
   `form.climaxSection` y vuelve a la base en `form.tonalEnd`. Las frases y
   la retransición son potencias de 2 alineadas con las repeticiones de
   célula y cada frase tiene al menos 2 acordes. `planDuration` no depende del
   plan formal.

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
