---
name: test-generator
description: Probar headless con Node la lógica de generación y composición (generator.js, humanizer.js, energy.js, counterpoint.js, composer.js) sin navegador ni Tone.js. Usar tras cambiar generación de células, contornos, variaciones, formas, humanización, energía, contrapunto o composición, antes de dar el cambio por bueno.
---

# Probar el generador sin navegador

`generator.js`, `humanizer.js`, `energy.js` y `counterpoint.js` no dependen del
DOM ni de Tone.js, y `Composer.compose` solo usa esos cuatro. Se pueden
verificar con Node evaluando los IIFE y exponiendo los globals.

## Harness

```
node -e "
const fs = require('fs');
eval(fs.readFileSync('js/generator.js', 'utf8') + ';globalThis.Generator = Generator;');
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
- Densidad de notas razonable (proporción de `note:true` ~0.3–0.5 de media).

**Variaciones**: `generateMotifs(madre, n)` devuelve `n+1` motivos, `motifs[0]`
es la madre, todos del mismo largo y con grados en rango. Toda variación lleva
`cell.contour` válido (∈ `CONTOUR_NAMES`); una fracción (~40%, `recontour`) lo
tiene distinto al de la madre.

**Composición** (`Composer.compose` con opts completos: `numTracks`, `motifs`,
`formParts`, `cellLength`, `scale`, `key`, `fifthSteps`):
- `totalSteps === Σ cellLength × totalRepeats` de las secciones.
- En ningún paso dos pistas tocan el mismo `motifIndex` (invariante central).
- `durationSteps >= 1` en toda nota y ninguna nota pisa la siguiente de su pista.
- Letras de forma repetidas comparten spec (mismo `trackBlocks` por letra, salvo
  la sección de recapitulación).
- Modulación por quintas: cada sección lleva `keyOffset === (floor(repeticiones
  acumuladas / fifthSteps) * 7) % 12`, con `fifthSteps` ∈ {4, 8, 16}; toda nota
  de `grid`/`stepEvents` copia el `keyOffset` de su sección y su `midi` equivale
  a `degreeToMidiInKey(degree, scale, key, keyOffset)`. `retune` debe conservar
  esa equivalencia con la nueva escala/tonalidad.
- Modulación suave (`degreeToMidiInKey`): con `keyOffset` 0 es idéntica a
  `degreeToMidi`; el resultado siempre pertenece a la escala transportada
  `keyOffset` semitonos; dista a lo sumo ±1 semitono de la nota en tonalidad
  base (conserva alturas, no transpone); la cromática nunca se altera.

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
  (velocity > 0.18) ≤ `round(cellLength × (0.9 + 0.9 × curva))`, con curva en
  arco que culmina al 65% de la pieza — o, si no se alcanza, toda nota
  restante de las pistas de fondo está protegida.
- Sobre piezas completas la poda es moderada (~4–8% de las notas con 5–6
  pistas; con 1–2 pistas apenas actúa).

**Contrapunto** (`Counterpoint.enforce`, corre dentro de `compose`):
- En todo paso múltiplo de 4, ninguna pareja de notas audibles (velocity > 0.2)
  que suenen a la vez (reconstruir con `durationSteps` de `stepEvents`) es
  disonante según `Counterpoint.isDissonant(a, b, scaleLen)`.
- `isDissonant`: segundas/séptimas (distancia de grados 1 o n-1 mod n) y tritono
  (6 semitonos) para escalas de ≥6 grados; en pentatónica, semitonos
  {1, 2, 6, 10, 11}.
- Todo `midi` del `grid` sigue igual a `degreeToMidiInKey(degree, scale, key,
  keyOffset)` (el pase mueve grados y deriva midi, nunca al revés).
- Idempotencia: re-ejecutar `enforce` sobre una pieza ya compuesta no mueve ni
  abre unísonos (`stats.moved + stats.unisons === 0`).
- El pase no añade ni quita notas (mismas posiciones ocupadas del `grid`) y las
  stats devueltas acotan lo tocado (~7% movidas+fantasma sobre el total).

**Alturas**: `degreeToMidi(degree, scale, key)` produce MIDI razonable (~24–108)
para todas las escalas de `Generator.SCALES` con grados en [-7, 7] y tonalidades
0–11.

Como la generación es aleatoria, repetir las comprobaciones en bucle (≥20
iteraciones) para cubrir ramas sorteadas (recapitulación, silencios, particiones).
