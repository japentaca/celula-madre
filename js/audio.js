const AudioEngine = (() => {
  let masterGain = null;
  let reverb = null;
  let delay = null;
  let tracks = [];
  let contextStarted = false;

  const PRESETS = {
    Synth: () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    FMSynth: () => new Tone.FMSynth({ harmonicity: 2, modulationIndex: 2, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    AMSynth: () => new Tone.AMSynth({ harmonicity: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulation: { type: 'square' }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    MonoSynth: () => new Tone.MonoSynth({ filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, oscillator: { type: 'sawtooth' } }),
    DuoSynth: () => new Tone.DuoSynth({ voice0: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }, voice1: { oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }, vibratoRate: 5, vibratoDepth: 0.5 }),
    PluckSynth: () => new Tone.PluckSynth({ attack: 0.01, decay: 0.5, resonance: 0.6, exponent: 2 }),
    SynthPair: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } })
  };

  function ensureGraph() {
    if (masterGain) return;
    masterGain = new Tone.Gain(0.6).toDestination();
    reverb = new Tone.Reverb({ decay: 3, wet: 1 });
    reverb.generate();
    reverb.connect(masterGain);
    delay = new Tone.PingPongDelay({ delayTime: '8n.', feedback: 0.35, wet: 1 });
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
    return factory();
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
  }

  function setMasterVolume(vol) {
    ensureGraph();
    masterGain.gain.value = vol;
  }

  function playNote(trackIndex, midi, time, durationSeconds, velocity) {
    const track = tracks[trackIndex];
    if (!track) return;
    try {
      track.synth.triggerAttackRelease(Tone.Frequency(midi, 'midi'), durationSeconds, time, velocity);
    } catch (e) { /* nota descartada si el sinte no puede retriggerar */ }
  }

  function dispose() {
    for (const track of tracks) disposeTrack(track);
    tracks = [];
    for (const node of [reverb, delay, masterGain]) {
      if (node) node.dispose();
    }
    reverb = null;
    delay = null;
    masterGain = null;
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
    setMasterVolume,
    playNote,
    dispose,
    PRESETS: Object.keys(PRESETS)
  };
})();
