const App = (() => {
  const state = {
    piece: null,
    // Ajustes por pista (persisten entre generaciones): preset elegido, volumen y envíos
    trackSettings: [],
    // Preset efectivo de cada pista en la pieza actual (resuelto cuando la elección es aleatoria)
    resolvedPresets: []
  };

  const DEFAULT_TRACK_SETTINGS = { preset: 'random', volume: 0.8, reverb: 0.2, delay: 0, pan: 0, panTouched: false };

  // Reparte las pistas por el espectro estéreo: T1 a la izquierda, la última a la derecha
  function spreadPan(trackIndex, numTracks) {
    if (numTracks <= 1) return 0;
    const maxSpread = 0.85;
    return -maxSpread + (2 * maxSpread * trackIndex) / (numTracks - 1);
  }

  function getUIState() {
    return {
      tempo: parseInt(document.getElementById('slider-tempo').value),
      numTracks: parseInt(document.getElementById('slider-tracks').value),
      duration: parseInt(document.getElementById('slider-duration').value),
      preset: document.getElementById('select-preset').value,
      scale: document.getElementById('select-scale').value,
      key: parseInt(document.getElementById('select-key').value),
      formChoice: document.getElementById('select-form').value,
      autogen: document.getElementById('checkbox-autogen').checked,
      autorestart: document.getElementById('checkbox-autorestart').checked
    };
  }

  function updateLabels() {
    const ui = getUIState();
    document.getElementById('val-tempo').textContent = ui.tempo;
    document.getElementById('val-tracks').textContent = ui.numTracks;
    document.getElementById('val-duration').textContent = ui.duration;
  }

  function setupUI() {
    const sliderTempo = document.getElementById('slider-tempo');

    sliderTempo.addEventListener('input', () => {
      updateLabels();
      AudioEngine.setTempo(parseInt(sliderTempo.value));
    });

    document.getElementById('slider-tracks').addEventListener('input', updateLabels);
    document.getElementById('slider-duration').addEventListener('input', updateLabels);

    document.getElementById('btn-generate').addEventListener('click', generate);
    document.getElementById('btn-play').addEventListener('click', play);
    document.getElementById('btn-stop').addEventListener('click', stop);

    // Tonalidad y escala se aplican en vivo sobre la pieza actual
    const retuneCurrent = () => {
      if (!state.piece) return;
      const ui = getUIState();
      Composer.retune(ui.scale, ui.key);
      Visualizer.renderPiece(state.piece);
    };
    document.getElementById('select-key').addEventListener('change', retuneCurrent);
    document.getElementById('select-scale').addEventListener('change', retuneCurrent);

    window.addEventListener('resize', () => {
      if (state.piece) Visualizer.renderPiece(state.piece);
    });
  }

  // Slider de duración (1..8) -> largo de célula: mayor potencia de 2 <= duración*16
  function cellLengthFromDuration(duration) {
    const target = duration * 16;
    const lengths = Generator.CELL_LENGTHS.slice().reverse();
    return lengths.find(l => l <= target) || Generator.CELL_LENGTHS[0];
  }

  function ensureTrackSettings(numTracks) {
    while (state.trackSettings.length < numTracks) {
      state.trackSettings.push({ ...DEFAULT_TRACK_SETTINGS });
    }
  }

  // Prioridad: elección por pista > preset global del topbar > aleatorio
  function resolvePreset(trackIndex, ui) {
    const settings = state.trackSettings[trackIndex];
    if (settings.preset !== 'random') return settings.preset;
    if (ui.preset !== 'random') return ui.preset;
    return Generator.pickRandom(AudioEngine.PRESETS);
  }

  function generate() {
    if (Composer.getIsPlaying()) stop();

    const ui = getUIState();
    AudioEngine.setTempo(ui.tempo);
    ensureTrackSettings(ui.numTracks);

    const cellLength = cellLengthFromDuration(ui.duration);
    const fifthSteps = Generator.randomFifthSteps();

    const motherCell = Generator.generateMotherCell(cellLength);
    // al menos tantas variaciones como pistas para que nunca falte material distinto
    const motifs = Generator.generateMotifs(motherCell, Math.max(4, ui.numTracks));

    const formStr = Generator.generateForm(ui.formChoice);
    const formParts = Generator.parseForm(formStr);

    state.resolvedPresets = [];
    const configs = [];
    for (let t = 0; t < ui.numTracks; t++) {
      const preset = resolvePreset(t, ui);
      const settings = state.trackSettings[t];
      // el reparto estéreo se recalcula salvo que el usuario haya movido el paneo a mano
      if (!settings.panTouched) settings.pan = spreadPan(t, ui.numTracks);
      state.resolvedPresets.push(preset);
      configs.push({ preset, volume: settings.volume, reverb: settings.reverb, delay: settings.delay, pan: settings.pan });
    }
    AudioEngine.setupTracks(configs);

    state.piece = Composer.compose({
      numTracks: ui.numTracks,
      motifs,
      formParts,
      cellLength,
      scale: ui.scale,
      key: ui.key,
      fifthSteps
    });

    Visualizer.renderPiece(state.piece);
    buildTrackPanel(ui.numTracks);
  }

  function randomOptionLabel(trackIndex) {
    const resolved = state.resolvedPresets[trackIndex];
    return resolved ? `Aleatorio (${resolved})` : 'Aleatorio';
  }

  function buildTrackPanel(numTracks) {
    const panel = document.getElementById('track-panel');
    if (!panel) return;

    let html = '<div class="panel-spacer">Pistas</div>';
    for (let t = 0; t < numTracks; t++) {
      const settings = state.trackSettings[t];
      const options = ['random'].concat(AudioEngine.PRESETS).map(p => {
        const label = p === 'random' ? randomOptionLabel(t) : p;
        const selected = settings.preset === p ? ' selected' : '';
        return `<option value="${p}"${selected}>${label}</option>`;
      }).join('');
      html += `
        <div class="track-strip" data-track="${t}">
          <div class="strip-row">
            <span class="strip-label">T${t + 1}</span>
            <select class="strip-preset">${options}</select>
            <span class="mini-label" title="Paneo (izquierda-derecha)">P</span>
            <input class="strip-pan" type="range" min="-1" max="1" step="0.01" value="${settings.pan}">
          </div>
          <div class="strip-row">
            <span class="mini-label" title="Volumen">V</span>
            <input class="strip-vol" type="range" min="0" max="1" step="0.01" value="${settings.volume}">
            <span class="mini-label" title="Envío a reverb">R</span>
            <input class="strip-rev" type="range" min="0" max="1" step="0.01" value="${settings.reverb}">
            <span class="mini-label" title="Envío a delay">D</span>
            <input class="strip-del" type="range" min="0" max="1" step="0.01" value="${settings.delay}">
          </div>
        </div>`;
    }
    panel.innerHTML = html;

    panel.querySelectorAll('.track-strip').forEach(strip => {
      const t = parseInt(strip.dataset.track);
      const settings = state.trackSettings[t];

      const presetSelect = strip.querySelector('.strip-preset');
      presetSelect.addEventListener('change', () => {
        settings.preset = presetSelect.value;
        const resolved = settings.preset === 'random'
          ? Generator.pickRandom(AudioEngine.PRESETS)
          : settings.preset;
        state.resolvedPresets[t] = resolved;
        presetSelect.querySelector('option[value="random"]').textContent = randomOptionLabel(t);
        AudioEngine.setTrackPreset(t, resolved);
      });

      strip.querySelector('.strip-vol').addEventListener('input', e => {
        settings.volume = parseFloat(e.target.value);
        AudioEngine.setTrackVolume(t, settings.volume);
      });
      strip.querySelector('.strip-rev').addEventListener('input', e => {
        settings.reverb = parseFloat(e.target.value);
        AudioEngine.setTrackReverb(t, settings.reverb);
      });
      strip.querySelector('.strip-del').addEventListener('input', e => {
        settings.delay = parseFloat(e.target.value);
        AudioEngine.setTrackDelay(t, settings.delay);
      });
      strip.querySelector('.strip-pan').addEventListener('input', e => {
        settings.pan = parseFloat(e.target.value);
        settings.panTouched = true;
        AudioEngine.setTrackPan(t, settings.pan);
      });
    });
  }

  async function play() {
    await AudioEngine.init();
    if (!state.piece) generate();
    if (Composer.getIsPlaying()) return;

    Composer.play(
      step => Visualizer.setCursor(step),
      () => {
        Visualizer.clearCursor();
        const ui = getUIState();
        if (ui.autorestart || ui.autogen) {
          setTimeout(() => {
            if (getUIState().autogen) generate();
            play();
          }, 600);
        }
      }
    );
  }

  function stop() {
    Composer.stop();
    Visualizer.clearCursor();
  }

  function init() {
    setupUI();
    updateLabels();
    Visualizer.init('grid-canvas');
    generate();
  }

  return { init, generate, play, stop };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
