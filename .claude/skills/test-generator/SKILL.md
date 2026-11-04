---
name: test-generator
description: Probar headless con Node la lógica de generación y composición (generator.js, form.js, harmony.js, humanizer.js, energy.js, counterpoint.js, composer.js) sin navegador ni Tone.js. Usar tras cambiar generación de células, contornos, variaciones, formas, plan formal, armonía, humanización, energía, contrapunto o composición, antes de dar el cambio por bueno.
---

# Probar el generador sin navegador

`generator.js`, `form.js`, `harmony.js`, `humanizer.js`, `energy.js` y
`counterpoint.js` no dependen del DOM ni de Tone.js, y `Composer.compose` solo
usa esos seis. Se pueden
verificar con Node evaluando los IIFE y exponiendo los globals.

## Harness

```
node -e "
const fs = require('fs');
eval(fs.readFileSync('js/generator.js', 'utf8') + ';globalThis.Generator = Generator;');
eval(fs.readFileSync('js/form.js', 'utf8') + ';globalThis.FormPlan = FormPlan;');
eval(fs.readFileSync('js/harmony.js', 'utf8') + ';globalThis.Harmony = Harmony;');
eval(fs.readFileSync('js/humanizer.js', 'utf8') + ';globalThis.Humanizer = Humanizer;');
eval(fs.readFileSync('js/energy.js', 'utf8') + ';globalThis.Energy = Energy;');
eval(fs.readFileSync('js/counterpoint.js', 'utf8') + ';globalThis.Counterpoint = Counterpoint;');
eval(fs.readFileSync('js/composer.js', 'utf8') + ';globalThis.Composer = Composer;');
// ... pruebas aquí ...
"
```

Notas:
- El sufijo `;globalThis.X = X;` es necesario: `const` dentro de `eval` no
  escapa al scope exterior.
- No cargar `audio.js`/`visualizer.js`/`app.js`: dependen de `Tone`/DOM.
- `Composer.play/stop` usan `Tone` — solo probar `compose`, `retune`, `getPiece`.
- Rutas relativas a la raíz del repo (ejecutar desde ahí).
- Las formas se escriben con guiones: `parseForm('A-A-B-A')` → 4 secciones
  (`'AABA'` sería UNA sección llamada "AABA").

## Invariantes a verificar según lo tocado

**Células y contornos** (recorrer todos los `Generator.CELL_LENGTHS` × todos los
`Generator.CONTOUR_NAMES`, vía `generateMotherCell(len, nombre)`):
- `cell.length === len` y `cell.contour` guardado.
- Cada paso: `degree` entero en [-7, 7], `velocity` en [0.15, 1], `note` booleano,
  `sustain` continuo en [0.25, 1] (onda lenta de legato: media ~0.7 y rachas de
  pasos contiguos ligados, no ruido por nota).
- Densidad de notas razonable (proporción de `note:true` ~0.25–0.45 de media;
  el ritmo va por valores de nota, así que es menor que con sorteo por paso).
- Huecos entre ataques variados: fracción de huecos de 1 paso < 0.55 y de
  huecos ≥3 pasos > 0.25 (el ritmo por `NOTE_VALUES` debe producir valores
  largos, no solo semicorcheas).

**Variaciones**: `generateMotifs(madre, n)` devuelve `n+1` motivos, `motifs[0]`
es la madre, todos del mismo largo y con grados en rango. Toda variación lleva
`cell.contour` válido (∈ `CONTOUR_NAMES`); una fracción (~40%, `recontour`) lo
tiene distinto al de la madre.

**Composición** (`Composer.compose` con opts completos: `numTracks`, `motifs`,
`formParts`, `cellLength`, `scale`, `key` y `modulation` — recorrer los tres
de `Generator.MODULATIONS`; sin él vale `'real'`):
- `totalSteps === Σ cellLength × totalRepeats` de las secciones.
- En ningún paso dos pistas tocan el mismo `motifIndex` (invariante central).
- Sin silencios generales: en cada repetición de célula de cada sección al
  menos una pista tiene un bloque con `motifIndex` no nulo (`ensureCoverage`).
  Toda célula tiene ≥ `max(3, ceil(0.15 × largo))` pasos con `note:true`.
- `durationSteps >= 1` en toda nota y ninguna nota pisa la siguiente de su pista.
- Letras de forma repetidas comparten spec (mismo `trackBlocks` por letra, salvo
  la sección de recapitulación) y carácter (`section.character ===
  piece.form.characters[letra]`).
- Plan de duración (`Composer.planDuration(formParts, targetSteps)` y luego
  `compose` con `cellLength: plan.cellLength, repeatsByLetter: plan.repeats`):
  `cellLength ∈ CELL_LENGTHS`, toda repetición potencia de 2,
  `piece.totalSteps === plan.steps` y cada sección con el `totalRepeats` de su
  letra. Con objetivos realistas (≥ 2 min a ≥ 40 bpm, `minutos × bpm × 4`
  pasos), `plan.steps / targetSteps` en ~[0.85, 1.17]. Las piezas largas
  (≥ 10 min) deben salir con células de 32–64 pasos, no de 16 repetidas cientos
  de veces.
- Toda nota: `midi === Generator.cellMidi(degree, scale, key, cell,
  piece.modulation)` (con `cell.octave`, el registro de su sección) y `(cell.alter || 0) === Harmony.alterAt(piece, paso,
  cell, cell.degree)`; `midi` en ~24–108.
- Plan tonal (`planTonality`): la primera y la última sección en la base
  (`keyOffset === 0`, sin `mode`), y toda sección desde `form.tonalEnd`
  también; mismo nivel `tonalLevel` (round(peak·i/c) hasta c =
  `form.climaxSection`, round(peak·(E−i)/(E−c)) después, E = `form.tonalEnd`)
  → misma región (la vuelta recorre la ida); con `form.peak > 0` la sección
  del clímax no está en la base; `keyOffset === mod(7 × fifths, 12)`; entre secciones
  consecutivas, o la misma región o una vecina (|Δfifths| ≤ 1 sin cambio de
  modo, o mismo `fifths` cambiando de modo); `|shift| <= 6`; con S ≥ 3 y
  modulación ≠ `'none'` hay al menos una modulación; `'none'` → todo
  `keyOffset` 0; `'soft'` → sin `mode` y `|fifthOffset| <= min(4, ⌊(S-1)/2⌋)`.
  Toda nota lleva la región (`keyOffset`, `mode`) y el registro (`octave`)
  de su sección (hoy los
  adornos del humanizador nunca cruzan frontera; si alguno lo hiciera, solo en
  el último paso de la sección).
- Métricas de modulación (por modo y escala): en secciones moduladas, % de
  notas en la escala local (`localScale` sobre `tonic`; ~99 %, el resto son
  alteraciones del plan) y % de notas de grado 0 sin `alter` que suenan en la
  tónica local (real 100 %, suave 0 %: la suave no mueve el centro tonal);
  distribución de `section.arrival`; transposición efectiva máxima.
- `retune`: tras retune a otra escala/tonalidad se mantienen las dos
  equivalencias de arriba; de vuelta a la original, mismos `midi` y cifrados
  que antes (ida y vuelta exacta).
- Con los pases desactivados (`globalThis.Humanizer = { humanize(){} }`, ídem
  `Energy`/`Counterpoint`), toda nota lleva exactamente la región y el
  registro de la sección que la contiene.
- Modulación suave (`degreeToMidiInKey`): con `keyOffset` 0 es idéntica a
  `degreeToMidi`; el resultado siempre pertenece a la escala transportada
  `keyOffset` semitonos; dista a lo sumo ±1 semitono de la nota en tonalidad
  base (conserva alturas, no transpone) y la alteración sigue la armadura:
  sube (+1) en el lado sostenido del viaje (`keyOffset` ∈ {2, 4, 7, 9}), baja
  (−1) en el bemol ({3, 5, 8, 10}); en escalas de 7 notas los grados nunca
  colapsan en la misma altura tras modular; la cromática nunca se altera.

**Energía** (`Energy.balance`, corre dentro de `compose` tras humanizar y antes
del contrapunto):
- Determinista e idempotente: re-ejecutar `balance` sobre una rejilla ya
  equilibrada devuelve `stats.removed === 0`.
- Solo borra celdas y sube `sustain`; en las celdas que quedan no cambia
  `degree`, `midi` ni `velocity` (retune-safe) y `sustain` nunca baja.
- Nunca retira: tiempos fuertes (`s % 4 === 0`), la primera repetición de cada
  bloque, la última nota de cada bloque, las pistas de primer plano
  (`max(1, ceil(numTracks/3))` más salientes por ventana) ni la pista de
  recapitulación en su sección (`section.recapTrack`).
- Presupuesto por ventana de `cellLength` pasos: ataques audibles
  (velocity > 0.18) ≤ `round(cellLength × (0.9 + 0.9 × curva) × budget)`, con
  curva = `FormPlan.intensityAt(form, centro de la ventana)` y `budget` el
  del carácter de la sección (0.75/1/1.2) — o, si no se alcanza, toda nota
  restante de las pistas de fondo está protegida.
- Sobre piezas completas la poda es moderada (~3–8% de las notas con 5–6
  pistas; con 1–2 pistas apenas actúa).
- La idempotencia se comprueba re-ejecutando `balance` sobre la salida de
  `compose` con el contrapunto desactivado (`globalThis.Counterpoint =
  { enforce(){} }`): el contrapunto corre después y cambia midi/velocity, lo
  que altera la saliencia.

**Armonía** (`Harmony.plan` antes de humanizar, `Harmony.apply` tras Energy y
antes del contrapunto):
- Cromática: `piece.harmony === null` y `section.chords` vacío.
- En las demás escalas, `section.chords` contiguos y cubriendo la sección,
  con la región de su sección, `lengthSteps` potencia de 2 en [8, 32], número
  de acordes potencia de 2 y sin `quality` `dim` (ni `other`, salvo
  pentatónica con modulación suave). Misma letra → mismos `chordSteps` y
  `progressionSteps` (las etiquetas `progression` cambian con el modo local).
- Cadencias: la última sección termina en V (`role: 'cadential'`) → I
  (`step` 0, `root === 0`, `cadence: 'authentic'`); las seguidas de otra
  región en `cadence: 'modulating'` con último acorde `role: 'prep'` (V/x:
  en escalas de 7, tríada mayor cuya fundamental es la quinta de la tónica
  siguiente — comprobar con `Harmony.frameOf` sumando `alters`) y
  normalmente un pivote (`role: 'pivot'`) antes; las demás en semicadencia
  (`'half'`, último `role: 'cadential'`).
- Frases: el último acorde de cada frase de `section.phrases` lleva
  `cadence === phrase.cadence` y cada frase tiene ≥ 2 acordes. Internas:
  `'half'` → V `cadential`; `'authentic'` → V `cadential` + I (`step` 0);
  `'deceptive'` → V `cadential` + `FAMILIES[escala local].deceptive`.
- Retransición (`section.retransition`, en la sección `form.recapIndex − 1`):
  los últimos v acordes (m = largo/`chordSteps`, v = m ≥ 4 ? m − 1 : m) son
  `cadential` (si sigue la misma región) o `prep`, con `retrans: true` si
  m > 1; ningún otro acorde lleva `retrans`. El I propio de cada
  sección suena en `section.tonic` (`frameOf(piece, sec).pcs[root]`).
- Sensible: en secciones de escala local menor o dórica, todo V
  `cadential` tiene tercera mayor sobre su fundamental (`chord.alters`) y
  toda nota de la región de esa clase de grado mientras dura suena a un
  semitono de la tónica local **si su línea sube** (la siguiente nota de la
  pista con otra altura natural está por encima, o no hay siguiente); si
  baja, suena natural (`Harmony.resolves`; la séptima de una dominante
  secundaria, −1, al revés). Métricas melódicas: entre notas audibles
  consecutivas de una pista, las sensibles (`alter > 0`) seguidas de una nota
  más grave deben ser ≈ 0 (eran ~54 %) y las segundas aumentadas (grado
  conjunto a 3 semitonos en la misma región) < 0.3 % de las notas. Métricas: % de modulaciones preparadas (100 % en
  escalas de 7 y en pentatónica real) y con pivote (~80–97 %; hacia el
  homónimo no hay; con retransición de una frase de 2 acordes tampoco).
- Idempotencia: envolver `Harmony.apply` y re-ejecutarlo sobre su propia
  salida (antes del contrapunto, que mueve grados) da `moved + bass === 0` y
  no cambia ni `degree` ni `alter`.
- Métrica: fracción de ataques audibles en `s % 4 === 0` cuyo `degree` mod
  largo cae en `chord.tones` (`Harmony.chordMap`): ~45–55 % antes del pase
  (`stats.inChordBefore / stats.checked`), ~96 % tras todo el pipeline.
- Notas `final` dentro de `harmony.chords.at(-1).tones`.
- `retune` a otra escala: `tones` en rango del nuevo largo y sin `other`
  (salvo pentatónica suave); de vuelta a la original, el último acorde vuelve
  a `root === 0` y los cifrados son los de antes.
- Los pases se desactivan igual que los demás:
  `globalThis.Harmony.apply = () => ({})` (el plan sigue haciéndose).

**Plan formal** (`piece.form`, `FormPlan.plan` al inicio de `compose`):
- `form.returnIndex === FormPlan.returnIndex(formParts)`; `form.recapIndex`
  es él o, si es −1, la última sección; solo esa sección tiene `recap`.
- La primera letra es `'exposition'`; `character.tracks` no vacío y en
  rango; `section.octave` entero con |T| ≤ 17 (T = shift real + 12·octave).
- Frases contiguas que cubren la sección, potencias de 2, en número potencia
  de 2 y múltiplos de `cellLength` (o la sección entera).
- Clímax: `climaxStep` dentro de `climaxSection`, con S ≥ 3 esa sección en
  [1, `tonalEnd`) y no de la letra de la exposición si hay otra candidata;
  `intensityAt(form, climaxStep) === 1`; `section.intensity` en [0, 1].
- Retransición presente en `recapIndex − 1`, cerrando la sección, con
  `shape` ∈ {crescendo, diminuendo}.
- Métricas (comparar antes/después de tocar el plan; script de referencia en
  el historial de la fase 3): contraste A vs. otras letras — |Δ altura media|
  (~6 semitonos), |Δ log densidad de ataques| (~0.5), |Δ velocity media|
  (~0.09), |Δ pistas activas| (~1.3) y % de letras que contrastan en ≥ 2 de
  esas dimensiones (~87 %; antes del plan formal, ~52 %); posición del
  clímax de energía (sección con más ataques/paso), dinámico (más velocity
  media) y tonal (más lejana): energía y dinámica ~0.6 y en la sección
  tonal más lejana ~90 % y ~99 %; cadencias internas por sección (~4.4,
  ~92 % de secciones con alguna); retransición prolongada (~99 % de las
  vueltas de A); salto de altura media entre secciones con modulación real
  descontando el registro deliberado (saltos > 6 semitonos ~18 %, frente a
  ~24 % con la octava más cercana); duración real/objetivo en ~[0.85, 1.17].

**Contrapunto** (`Counterpoint.enforce`, corre dentro de `compose`):
- En todo paso múltiplo de 4, ninguna pareja de notas audibles (velocity > 0.2)
  que suenen a la vez (reconstruir con `durationSteps` de las celdas del
  `grid`) es disonante según `Counterpoint.isDissonant(a, b, scaleLen)`.
  Cada evento de `stepEvents[paso]` es `{ trackIndex, cell }`, con `cell` la
  misma celda (referencia) del `grid`.
- `isDissonant`: siempre tritono y segunda menor / séptima mayor en
  semitonos (6, 1, 11); además, entre notas de la misma región en escalas de
  ≥6 grados, segundas/séptimas por distancia de grados (1 o n-1 mod n); entre
  regiones distintas y en pentatónica, semitonos {1, 2, 6, 10, 11}.
- Todo `midi` del `grid` sigue igual a `cellMidi(...)` y `alter` al de
  `alterAt` (el pase mueve grados con `Harmony.setPitch`, nunca midi directo).
- Idempotencia: re-ejecutar `enforce` sobre una pieza ya compuesta no mueve ni
  abre unísonos (`stats.moved + stats.unisons === 0`). `compose` ya lo
  repasa al menos una vez tras el `spell` final (las alteraciones dependen
  de la nota siguiente, que el propio pase pudo mover), así que la pieza
  devuelta debe cumplirlo tal cual.
- El pase no añade ni quita notas (mismas posiciones ocupadas del `grid`) y las
  stats devueltas acotan lo tocado (~7% movidas+fantasma sobre el total).

**Alturas**: `degreeToMidi(degree, scale, key)` produce MIDI razonable (~24–108)
para todas las escalas de `Generator.SCALES` con grados en [-7, 7] y tonalidades
0–11.

Como la generación es aleatoria, repetir las comprobaciones en bucle (≥20
iteraciones) para cubrir ramas sorteadas (recapitulación, silencios, particiones).
