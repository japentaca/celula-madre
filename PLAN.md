# Plan de Desarrollo — Música Generativa Algorítmica

## Fase 1: Setup del proyecto
- [ ] Inicializar proyecto (HTML, CSS, JS vanilla, Tone.js via CDN o npm)
- [ ] Estructura de carpetas
- [ ] Archivo HTML base con layout (topbar + grilla)
- [ ] Commit inicial

## Fase 2: Motor de audio
- [ ] Integrar Tone.js
- [ ] Implementar 8 presets de instrumentos (Synth, FMSynth, AMSynth, MonoSynth, DuoSynth, PluckSynth, MembraneSynth, SynthPair)
- [ ] Configurar salida master (master gain, salida a altavoces)
- [ ] Slider de tempo conectado al Transport de Tone.js

## Fase 3: Generación de célula y modificadores
- [ ] Algoritmo de generación de célula madre (longitud 16/32/64/128/256)
- [ ] Generación de alturas respetando escala y tonalidad seleccionada
- [ ] Generación de modificadores (máscara binaria + variaciones aleatorias sobre nota, altura, velocidad)
- [ ] Generación de 2-4 motivos/células derivados de la madre

## Fase 4: Escala, tonalidad y ciclo de quintas
- [ ] Selector de escala en la UI (escala mayor, menor, etc.)
- [ ] Selector de tonalidad inicial
- [ ] Lógica de desplazamiento en el círculo de quintas (8, 16, 32 pasos)

## Fase 5: Estructura formal y pistas
- [ ] Generador de formas aleatorias (A-B-A, A-B-C-B-D-D-D-A, etc.)
- [ ] Longitudes de sección en potencias de 2
- [ ] Mapeo de variaciones a pistas por sección
- [ ] Lógica de recapitulación (reinicio o retomar variación, al azar)
- [ ] Soporte de silencio por pista en cada sección

## Fase 6: Composición lineal y reproducción
- [ ] Composición lineal de todas las pistas antes del playback
- [ ] Engine de reproducción (play, stop)
- [ ] Checkboxes: auto-generación y auto-reinicio
- [ ] Slider de duración total de la pieza

## Fase 7: Visualización
- [ ] Renderizado de la grilla/piano roll de toda la pieza
- [ ] Cursor con autoscroll durante reproducción
- [ ] Indicación visual de célula madre vs variaciones
- [ ] Indicación de secciones de la forma

## Fase 8: UI y controles
- [ ] Layout de topbar con todos los controles
- [ ] Slider de cantidad de pistas
- [ ] Selector de forma
- [ ] Selector de presets de instrumentos
- [ ] Botón de generación de nueva pieza
- [ ] Slider de tempo
- [ ] Slider de duración

## Fase 9: Testing y pulido
- [ ] Testing de flujo completo (generar → reproducir → parar)
- [ ] Verificar que todas las combinaciones de scales/keys funcionen
- [ ] Verificar que las variaciones suenen coherentes
- [ ] Ajustes de latencia y rendimiento
- [ ] Responsive / accesibilidad básica

## Fase 10: Post-lanzamiento (backlog)
- [ ] Exportación de audio (WAV/MP3)
- [ ] Exportación/importación de datos (JSON)
- [ ] Vista de partitura
- [ ] Interacción durante el playback (editar célula, disparar variaciones)
- [ ] Detalle de modificadores (agregar más tipos)