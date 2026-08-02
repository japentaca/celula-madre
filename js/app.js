const App = (() => {
  const state = {
    piece: null,
    // Ajustes por pista (persisten entre generaciones): preset elegido, volumen y envíos
    trackSettings: [],
    // Preset efectivo de cada pista en la pieza actual (resuelto cuando la elección es aleatoria)
    resolvedPresets: []
  };

  const DEFAULT_TRACK_SETTINGS = { preset: 'random', volume: 0.8, reverb: 0.2, delay: 0, pan: 0, panTouched: false };

  function setupMidi() {
    const select = document.getElementById('select-midi-out');
    const audioCheckbox = document.getElementById('checkbox-audio');
    audioCheckbox.addEventListener('change', () => AudioEngine.setEnabled(audioCheckbox.checked));

    if (!MidiEngine.isSupported()) {
      select.disabled = true;
      select.options[0].textContent = '(no soportado)';
      return;
    }

    const refreshOutputs = () => {
      const outputs = MidiEngine.getOutputs();
      const current = select.value;
      select.innerHTML = '';
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '(sin salida)';
      select.appendChild(none);
      for (const out of outputs) {
        const option = document.createElement('option');
        option.value = out.id;
        option.textContent = out.name;
        select.appendChild(option);
      }
      // conserva la selección si el puerto sigue conectado
      select.value = outputs.some(o => o.id === current) ? current : '';
    };

    MidiEngine.setOnDevicesChanged(refreshOutputs);
    MidiEngine.init().then(access => {
      if (!access) {
        select.disabled = true;
        select.options[0].textContent = '(sin permiso)';
        return;
      }
      refreshOutputs();
    });

    select.addEventListener('change', () => MidiEngine.selectOutput(select.value || null));
  }

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
      contours: getSelectedContours(),
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

  function getSelectedContours() {
    const checks = document.querySelectorAll('#contour-ms-list input:checked');
    return Array.from(checks).map(cb => cb.value);
  }

  function updateContourLabel() {
    const btn = document.getElementById('contour-ms-btn');
    const selected = getSelectedContours();
    if (selected.length === 0) btn.textContent = '(Al azar)';
    else if (selected.length === 1) btn.textContent = selected[0].charAt(0).toUpperCase() + selected[0].slice(1);
    else btn.textContent = `${selected.length} contornos`;
  }

  function setupContourMultiselect() {
    const btn = document.getElementById('contour-ms-btn');
    const list = document.getElementById('contour-ms-list');
    Generator.CONTOUR_NAMES.forEach(name => {
      const item = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = name;
      checkbox.addEventListener('change', updateContourLabel);
      item.appendChild(checkbox);
      item.appendChild(document.createTextNode(name.charAt(0).toUpperCase() + name.slice(1)));
      list.appendChild(item);
    });
    btn.addEventListener('click', event => {
      event.stopPropagation();
      list.classList.toggle('hidden');
    });
    list.addEventListener('click', event => event.stopPropagation());
    document.addEventListener('click', () => list.classList.add('hidden'));
  }

  // Los diálogos usan la Popover API (cierre por clic fuera / Esc lo da el
  // navegador); aquí solo se colocan bajo su botón y se marca el botón activo
  function setupDialogs() {
    document.querySelectorAll('.dialog').forEach(dialog => {
      const btn = document.querySelector(`#topbar [popovertarget="${dialog.id}"]`);
      dialog.addEventListener('toggle', event => {
        const open = event.newState === 'open';
        btn.classList.toggle('dialog-open', open);
        if (!open) return;
        const rect = btn.getBoundingClientRect();
        dialog.style.top = `${rect.bottom + 6}px`;
        dialog.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - dialog.offsetWidth - 8))}px`;
      });
    });
  }

  function setupUI() {
    setupDialogs();
    setupContourMultiselect();
    setupMidi();

    const sliderTempo = document.getElementById('slider-tempo');

    sliderTempo.addEventListener('input', () => {
      updateLabels();
      AudioEngine.setTempo(parseInt(sliderTempo.value));
    });

    const sliderDelayDiv = document.getElementById('slider-delaydiv');
    sliderDelayDiv.max = AudioEngine.DELAY_SUBDIVISIONS.length - 1;
    sliderDelayDiv.value = AudioEngine.DEFAULT_DELAY_SUBDIVISION;
    const applyDelayDiv = () => {
      const index = parseInt(sliderDelayDiv.value);
      document.getElementById('val-delaydiv').textContent = AudioEngine.DELAY_SUBDIVISIONS[index].label;
      AudioEngine.setDelaySubdivision(index);
    };
    sliderDelayDiv.addEventListener('input', applyDelayDiv);
    applyDelayDiv();

    const sliderFeedback = document.getElementById('slider-feedback');
    sliderFeedback.value = AudioEngine.DEFAULT_DELAY_FEEDBACK;
    const applyFeedback = () => {
      const value = parseFloat(sliderFeedback.value);
      document.getElementById('val-feedback').textContent = value.toFixed(2);
      AudioEngine.setDelayFeedback(value);
    };
    sliderFeedback.addEventListener('input', applyFeedback);
    applyFeedback();

    const sliderMaster = document.getElementById('slider-master');
    sliderMaster.value = AudioEngine.DEFAULT_MASTER_VOLUME;
    sliderMaster.addEventListener('input', () => {
      const value = parseFloat(sliderMaster.value);
      document.getElementById('val-master').textContent = value.toFixed(2);
      AudioEngine.setMasterVolume(value);
    });

    const sliderRevDecay = document.getElementById('slider-revdecay');
    sliderRevDecay.value = AudioEngine.DEFAULT_REVERB_DECAY;
    let revDecayTimer = null;
    sliderRevDecay.addEventListener('input', () => {
      const value = parseFloat(sliderRevDecay.value);
      document.getElementById('val-revdecay').textContent = `${value.toFixed(1)}s`;
      // Debounce: cada cambio re-renderiza la impulsional del reverb (costoso)
      clearTimeout(revDecayTimer);
      revDecayTimer = setTimeout(() => AudioEngine.setReverbDecay(value), 150);
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
      // Canal MIDI por defecto escalonado: T1→1, T2→2… (máx. 8 pistas)
      const midiChannel = (state.trackSettings.length % 16) + 1;
      state.trackSettings.push({ ...DEFAULT_TRACK_SETTINGS, midiChannel });
    }
  }

  // Prioridad: elección por pista > preset global del topbar > aleatorio.
  // El sinte sorteado se conserva entre regeneraciones; solo se re-sortea si el
  // usuario vuelve a elegir "Aleatorio" en el panel
  function resolvePreset(trackIndex, ui) {
    const settings = state.trackSettings[trackIndex];
    if (settings.preset !== 'random') return settings.preset;
    if (ui.preset !== 'random') return ui.preset;
    return state.resolvedPresets[trackIndex] || Generator.pickRandom(AudioEngine.PRESETS);
  }

  function generate() {
    if (Composer.getIsPlaying()) stop();

    const ui = getUIState();
    AudioEngine.setTempo(ui.tempo);
    ensureTrackSettings(ui.numTracks);

    const cellLength = cellLengthFromDuration(ui.duration);
    const fifthSteps = Generator.randomFifthSteps();

    const motherCell = Generator.generateMotherCell(cellLength, ui.contours);
    // al menos tantas variaciones como pistas para que nunca falte material distinto
    const motifs = Generator.generateMotifs(motherCell, Math.max(4, ui.numTracks), ui.contours);

    const formStr = Generator.generateForm(ui.formChoice);
    const formParts = Generator.parseForm(formStr);

    const configs = [];
    const resolved = [];
    for (let t = 0; t < ui.numTracks; t++) {
      const preset = resolvePreset(t, ui);
      const settings = state.trackSettings[t];
      // el reparto estéreo se recalcula salvo que el usuario haya movido el paneo a mano
      if (!settings.panTouched) settings.pan = spreadPan(t, ui.numTracks);
      resolved.push(preset);
      configs.push({ preset, volume: settings.volume, reverb: settings.reverb, delay: settings.delay, pan: settings.pan });
    }
    state.resolvedPresets = resolved;
    AudioEngine.setupTracks(configs);
    MidiEngine.setTrackChannels(state.trackSettings.slice(0, ui.numTracks).map(s => s.midiChannel));

    state.piece = Composer.compose({
      numTracks: ui.numTracks,
      motifs,
      formParts,
      cellLength,
      scale: ui.scale,
      key: ui.key,
      fifthSteps
    });
    state.piece.contour = motherCell.contour;
    const extraContours = [...new Set(motifs.slice(1).map(m => m.contour).filter(c => c !== motherCell.contour))];
    const contourInfo = extraContours.length ? `${motherCell.contour} (variaciones: ${extraContours.join(', ')})` : motherCell.contour;
    console.log(`Pieza generada — contorno: ${contourInfo}, forma: ${formStr}, quinta cada ${fifthSteps} repeticiones`);

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
      const chanOptions = Array.from({ length: 16 }, (_, i) => {
        const selected = settings.midiChannel === i + 1 ? ' selected' : '';
        return `<option value="${i + 1}"${selected}>${i + 1}</option>`;
      }).join('');
      html += `
        <div class="track-strip" data-track="${t}">
          <div class="strip-row">
            <span class="strip-label">T${t + 1}</span>
            <select class="strip-preset">${options}</select>
            <span class="mini-label" title="Canal MIDI de la pista">C</span>
            <select class="strip-chan">${chanOptions}</select>
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
      strip.querySelector('.strip-chan').addEventListener('change', e => {
        settings.midiChannel = parseInt(e.target.value);
        MidiEngine.setTrackChannel(t, settings.midiChannel);
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
