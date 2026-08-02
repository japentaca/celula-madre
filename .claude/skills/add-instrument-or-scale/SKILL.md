---
name: add-instrument-or-scale
description: Añadir un preset de instrumento (sinte Tone.js) o una escala musical a la app. Usar cuando se pida un nuevo timbre, sonido, sintetizador, escala o modo.
---

# Añadir instrumentos o escalas

## Nuevo preset de instrumento

Tocar dos archivos:

1. **`js/audio.js`** — añadir una entrada al objeto `PRESETS`: una fábrica sin
   argumentos que devuelve un sinte de Tone.js nuevo en cada llamada.
   `AudioEngine.PRESETS` (la lista de nombres) y el panel de pistas se derivan
   solos de las claves del objeto. Añadir también su entrada en `PRESET_TRIMS`
   (dB de compensación de sonoridad): medir el RMS con `Tone.Offline` (notas
   C3/C4/C5, velocity 0.7, igual que los trims existentes) y ajustar hacia el
   objetivo común de RMS ~0.13.
2. **`index.html`** — añadir `<option value="Nombre">Nombre</option>` al
   `<select id="select-preset">` del topbar (este selector es estático).

Restricciones:
- La fábrica debe crear **una instancia nueva por llamada**: cada pista recibe
  la suya y compartirlas rompe el retrigger de sintes monofónicos.
- El sinte debe soportar `triggerAttackRelease(freq, dur, time, velocity)` y
  `dispose()` (cualquier instrumento estándar de Tone.js los tiene).
- Envolventes cortas de ataque (~0.01) como los presets actuales, para que el
  patrón rítmico de 16avos se articule.
- Ojo con los polifónicos pesados (`PolySynth`) si hay 8 pistas: probar carga.

## Nueva escala

Tocar dos archivos:

1. **`js/generator.js`** — añadir la entrada a `SCALES`: array de intervalos en
   semitonos desde la tónica, ascendente, empezando en 0, sin llegar a 12
   (p. ej. dórica: `[0, 2, 3, 5, 7, 9, 10]`). No hace falta que tenga 7 notas
   (la pentatónica tiene 5); `degreeToMidi` calcula las octavas a partir del
   largo del array.
2. **`index.html`** — añadir `<option value="clave">Nombre en español</option>`
   al `<select id="select-scale">`.

Nota: el cambio de escala/tonalidad se aplica **en vivo** sobre la pieza actual
(`Composer.retune` re-mapea grados a MIDI sin regenerar), así que una escala
nueva se puede probar sobre la misma pieza cambiando el selector durante la
reproducción.

## Verificación

- Escalas: con la skill `test-generator`, comprobar `degreeToMidi` para la
  escala nueva con grados en [-7, 7] y tonalidades 0–11 (MIDI ~24–108),
  incluyendo los `keyOffset` de modulación que suma el compositor.
- Presets: con la skill `run-app`, elegir el preset en el topbar o en una pista
  del panel lateral y reproducir; vigilar la consola por errores de retrigger.
