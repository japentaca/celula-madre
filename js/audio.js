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

  // Presets ricos en armónicos para la pista grave (Composer.trackRegisters
  // −1): una senoidal en Do2 apenas suena en altavoces normales, mientras que
  // la sierra filtrada y la FM se oyen por sus armónicos aunque falte la
  // fundamental. App solo los impone cuando el preset de la pista es aleatorio
  const BASS_PRESETS = ['MonoSynth', 'FMSynth'];

  // Catálogo de efectos de inserción por pista (cadena sinte→fx→panner).
  // Los nombres deben coincidir con FX_SCHEMAS de syntheditor.js
  const EFFECTS = {
    Filter: opts => new Tone.Filter(opts),
    AutoFilter: opts => new Tone.AutoFilter(opts),
    Chorus: opts => new Tone.Chorus(opts),
    Phaser: opts => new Tone.Phaser(opts),
    Tremolo: opts => new Tone.Tremolo(opts),
    Vibrato: opts => new Tone.Vibrato(opts),
    Distortion: opts => new Tone.Distortion(opts),
    BitCrusher: opts => new Tone.BitCrusher(opts)
  };

  function makeEffect(spec) {
    const factory = EFFECTS[spec.type];
    if (!factory) return null;
    const node = factory(spec.params || {});
    // AutoFilter, Chorus y Tremolo llevan un LFO que hay que arrancar a mano
    if (typeof node.start === 'function') node.start();
    return node;
  }

  function buildChain(preset) {
    if (typeof preset !== 'object' || !preset.chain) return [];
    return preset.chain.map(makeEffect).filter(Boolean);
  }

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

  // Sin gesto previo del usuario el navegador deja el contexto suspendido
  // (salvo políticas de autoplay permisivas, p. ej. un kiosco con
  // --autoplay-policy=no-user-gesture-required)
  function isRunning() {
    return Tone.context.state === 'running';
  }

  // preset: nombre de fábrica o definición { base, params, chain } (preset de
  // usuario o edición en vivo del editor de sintes)
  function makeSynth(preset) {
    const def = typeof preset === 'string' ? { base: preset } : preset;
    const factory = PRESETS[def.base] || PRESETS.Synth;
    const synth = factory();
    const params = def.params ? { ...def.params } : null;
    // volume siempre directo al nodo de salida: en PolySynth set() lo repartiría
    // a las voces y dejaría intacta la salida, que es donde vive el trim
    if (params && params.volume !== undefined) {
      synth.volume.value = params.volume;
      delete params.volume;
    } else {
      const trim = PRESET_TRIMS[PRESETS[def.base] ? def.base : 'Synth'];
      if (trim) synth.volume.value = trim;
    }
    if (params && Object.keys(params).length) synth.set(params);
    return synth;
  }

  // Conecta sinte→cadena de inserción→panner; el paneo va antes del canal (y
  // por tanto de los envíos) para que reverb y delay conserven la posición
  // estéreo de la pista
  function wireTrack(track) {
    try { track.synth.disconnect(); } catch (e) { /* ignore */ }
    for (const node of track.chain) {
      try { node.disconnect(); } catch (e) { /* ignore */ }
    }
    let prev = track.synth;
    for (const node of track.chain) {
      prev.connect(node);
      prev = node;
    }
    prev.connect(track.panner);
  }

  function disposeTrack(track) {
    try { track.synth.dispose(); } catch (e) { /* ignore */ }
    for (const node of track.chain) {
      try { node.dispose(); } catch (e) { /* ignore */ }
    }
    try { track.panner.dispose(); } catch (e) { /* ignore */ }
    try { track.channel.dispose(); } catch (e) { /* ignore */ }
    try { track.revSend.dispose(); } catch (e) { /* ignore */ }
    try { track.delSend.dispose(); } catch (e) { /* ignore */ }
  }

  // Pistas de la pieza anterior: desecharlas en seco cortaría las colas de
  // release de las últimas notas (y las notas en vuelo si se regenera en plena
  // reproducción). Se desvanece el canal (los envíos, post-fader, lo siguen)
  // y se desechan al terminar
  const RETIRE_FADE = 4;

  function retireTrack(track) {
    const now = Tone.now();
    try {
      track.channel.gain.cancelScheduledValues(now);
      track.channel.gain.rampTo(0, RETIRE_FADE, now);
    } catch (e) { /* ignore */ }
    setTimeout(() => disposeTrack(track), (RETIRE_FADE + 0.5) * 1000);
  }

  // configs: [{ preset, volume, reverb, delay, pan }] — una instancia de sinte por pista
  // (instancias compartidas provocan errores de retrigger en sintes monofónicos)
  function setupTracks(configs) {
    ensureGraph();
    for (const track of tracks) retireTrack(track);
    tracks = configs.map(cfg => {
      const channel = new Tone.Gain(cfg.volume);
      channel.connect(masterGain);
      const revSend = new Tone.Gain(cfg.reverb);
      revSend.connect(reverb);
      const delSend = new Tone.Gain(cfg.delay);
      delSend.connect(delay);
      // Envíos post-fader: cuelgan del canal, así que el volumen de la pista
      // escala también lo que manda a reverb y delay (fader a 0 = pista muda,
      // sin efecto suelto)
      channel.connect(revSend);
      channel.connect(delSend);
      const panner = new Tone.Panner(cfg.pan || 0);
      panner.connect(channel);
      const track = {
        synth: makeSynth(cfg.preset),
        presetName: typeof cfg.preset === 'string' ? cfg.preset : cfg.preset.base,
        chain: buildChain(cfg.preset),
        panner, channel, revSend, delSend,
        // Niveles del usuario: fadeOutTracks baja el canal y
        // restoreTrackLevels vuelve a su nivel
        levels: { channel: cfg.volume, revSend: cfg.reverb, delSend: cfg.delay },
        faded: false
      };
      wireTrack(track);
      return track;
    });
  }

  function setTrackPreset(index, preset) {
    const track = tracks[index];
    if (!track) return;
    try { track.synth.dispose(); } catch (e) { /* ignore */ }
    track.synth = makeSynth(preset);
    track.presetName = typeof preset === 'string' ? preset : preset.base;
    // una definición completa reemplaza también la cadena; un nombre la conserva
    if (typeof preset === 'object' && preset.chain) setTrackChain(index, preset.chain);
    else wireTrack(track);
  }

  // Cambios parciales en vivo sobre el sinte de una pista (editor de sintes)
  function setTrackSynthParams(index, params) {
    const track = tracks[index];
    if (!track) return;
    const rest = { ...params };
    if (rest.volume !== undefined) {
      track.synth.volume.value = rest.volume;
      delete rest.volume;
    }
    if (Object.keys(rest).length) track.synth.set(rest);
  }

  function getTrackSynthParams(index) {
    const track = tracks[index];
    if (!track) return null;
    let params = {};
    try { params = track.synth.get(); } catch (e) { /* algunos sintes pueden fallar en get() */ }
    return { ...params, volume: track.synth.volume.value };
  }

  // Reemplaza la cadena de inserción completa (añadir/quitar/reordenar recrea
  // los nodos; los parámetros vienen en el spec, así que no se pierde estado)
  function setTrackChain(index, chainSpec) {
    const track = tracks[index];
    if (!track) return;
    for (const node of track.chain) {
      try { node.dispose(); } catch (e) { /* ignore */ }
    }
    track.chain = (chainSpec || []).map(makeEffect).filter(Boolean);
    wireTrack(track);
  }

  function setTrackEffectParams(index, fxIndex, params) {
    const node = tracks[index] && tracks[index].chain[fxIndex];
    if (node) node.set(params);
  }

  // Durante la coda solo se guarda el nivel: aplicarlo cortaría el fundido
  function setTrackLevel(index, node, value) {
    const track = tracks[index];
    if (!track) return;
    track.levels[node] = value;
    // Durante la coda el canal está en rampa a 0: su nivel se repone al
    // reanudar. Los envíos no se desvanecen y se aplican en el acto
    if (!track.faded || node !== 'channel') track[node].gain.value = value;
  }

  function setTrackVolume(index, value) {
    setTrackLevel(index, 'channel', value);
  }

  function setTrackReverb(index, value) {
    setTrackLevel(index, 'revSend', value);
  }

  function setTrackDelay(index, value) {
    setTrackLevel(index, 'delSend', value);
  }

  // Coda del final de pieza: baja el canal de cada pista (los envíos,
  // post-fader, lo siguen sin atenuarse dos veces); los buses de reverb y
  // delay siguen y dejan su cola natural
  function fadeOutTracks(time, seconds) {
    for (const track of tracks) {
      track.faded = true;
      try {
        const gain = track.channel.gain;
        gain.cancelScheduledValues(time);
        gain.setValueAtTime(gain.getValueAtTime(time), time);
        gain.linearRampToValueAtTime(0, time + seconds);
      } catch (e) { /* ignore */ }
    }
  }

  function restoreTrackLevels(time) {
    const at = time === undefined ? Tone.now() : time;
    for (const track of tracks) {
      if (!track.faded) continue;
      track.faded = false;
      try {
        const gain = track.channel.gain;
        gain.cancelScheduledValues(at);
        gain.rampTo(track.levels.channel, 0.05, at);
      } catch (e) { /* ignore */ }
    }
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
    isRunning,
    setupTracks,
    setTrackPreset,
    setTrackSynthParams,
    getTrackSynthParams,
    setTrackChain,
    setTrackEffectParams,
    setTrackVolume,
    fadeOutTracks,
    restoreTrackLevels,
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
    BASS_PRESETS,
    DELAY_SUBDIVISIONS,
    DEFAULT_DELAY_SUBDIVISION,
    DEFAULT_DELAY_FEEDBACK,
    DEFAULT_REVERB_DECAY,
    DEFAULT_MASTER_VOLUME
  };
})();
