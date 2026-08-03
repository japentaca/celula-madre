# célula madre

Aplicación web de música generativa: compone piezas a partir de una **célula
binaria madre** y sus variaciones, las distribuye en pistas y secciones
formales (A-B-A…), y las reproduce con Tone.js mientras dibuja la partitura en
un piano roll 2D o en cuatro visualizaciones 3D. Toda la pieza se pre-computa
antes de reproducir; no hay generación en tiempo real.

JavaScript vanilla, sin build, sin npm, sin frameworks. Tone.js y THREE.js se
cargan por CDN.

## Cómo funciona

1. **Célula madre** — se genera una célula rítmico-melódica (largo siempre
   potencia de 2) cuyo perfil de alturas sale de un algoritmo de *contorno
   orgánico* (arco, fractal, espiral…), elegible desde la UI.
2. **Variaciones** — la célula se transforma (invertir, rotar, retrogradar,
   re-contornear…) para producir una familia de motivos emparentados.
3. **Forma** — los motivos se reparten en secciones (A-A-B-A…) y bloques por
   pista, con recapitulación y un plan tonal en arco por el círculo de
   quintas: la pieza se aleja de la tónica hasta un clímax y regresa,
   modulando solo en fronteras de sección.
4. **Pases de refinamiento** — sobre la pieza compuesta corren tres pases:
   *humanización* (notas de paso, articulación, arcos de dinámica,
   respiraciones), *equilibrio de energía* (poda ataques del fondo con una
   curva de tensión en arco) y *contrapunto* (resuelve disonancias duras
   entre pistas de forma determinista).
5. **Reproducción** — cada nota se despacha a la vez al motor de audio
   (Tone.js) y a la salida MIDI (Web MIDI, hacia VSTs o hardware); cada motor
   decide si suena.

Las notas trabajan en **grados de escala**, no en semitonos: cambiar escala o
tonalidad (*retune*) re-mapea la pieza existente sin regenerarla, incluso
durante la reproducción.

## Características

- Selección de escala, tonalidad, tempo (en vivo), forma y contornos
  permitidos.
- Mezclador por pista: preset de sinte, volumen, paneo, envíos a
  reverb/delay, canal MIDI.
- Editor de sintetizador por pista con cadena de efectos de inserción
  reordenable y presets de usuario (localStorage, export/import JSON).
- Piano roll 2D con colores por motivo, y cuatro vistas 3D con bloom y
  cámara con seguimiento: ciudad de notas, túnel helicoidal (una vuelta =
  una célula), terreno orgánico y constelación de partículas.
- Salida Web MIDI con timestamps precisos y apagado limpio de notas al parar.

## Ejecutar

No funciona desde `file://` (Tone.js necesita contexto seguro). Servir por
HTTP local desde la raíz del repo:

```sh
python -m http.server 8000
```

y abrir <http://localhost:8000>. Vale cualquier servidor estático; no hay
dependencias que instalar.

Requiere un navegador moderno. La salida MIDI necesita Web MIDI (Chrome/Edge);
sin ella la app funciona solo con audio.

## Estructura

| Módulo | Responsabilidad |
|---|---|
| `js/generator.js` | Material musical: célula madre, contornos, variaciones, formas, escalas, grados→MIDI |
| `js/composer.js` | Composición lineal (secciones, bloques, recapitulación) y transporte |
| `js/humanizer.js` | Pase de humanización sobre la pieza compuesta |
| `js/energy.js` | Pase de equilibrio de densidad con curva de tensión |
| `js/counterpoint.js` | Pase determinista de consonancia vertical entre pistas |
| `js/audio.js` | Grafo de audio Tone.js: sintes, efectos, envíos, master |
| `js/syntheditor.js` | Editor modal de sinte y efectos por pista |
| `js/midi.js` | Salida Web MIDI |
| `js/visualizer.js` | Piano roll 2D en canvas |
| `js/visualizer3d.js` | Vistas 3D con THREE.js |
| `js/app.js` | UI y orquestación |

La referencia técnica detallada (modelo de datos, invariantes, convenciones)
está en [AGENTS.md](AGENTS.md).
