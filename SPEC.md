# Especificación — Música Generativa Algorítmica

## Tecnología
- JavaScript vanilla
- Tone.js para síntesis de audio (Web Audio API)

## Generación de música
Música aleatoria generada mediante algoritmos. El flujo de generación es lineal y pre-computado antes de la reproducción:

**1. Célula madre** → **2. Modificadores** → **3. Pistas** → **4. Forma estructural** → **5. Reproducción**

---

## Célula (Cell)
- Secuencia binaria de pasos
- Longitudes disponibles: **16, 32, 64, 128, 256** (siempre potencias de 2)
- Cada paso contiene tres campos:
  - **nota**: on/off
  - **altura**: pitch
  - **velocidad**: velocity

## Células y motivos
- Se parte de una célula madre
- Se generan variaciones derivadas de la madre: **al menos tantas como pistas** (mínimo 4)
- Las variaciones pueden ser más complejas (invertir, rotar, seleccionar sub-secuencias, alterar alturas, velocidades, etc.)
- Dos pistas nunca tocan el **mismo motivo simultáneamente** dentro de una sección

## Modificadores
**Placeholder** — se definirá después.
- Concepto: una máscara binaria del mismo largo que la célula se combina con variaciones aleatorias
- La máscara afecta **todas las propiedades** del paso donde el valor es 1
- Los modificadores se aplican a la célula madre para generar las variaciones

## Escala y Tonalidad
- **Selector** de escala y tonalidad inicial en la interfaz
- **Global**: potencias de 2 entre 8 y 32 (**8, 16, 32**) como pasos de desplazamiento en el ciclo de quintas para modificar las alturas de las notas

---

## Estructura Formal (Forma)
- Elegida **al azar** al generar la pieza
- Ejemplos: A-B-A, A-B-C-B-D-D-D-A
- Cada sección se repite un número variable de veces, siempre en **potencias de 2** (1, 2, 4, 8, 16…)

## Recapitulación
- Momentos en que la célula original (o una variación) vuelve a sonar
- El punto de recapitulación se elige **al azar** entre dos opciones:
  1. Reinciar desde la célula original
  2. Reanudar desde una variación

## Pistas (Tracks)
- Cada pista está asociada a un **instrumento** (preset)
- El contenido de cada pista siempre es **relativo a la célula en curso**
- En cada sección de la forma, cada pista puede:
  - Tocar una variación
  - Estar en **silencio**
- No todas las pistas suenan simultáneamente

## Instrumentos (Presets Web Audio API)
1. Synth — onda sinusoidal/triangular, limpio, voz principal
2. FMSynth — FM, timbre metálico/brillante
3. AMSynth — modulación de amplitud, texturas pulsantes
4. MonoSynth — subtractivo, cálido, versátil
5. DuoSynth — doble oscilador con chorus, rico
6. PluckSynth — percusivo, acentos rítmicos
7. SynthPair — dos osciladores en paralelo, ambiental

Selección mediante selector de presets.

---

## Visualización
- **Grilla / Piano roll**, vista única que muestra toda la pieza
- **Cursor** con autoscroll durante la reproducción
- Sin interacción con la grilla durante el playback (por ahora)
- Exportación de partitura: **pendiente**

## Controles (Topbar)
| Control | Tipo | Descripción |
|---|---|---|
| Inicio / Parada | Botones | Start / Stop |
| Tempo | Slider | Tempo fijo, ajustable manualmente |
| Cantidad de pistas | Slider | Número de tracks generados |
| Duración | Slider | Longitud total de la pieza |
| Auto-generación | Checkbox | Regenerar pieza automáticamente |
| Auto-reinicio | Checkbox | Reiniciar la pieza al finalizar |
| Generar | Botón | Generar nueva pieza |
| Forma | Selector | Elegir esquema formal |
| Preset instrumento | Selector | Elegir presets de instrumentos |

## Reproducción
- Todo se **pre-genera linealmente** antes de reproducir
- Sin interacción con la pieza durante la reproducción (por ahora)
- Cursor avanza con autoscroll por la grilla