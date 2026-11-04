const MidiEngine = (() => {
  let access = null;
  let output = null;
  let trackChannels = []; // canal MIDI (1-16) por pista
  let onDevicesChanged = null;
  // 'canal:nota' -> timestamp ms (performance.now) en que acaba la última nota
  // disparada; permite mandar note-offs explícitos al parar (acotado a 16×128)
  const activeNotes = new Map();
  // Mute/solo resueltos por App. Por pista, 'canal:nota' -> { start, end }
  // (performance.now) para cortar lo que suena al mutearla
  const mutedTracks = new Set();
  const trackNotes = new Map();

  // ---- Reloj MIDI (0xF8 ×24 por negra, start/continue/stop) ----
  // Sigue al Transport de Tone: cada tick lleva el timestamp de su tiempo de
  // audio, así los cambios de tempo salen solos en el reloj. Solo suena con
  // salida elegida y el ajuste activo
  const CLOCK = 0xF8, START = 0xFA, CONTINUE = 0xFB, STOP = 0xFC, SONG_POSITION = 0xF2;
  const CLOCKS_PER_QUARTER = 24;
  // Margen con que el reloj en reposo encola ticks por delante (ms): cubre el
  // periodo del ticker de Tone (~30 ms) y queda por debajo de su lookAhead
  // (100 ms), así ningún tick en reposo cae después del start de la pieza
  const IDLE_LOOKAHEAD_MS = 80;
  let clockEnabled = true;
  let clockRunning = false;    // el Transport suena (entre startClock y stopClock)
  let clockEventId = null;     // evento repetido del Transport
  let clockPending = null;     // 'start' | 'continue': se manda con el próximo tick
  let clockStartStep = 0;      // paso de la pieza en que arrancó el Transport
  let clockSent = false;       // la salida actual recibió start/continue sin stop
  let lastTickAt = 0;          // timestamp (performance.now) del último 0xF8
  let idleId = null;           // intervalo del reloj en reposo (Tone.context)
  let nextIdleTickAt = 0;
  // Timestamp del último start/continue: las notas del mismo instante salen
  // 1 ms después; con el mismo timestamp el receptor puede ver la nota antes
  // que el start (medido con loopMIDI y --midi-monitor del vst-player)
  let clockStartAt = -Infinity;

  function isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }

  // Pide permiso Web MIDI (puede mostrar aviso del navegador). Idempotente.
  async function init() {
    if (access || !isSupported()) return access;
    try {
      access = await navigator.requestMIDIAccess({ sysex: false });
      access.onstatechange = () => {
        // Si el puerto elegido se desconecta, soltar la selección
        if (output && output.state === 'disconnected') output = null;
        if (onDevicesChanged) onDevicesChanged(getOutputs());
      };
      // Al recargar o cerrar con un puerto en uso Chrome se ha llegado a
      // colgar (loopMIDI con el otro extremo abierto): se descarta lo encolado
      // a futuro, se manda stop y note-offs sin timestamp y se cierra el puerto
      window.addEventListener('pagehide', release);
    } catch (e) {
      console.warn('Web MIDI no disponible o permiso denegado', e);
    }
    return access;
  }

  function getOutputs() {
    if (!access) return [];
    return Array.from(access.outputs.values()).map(o => ({ id: o.id, name: o.name }));
  }

  function selectOutput(id) {
    allNotesOff();
    const next = (access && id) ? (access.outputs.get(id) || null) : null;
    if (next === output) return;
    sendClockStop();
    output = next;
    // En marcha, la salida nueva se suma al reloj con continue
    if (clockRunning) clockPending = 'continue';
    updateClock();
  }

  function hasOutput() {
    return !!output;
  }

  function setTrackChannels(channels) {
    trackChannels = channels.slice();
  }

  function setTrackChannel(index, channel) {
    trackChannels[index] = channel;
  }

  // `time` llega en segundos del AudioContext (dominio de Tone); Web MIDI
  // programa en milisegundos de performance.now(). Restar currentTime a
  // performance.now() baila ~3 ms (currentTime avanza a saltos de buffer) y el
  // reloj MIDI medido bailaba ±1,5 BPM. La correspondencia sale de
  // getOutputTimestamp() del AudioContext nativo (Tone lo envuelve en
  // standardized-audio-context, que no lo expone): un par coherente de tiempos
  // con ~0,5 ms de dispersión, suavizado con un promedio ponderado por tiempo
  // (τ 4 s: un corrimiento del reloj de audio, p. ej. ~10 ms tras un corte, se
  // reparte en varios segundos en vez de torcer el tempo); un salto grande
  // (contexto suspendido) lo reinicia.
  // getOutputTimestamp mide lo que sale por los parlantes: se le resta la
  // latencia de salida (fija desde cada reinicio) para que el MIDI salga
  // cuando Tone programa el audio, como con la fórmula vieja, sin el atraso
  // de ~55 ms (el audio web se silencia con salida MIDI: no hay que alinearlo)
  const OFFSET_TAU_MS = 4000;
  const OFFSET_RESET_MS = 50;
  let perfOffset = null;
  let offsetSamples = 0;
  let lastOffsetAt = 0;
  let outputLatencyMs = 0;
  // Último tiempo convertido: los eventos de un mismo instante de audio (el
  // tick con el start y las notas del primer paso) reciben el mismo timestamp,
  // así el suavizado entre llamada y llamada no puede adelantar una nota al start
  let lastTime = null;
  let lastStamp = 0;

  function nativeContext() {
    const raw = Tone.context.rawContext;
    return raw && (raw._nativeAudioContext || raw._nativeContext);
  }

  function offsetSample(now) {
    const native = nativeContext();
    if (native && native.getOutputTimestamp) {
      const ts = native.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.performanceTime - ts.contextTime * 1000;
    }
    return null;
  }

  function toMidiTimestamp(time) {
    const now = performance.now();
    if (lastTime !== null && Math.abs(time - lastTime) < 1e-6) return Math.max(now, lastStamp);
    const sample = offsetSample(now);
    if (sample === null) {
      perfOffset = null;
      return Math.max(now, now + (time - Tone.context.currentTime) * 1000);
    }
    if (perfOffset === null || Math.abs(sample - perfOffset) > OFFSET_RESET_MS) {
      perfOffset = sample;
      offsetSamples = 1;
      const native = nativeContext();
      outputLatencyMs = ((native.outputLatency || 0) + (native.baseLatency || 0)) * 1000;
    } else {
      offsetSamples++;
      const alpha = Math.max(1 - Math.exp(-(now - lastOffsetAt) / OFFSET_TAU_MS), 1 / offsetSamples);
      perfOffset += (sample - perfOffset) * alpha;
    }
    lastOffsetAt = now;
    lastTime = time;
    lastStamp = Math.max(now, perfOffset - outputLatencyMs + time * 1000);
    return lastStamp;
  }

  // Al mutear se mandan note-offs a las notas de la pista que no han acabado.
  // Una nota ya encolada que aún no empezó (lookAhead de Tone) recibe el suyo
  // 1 ms tras su note-on: con timestamp anterior el receptor lo descartaría
  // y la nota sonaría entera
  function setTrackMuted(index, muted) {
    if (muted) {
      if (mutedTracks.has(index)) return;
      mutedTracks.add(index);
      const notes = trackNotes.get(index);
      trackNotes.delete(index);
      if (!output || !notes) return;
      const now = performance.now();
      for (const [key, { start, end }] of notes) {
        if (end <= now) continue;
        const [channel, midi] = key.split(':').map(Number);
        send([0x80 | channel, midi, 0], Math.max(now, start + 1));
      }
    } else {
      mutedTracks.delete(index);
    }
  }

  function playNote(trackIndex, midi, time, durationSeconds, velocity) {
    if (!output || midi < 0 || midi > 127 || mutedTracks.has(trackIndex)) return;
    const channel = ((trackChannels[trackIndex] || 1) - 1) & 0x0f;
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const stamp = toMidiTimestamp(time);
    const at = Math.max(stamp, clockStartAt + 1);
    const end = stamp + durationSeconds * 1000;
    try {
      output.send([0x90 | channel, midi, vel], at);
      output.send([0x80 | channel, midi, 0], end);
      const key = channel + ':' + midi;
      const prev = activeNotes.get(key);
      if (!prev || end > prev) activeNotes.set(key, end);
      let notes = trackNotes.get(trackIndex);
      if (!notes) trackNotes.set(trackIndex, notes = new Map());
      notes.set(key, { start: at, end });
    } catch (e) { /* puerto cerrado o mensaje inválido: nota descartada */ }
  }

  // Al parar: descarta los mensajes ya encolados con timestamp futuro y
  // silencia lo que esté sonando; sin esto quedan notas colgadas en el VST.
  // Note-offs explícitos por nota además de CC 123/120: muchos VSTs ignoran
  // los mensajes de modo de canal
  function allNotesOff() {
    trackNotes.clear();
    if (!output) {
      activeNotes.clear();
      return;
    }
    try {
      if (output.clear) output.clear();
      const now = performance.now();
      for (const [key, end] of activeNotes) {
        if (end <= now) continue; // ya recibió su note-off programado
        const [channel, midi] = key.split(':').map(Number);
        output.send([0x80 | channel, midi, 0]);
      }
      for (let ch = 0; ch < 16; ch++) {
        output.send([0xB0 | ch, 123, 0]); // All Notes Off
        output.send([0xB0 | ch, 120, 0]); // All Sound Off
      }
    } catch (e) { /* ignore */ }
    activeNotes.clear();
  }

  function release() {
    stopIdleClock();
    if (!output) return;
    allNotesOff();
    sendClockStop();
    try {
      if (output.close) output.close();
    } catch (e) { /* ignore */ }
  }

  function setOnDevicesChanged(cb) {
    onDevicesChanged = cb;
  }

  // Intervalo del reloj en ticks del Transport (PPQ 192 de Tone → 8i)
  function clockInterval() {
    const ppq = Tone.Transport.PPQ;
    if (ppq % CLOCKS_PER_QUARTER !== 0) {
      console.warn(`Reloj MIDI: PPQ ${ppq} no es múltiplo de 24, el reloj se redondea`);
    }
    return Math.max(1, Math.round(ppq / CLOCKS_PER_QUARTER)) + 'i';
  }

  function send(data, at) {
    try {
      output.send(data, at);
      return true;
    } catch (e) {
      return false; // puerto cerrado: el reloj se pierde, las notas siguen su curso
    }
  }

  function onClockTick(time) {
    if (!output) return;
    const at = toMidiTimestamp(time);
    if (clockPending === 'continue') {
      // La posición (en semicorcheas) solo cae exacta cada 6 ticks: se espera
      // a uno alineado para mandar song position + continue
      const ticks = Tone.Transport.getTicksAtTime(time);
      const sixteenth = Tone.Transport.PPQ / 4;
      const offset = Math.round(ticks / sixteenth * CLOCKS_PER_QUARTER / 4);
      if (offset % (CLOCKS_PER_QUARTER / 4) !== 0) return;
      const position = Math.min(0x3FFF, clockStartStep + offset / (CLOCKS_PER_QUARTER / 4));
      // Song position 1 ms antes: con el mismo timestamp algunos receptores
      // entregan el continue (tiempo real) primero
      send([SONG_POSITION, position & 0x7F, (position >> 7) & 0x7F], Math.max(performance.now(), at - 1));
      send([CONTINUE], at);
      clockStartAt = at;
      clockSent = true;
      clockPending = null;
    } else if (clockPending === 'start') {
      send([START], at);
      clockStartAt = at;
      clockSent = true;
      clockPending = null;
    }
    if (send([CLOCK], at)) lastTickAt = at;
  }

  // Crea o quita el evento repetido según el estado (en marcha, ajuste, salida)
  function updateClock() {
    const wanted = clockRunning && clockEnabled && !!output;
    if (wanted && clockEventId === null) {
      clockEventId = Tone.Transport.scheduleRepeat(onClockTick, clockInterval(), 0);
    } else if (!wanted && clockEventId !== null) {
      Tone.Transport.clear(clockEventId);
      clockEventId = null;
    }
    if (!clockEnabled || !output) stopIdleClock();
  }

  function sendClockStop() {
    if (output && clockSent) send([STOP], performance.now());
    clockSent = false;
  }

  // Lo llama Composer.play tras cancelar el Transport y antes de arrancarlo:
  // el primer tick (y el start) caen en el mismo instante que la primera nota.
  // Reanudar desde un paso > 0 manda song position + continue.
  // Si venía sonando el reloj en reposo devuelve el tiempo de audio en que
  // conviene arrancar el Transport (Composer se lo pasa a Transport.start): el
  // primer tick de la pieza cae en la rejilla del reposo, que se completa hasta
  // ahí. Sin esto el hueco entre el último tick en reposo y el primero de la
  // pieza (hasta ~2 ticks) hacía medir al receptor ~5 % menos de tempo en el
  // primer segundo. Retrasa el arranque menos de un tick
  function startClock(step) {
    const alignedStart = alignToIdleClock();
    stopIdleClock();
    clockRunning = true;
    clockStartStep = Math.max(0, Math.floor(step || 0));
    clockPending = clockStartStep > 0 ? 'continue' : 'start';
    if (clockEventId !== null) Tone.Transport.clear(clockEventId);
    clockEventId = null;
    updateClock();
    return alignedStart;
  }

  function alignToIdleClock() {
    if (idleId === null || !output || !clockEnabled) return undefined;
    const earliest = Tone.now();
    const at = toMidiTimestamp(earliest);
    const period = tickMs();
    const target = nextIdleTickAt + Math.max(0, Math.ceil((at - nextIdleTickAt) / period)) * period;
    if (target - at > period + 1) return undefined; // rejilla vieja: arranque normal
    while (nextIdleTickAt < target - period / 2) {
      if (send([CLOCK], nextIdleTickAt)) lastTickAt = nextIdleTickAt;
      nextIdleTickAt += period;
    }
    return earliest + (target - at) / 1000;
  }

  // Lo llama Composer.stop después de allNotesOff (que puede vaciar la cola
  // de la salida): manda stop si la salida estaba en marcha
  function stopClock() {
    clockRunning = false;
    clockPending = null;
    updateClock();
    sendClockStop();
  }

  // Reloj en reposo para el respiro entre piezas encadenadas: con el Transport
  // parado sigue mandando 0xF8 al tempo actual (sin start), para que el
  // receptor no dé el reloj por perdido y conserve el tempo en las colas
  function keepClockAlive() {
    if (clockRunning || !clockEnabled || !output || idleId !== null) return;
    const now = performance.now();
    nextIdleTickAt = lastTickAt > now - 1000 ? lastTickAt + tickMs() : now;
    idleId = Tone.context.setInterval(idleTick, 0.025);
    idleTick();
  }

  function tickMs() {
    return 60000 / (Tone.Transport.bpm.value * CLOCKS_PER_QUARTER);
  }

  function idleTick() {
    if (!output) return;
    const horizon = performance.now() + IDLE_LOOKAHEAD_MS;
    while (nextIdleTickAt <= horizon) {
      if (send([CLOCK], nextIdleTickAt)) lastTickAt = nextIdleTickAt;
      nextIdleTickAt += tickMs();
    }
  }

  function stopIdleClock() {
    if (idleId === null) return;
    Tone.context.clearInterval(idleId);
    idleId = null;
  }

  function setClockEnabled(on) {
    on = !!on;
    if (on === clockEnabled) return;
    clockEnabled = on;
    if (!on) {
      sendClockStop();
    } else if (clockRunning) {
      clockPending = 'continue';
    }
    updateClock();
  }

  function isClockEnabled() {
    return clockEnabled;
  }

  return {
    isSupported,
    init,
    getOutputs,
    selectOutput,
    hasOutput,
    setTrackChannels,
    setTrackChannel,
    setTrackMuted,
    playNote,
    allNotesOff,
    setOnDevicesChanged,
    startClock,
    stopClock,
    keepClockAlive,
    stopIdleClock,
    setClockEnabled,
    isClockEnabled
  };
})();
