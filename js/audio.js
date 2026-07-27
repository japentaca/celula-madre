const AudioEngine = (() => {
  let masterGain = null;
  let synthMap = {};
  let isInitialized = false;

  const PRESETS = {
    Synth: () => new Tone.Synth({ oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    FMSynth: () => new Tone.FMSynth({ harmonicity: 2, modulationIndex: 2, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    AMSynth: () => new Tone.AMSynth({ harmonicity: 2, oscillator: { type: 'sine' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, modulation: { type: 'square' }, modulationEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }),
    MonoSynth: () => new Tone.MonoSynth({ filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 }, oscillator: { type: 'sawtooth' } }),
    DuoSynth: () => new Tone.DuoSynth({ voice0: { oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }, voice1: { oscillator: { type: 'square' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } }, vibratoRate: 5, vibratoDepth: 0.5 }),
    PluckSynth: () => new Tone.PluckSynth({ attack: 0.01, decay: 0.5, resonance: 0.6, exponent: 2 }),
    MembraneSynth: () => new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 6, envelope: { attack: 0.001, decay: 0.5, sustain: 0.01, release: 0.1 } }),
    SynthPair: () => new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.2 } })
  };

  async function init() {
    if (isInitialized) return;
    await Tone.start();
    masterGain = new Tone.Gain(0.5).toDestination();
    synthMap = {};
    for (const name of Object.keys(PRESETS)) {
      synthMap[name] = PRESETS[name]();
      synthMap[name].connect(masterGain);
    }
    Tone.Transport.bpm.value = 120;
    isInitialized = true;
  }

  function getSynth(presetName) {
    return synthMap[presetName] || synthMap['Synth'];
  }

  function setTempo(bpm) {
    Tone.Transport.bpm.value = bpm;
  }

  function setMasterVolume(vol) {
    if (masterGain) masterGain.gain.value = vol;
  }

  function playNote(presetName, note, time, duration, velocity) {
    const synth = getSynth(presetName);
    synth.triggerAttackRelease(note, duration, time, velocity);
  }

  function stopAll() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    for (const name of Object.keys(synthMap)) {
      try { synthMap[name].disconnect(); } catch (e) { /* ignore */ }
    }
  }

  function dispose() {
    stopAll();
    for (const name of Object.keys(synthMap)) {
      try { synthMap[name].dispose(); } catch (e) { /* ignore */ }
    }
    if (masterGain) masterGain.dispose();
    synthMap = {};
    isInitialized = false;
  }

  return { init, getSynth, setTempo, setMasterVolume, playNote, stopAll, dispose, PRESETS: Object.keys(PRESETS) };
})();