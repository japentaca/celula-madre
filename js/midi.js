const MidiEngine = (() => {
  let access = null;
  let output = null;
  let trackChannels = []; // canal MIDI (1-16) por pista
  let onDevicesChanged = null;
  // 'canal:nota' -> timestamp ms (performance.now) en que acaba la última nota
  // disparada; permite mandar note-offs explícitos al parar (acotado a 16×128)
  const activeNotes = new Map();

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
  // programa en milisegundos de performance.now(). La correspondencia sale de
  // getOutputTimestamp() del AudioContext nativo (Tone lo envuelve en
  // standardized-audio-context, que no lo expone): un par coherente de tiempos
  // con ~0,5 ms de dispersión, que además alinea el MIDI con lo que suena por
  // la salida de audio (incluye su latencia). Restar currentTime a
  // performance.now() bailaba ~3 ms (currentTime avanza a saltos de buffer) y
  // el reloj MIDI medido, ±1,5 BPM. Un promedio corto ponderado por tiempo
  // quita el resto; un salto grande (contexto suspendido) lo reinicia
  const OFFSET_TAU_MS = 1000;
  const OFFSET_RESET_MS = 50;
  let perfOffset = null;
  let offsetSamples = 0;
  let lastOffsetAt = 0;

  function offsetSample(now) {
    const raw = Tone.context.rawContext;
    const native = raw && (raw._nativeAudioContext || raw._nativeContext);
    if (native && native.getOutputTimestamp) {
      const ts = native.getOutputTimestamp();
      if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.performanceTime - ts.contextTime * 1000;
    }
    return now - Tone.context.currentTime * 1000;
  }

  function toMidiTimestamp(time) {
    const now = performance.now();
    const sample = offsetSample(now);
    if (perfOffset === null || Math.abs(sample - perfOffset) > OFFSET_RESET_MS) {
      perfOffset = sample;
      offsetSamples = 1;
    } else {
      offsetSamples++;
      const alpha = Math.max(1 - Math.exp(-(now - lastOffsetAt) / OFFSET_TAU_MS), 1 / offsetSamples);
      perfOffset += (sample - perfOffset) * alpha;
    }
    lastOffsetAt = now;
    return Math.max(now, perfOffset + time * 1000);
  }

  function playNote(trackIndex, midi, time, durationSeconds, velocity) {
    if (!output || midi < 0 || midi > 127) return;
    const channel = ((trackChannels[trackIndex] || 1) - 1) & 0x0f;
    const vel = Math.max(1, Math.min(127, Math.round(velocity * 127)));
    const at = toMidiTimestamp(time);
    const end = at + durationSeconds * 1000;
    try {
      output.send([0x90 | channel, midi, vel], at);
      output.send([0x80 | channel, midi, 0], end);
      const key = channel + ':' + midi;
      const prev = activeNotes.get(key);
      if (!prev || end > prev) activeNotes.set(key, end);
    } catch (e) { /* puerto cerrado o mensaje inválido: nota descartada */ }
  }

  // Al parar: descarta los mensajes ya encolados con timestamp futuro y
  // silencia lo que esté sonando; sin esto quedan notas colgadas en el VST.
  // Note-offs explícitos por nota además de CC 123/120: muchos VSTs ignoran
  // los mensajes de modo de canal
  function allNotesOff() {
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
      clockSent = true;
      clockPending = null;
    } else if (clockPending === 'start') {
      send([START], at);
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
  // Reanudar desde un paso > 0 manda song position + continue
  function startClock(step) {
    stopIdleClock();
    clockRunning = true;
    clockStartStep = Math.max(0, Math.floor(step || 0));
    clockPending = clockStartStep > 0 ? 'continue' : 'start';
    if (clockEventId !== null) Tone.Transport.clear(clockEventId);
    clockEventId = null;
    updateClock();
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
