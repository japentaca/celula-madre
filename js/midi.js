const MidiEngine = (() => {
  let access = null;
  let output = null;
  let trackChannels = []; // canal MIDI (1-16) por pista
  let onDevicesChanged = null;
  // 'canal:nota' -> timestamp ms (performance.now) en que acaba la última nota
  // disparada; permite mandar note-offs explícitos al parar (acotado a 16×128)
  const activeNotes = new Map();

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
    output = (access && id) ? (access.outputs.get(id) || null) : null;
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
  // programa en milisegundos de performance.now(). La deriva entre ambos
  // relojes es despreciable dentro del lookahead del transporte
  function toMidiTimestamp(time) {
    return performance.now() + Math.max(0, time - Tone.context.currentTime) * 1000;
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
    setOnDevicesChanged
  };
})();
