const AudioEngine = (() => {
  let masterGain = null;
  let limiter = null;
  let reverb = null;
  let delay = null;
  let tracks = [];
  let contextStarted = false;
  // Render local WebAudio; se puede apagar desde el topbar cuando la salida
  // deseada es solo MIDI. El Transport sigue corriendo: es el reloj de la app
  let enabled = true;

  // Subdivisiones rítmicas disponibles para el delay, de más lenta a más rápida.
  // El tiempo va atado al tempo, pero Tone lo convierte a segundos al asignarlo,
  // así que hay que re-evaluarlo en cada cambio de BPM (ver setTempo)
  const DELAY_SUBDIVISIONS = [
    { time: '1n', label: '1' },
    { time: '2n.', label: '1/2·' },
    { time: '2n', label: '1/2' },
    { time: '4n.', label: '1/4·' },
    { time: '4n', label: '1/4' },
    { time: '8n.', label: '1/8·' },
    { time: '8n', label: '1/8' },
    { time: '16n.', label: '1/16·' },
    { time: '16n', label: '1/16' },
    { time: '32n', label: '1/32' }
  ];
  const DEFAULT_DELAY_SUBDIVISION = 5; // '8n.'
  let delayTime = DELAY_SUBDIVISIONS[DEFAULT_DELAY_SUBDIVISION].time;
  const DEFAULT_DELAY_FEEDBACK = 0.35;
  let delayFeedback = DEFAULT_DELAY_FEEDBACK;
  const DEFAULT_REVERB_DECAY = 3; // segundos
  let reverbDecay = DEFAULT_REVERB_DECAY;
  const DEFAULT_MASTER_VOLUME = 0.6;

  const PRESETS = {
    Synth: () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    FMSynth: () => new Tone.FMSynth({ harmonicity: 2, modulationIndex: 2, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    AMSynth: () => new Tone.AMSynth({ harmonicity: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulation: { type: 'square' }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    MonoSynth: () => new Tone.MonoSynth({ filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, oscillator: { type: 'sawtooth' } }),
    SynthPair: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } })
  };

  // Compensación de sonoridad por preset (dB sobre synth.volume), medida por RMS
  // con render offline (notas C3/C4/C5, velocity 0.7) hacia un objetivo común
  // de ~0.13; sin esto hay hasta 16 dB de diferencia entre presets
  const PRESET_TRIMS = { Synth: -3, FMSynth: 7, AMSynth: 13, MonoSynth: 0, SynthPair: -1.5 };

  function ensureGraph() {
    if (masterGain) return;
    // Limitador al final de la cadena: con varias pistas sumándose (sobre todo
    // senoidales puras) la suma pasa de 0 dBFS y el DAC recorta con distorsión dura
    limiter = new Tone.Limiter(-1).toDestination();
    masterGain = new Tone.Gain(DEFAULT_MASTER_VOLUME).connect(limiter);
    reverb = new Tone.Reverb({ decay: reverbDecay, wet: 1 });
    reverb.generate();
    reverb.connect(masterGain);
    delay = new Tone.PingPongDelay({ delayTime, feedback: delayFeedback, wet: 1 });
    delay.connect(masterGain);
  }

  // Requiere gesto del usuario; se llama desde Play
  async function init() {
    if (contextStarted) return;
    try {
      await Tone.start();
      contextStarted = true;
    } catch (e) {
      console.error('Tone.js no puede inicializarse. Abre el archivo desde un servidor HTTP (localhost) o HTTPS, no desde file://', e);
    }
  }

  function makeSynth(name) {
    const factory = PRESETS[name] || PRESETS.Synth;
    const synth = factory();
    const trim = PRESET_TRIMS[PRESETS[name] ? name : 'Synth'];
    if (trim) synth.volume.value = trim;
    return synth;
  }

  // El paneo va antes del canal y de los envíos para que reverb y delay
  // conserven la posición estéreo de la pista
  function connectSynth(track) {
    track.synth.connect(track.panner);
  }

  function disposeTrack(track) {
    try { track.synth.dispose(); } catch (e) { /* ignore */ }
    try { track.panner.dispose(); } catch (e) { /* ignore */ }
    try { track.channel.dispose(); } catch (e) { /* ignore */ }
    try { track.revSend.dispose(); } catch (e) { /* ignore */ }
    try { track.delSend.dispose(); } catch (e) { /* ignore */ }
  }

  // configs: [{ preset, volume, reverb, delay, pan }] — una instancia de sinte por pista
  // (instancias compartidas provocan errores de retrigger en sintes monofónicos)
  function setupTracks(configs) {
    ensureGraph();
    for (const track of tracks) disposeTrack(track);
    tracks = configs.map(cfg => {
      const channel = new Tone.Gain(cfg.volume);
      channel.connect(masterGain);
      const revSend = new Tone.Gain(cfg.reverb);
      revSend.connect(reverb);
      const delSend = new Tone.Gain(cfg.delay);
      delSend.connect(delay);
      const panner = new Tone.Panner(cfg.pan || 0);
      panner.connect(channel);
      panner.connect(revSend);
      panner.connect(delSend);
      const track = { synth: makeSynth(cfg.preset), presetName: cfg.preset, panner, channel, revSend, delSend };
      connectSynth(track);
      return track;
    });
  }

  function setTrackPreset(index, name) {
    const track = tracks[index];
    if (!track) return;
    try { track.synth.dispose(); } catch (e) { /* ignore */ }
    track.synth = makeSynth(name);
    track.presetName = name;
    connectSynth(track);
  }

  function setTrackVolume(index, value) {
    if (tracks[index]) tracks[index].channel.gain.value = value;
  }

  function setTrackReverb(index, value) {
    if (tracks[index]) tracks[index].revSend.gain.value = value;
  }

  function setTrackDelay(index, value) {
    if (tracks[index]) tracks[index].delSend.gain.value = value;
  }

  function setTrackPan(index, value) {
    if (tracks[index]) tracks[index].panner.pan.value = value;
  }

  function setTempo(bpm) {
    Tone.Transport.bpm.value = bpm;
    // Rampa corta: cambiar la línea de retardo de golpe produce un click
    if (delay) delay.delayTime.rampTo(Tone.Time(delayTime).toSeconds(), 0.1);
  }

  function setDelaySubdivision(index) {
    const sub = DELAY_SUBDIVISIONS[index];
    if (!sub) return;
    delayTime = sub.time;
    if (delay) delay.delayTime.rampTo(Tone.Time(delayTime).toSeconds(), 0.1);
  }

  function setDelayFeedback(value) {
    delayFeedback = value;
    if (delay) delay.feedback.rampTo(delayFeedback, 0.1);
  }

  // Cambiar el decay obliga a re-renderizar la respuesta impulsional (asíncrono);
  // el que llama debe espaciar las llamadas (debounce), no es gratis como un gain
  function setReverbDecay(seconds) {
    reverbDecay = seconds;
    if (reverb) {
      reverb.decay = seconds;
      reverb.generate();
    }
  }

  function setMasterVolume(vol) {
    ensureGraph();
    // Rampa corta: saltos bruscos de ganancia producen zipper noise
    masterGain.gain.rampTo(vol, 0.05);
  }

  function setEnabled(value) {
    enabled = value;
  }

  function playNote(trackIndex, midi, time, durationSeconds, velocity) {
    if (!enabled) return;
    const track = tracks[trackIndex];
    if (!track) return;
    try {
      track.synth.triggerAttackRelease(Tone.Frequency(midi, 'midi'), durationSeconds, time, velocity);
    } catch (e) { /* nota descartada si el sinte no puede retriggerar */ }
  }

  function dispose() {
    for (const track of tracks) disposeTrack(track);
    tracks = [];
    for (const node of [reverb, delay, masterGain, limiter]) {
      if (node) node.dispose();
    }
    reverb = null;
    delay = null;
    masterGain = null;
    limiter = null;
  }

  return {
    init,
    setupTracks,
    setTrackPreset,
    setTrackVolume,
    setTrackReverb,
    setTrackDelay,
    setTrackPan,
    setTempo,
    setDelaySubdivision,
    setDelayFeedback,
    setReverbDecay,
    setMasterVolume,
    setEnabled,
    playNote,
    dispose,
    PRESETS: Object.keys(PRESETS),
    DELAY_SUBDIVISIONS,
    DEFAULT_DELAY_SUBDIVISION,
    DEFAULT_DELAY_FEEDBACK,
    DEFAULT_REVERB_DECAY,
    DEFAULT_MASTER_VOLUME
  };
})();
