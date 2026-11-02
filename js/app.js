const App = (() => {
  const state = {
    piece: null,
    // Ajustes por pista (persisten entre generaciones): preset elegido, volumen y envíos
    trackSettings: [],
    // Preset efectivo de cada pista en la pieza actual (resuelto cuando la elección es aleatoria)
    resolvedPresets: [],
    // Vista activa de la grilla ('2d' | 'city' | 'tunnel' | 'terrain' | 'stars' | 'musicbox' | 'fifths' | 'pianola' | 'loom' | 'strings' | 'galaxy' | 'garden' | 'swarm' | 'mobius') y último paso del
    // cursor, para reponerlo al conmutar de vista en plena reproducción
    view: '2d',
    cursorStep: -1,
    // Arranque diferido de la siguiente pieza (respiro entre piezas)
    nextPieceTimer: null
  };

  // ---- Despacho de visualización: todas las llamadas van a la vista activa.
  // Visualizer3D es un módulo ESM cargado desde CDN; si no llegó a cargar
  // (sin conexión), la app sigue solo con la vista 2D

  function viz() {
    return state.view !== '2d' && window.Visualizer3D ? window.Visualizer3D : Visualizer;
  }

  function vizRender() {
    if (state.piece) viz().renderPiece(state.piece);
  }

  // Re-render de la pieza actual conservando el cursor: renderPiece lo borra
  // y en pausa no llegaría otro paso que lo repusiera
  function vizRefresh() {
    vizRender();
    if (state.piece && state.cursorStep >= 0) viz().setCursor(state.cursorStep);
  }

  function setView(view) {
    const select = document.getElementById('select-view');
    if (view !== '2d' && !window.Visualizer3D) {
      select.value = '2d';
      select.disabled = true;
      select.title = 'THREE.js no se pudo cargar (¿sin conexión?)';
      return;
    }
    state.view = view;
    select.value = view;
    const is3d = view !== '2d';
    document.getElementById('grid-container').classList.toggle('hidden', is3d);
    document.getElementById('viz3d-container').classList.toggle('hidden', !is3d);
    if (window.Visualizer3D) {
      if (is3d) {
        Visualizer3D.init('viz3d-container');
        Visualizer3D.setMode(view);
      }
      Visualizer3D.setActive(is3d);
    }
    vizRefresh();
    scheduleSave();
  }

  // edited: definición { base, params, chain } del editor de sintes; tiene
  // prioridad sobre preset al configurar el motor y persiste entre generaciones
  const DEFAULT_TRACK_SETTINGS = { preset: 'random', volume: 0.8, reverb: 0.2, delay: 0, pan: 0, panTouched: false, edited: null };

  // ---- Persistencia de ajustes (localStorage) ----
  // Todo cambio de la UI (topbar, diálogos, panel de pistas y editor de sintes)
  // se guarda con debounce y se restaura al cargar la página. Los presets de
  // usuario del editor viven aparte en binario.userPresets

  const LS_SETTINGS_KEY = 'binario.settings';
  let saveTimer = null;

  function loadSettings() {
    try {
      const data = JSON.parse(localStorage.getItem(LS_SETTINGS_KEY));
      return data && data.v === 1 ? data : null;
    } catch (e) {
      return null;
    }
  }

  function collectSettings() {
    return {
      v: 1,
      ui: getUIState(),
      audioEnabled: document.getElementById('checkbox-audio').checked,
      midiOutput: document.getElementById('select-midi-out').value,
      fx: {
        delaydiv: document.getElementById('slider-delaydiv').value,
        feedback: document.getElementById('slider-feedback').value,
        master: document.getElementById('slider-master').value,
        revdecay: document.getElementById('slider-revdecay').value
      },
      trackSettings: state.trackSettings,
      resolvedPresets: state.resolvedPresets
    };
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(collectSettings()));
      } catch (e) {
        // almacenamiento lleno o bloqueado: la app sigue, solo sin persistir
      }
    }, 250);
  }

  // Escribe el valor y dispara el evento del control para reutilizar sus
  // manejadores (labels, AudioEngine, retune…). En selects, si la opción
  // guardada ya no existe se queda el valor por defecto sin disparar nada
  function setControl(id, value, eventType) {
    const el = document.getElementById(id);
    if (!el || value === undefined || value === null) return;
    if (el.type === 'checkbox') {
      el.checked = value === true;
    } else {
      el.value = String(value);
      if (el.tagName === 'SELECT' && el.value !== String(value)) return;
    }
    el.dispatchEvent(new Event(eventType, { bubbles: true }));
  }

  // Primera visita (nada guardado): todo lo que admite azar arranca en azar.
  // Forma, preset y contornos ya lo hacen por defecto en el HTML
  function applyRandomDefaults() {
    for (const name of RANDOM_RANGES) setControl(`checkbox-${name}-random`, true, 'change');
    setControl('select-form', 'random', 'change');
    setControl('select-preset', 'random', 'change');
    setControl('select-scale', 'random', 'change');
    setControl('select-key', 'random', 'change');
  }

  function restoreSettings(saved) {
    if (!saved) {
      applyRandomDefaults();
      return;
    }
    const ui = saved.ui || {};
    setControl('slider-tempo', ui.tempo, 'input');
    setControl('slider-tracks', ui.numTracks, 'input');
    setControl('slider-duration', ui.duration, 'input');
    // Rangos de azar: cada tapa empuja a la otra, así que restaurarlas en
    // cualquier orden deja el par guardado tal cual
    for (const name of RANDOM_RANGES) {
      const range = ui[`${name}Range`];
      if (Array.isArray(range)) {
        setControl(`slider-${name}-min`, range[0], 'input');
        setControl(`slider-${name}-max`, range[1], 'input');
      }
      setControl(`checkbox-${name}-random`, ui[`${name}Random`], 'change');
    }
    setControl('select-preset', ui.preset, 'change');
    setControl('select-scale', ui.scale, 'change');
    setControl('select-key', ui.key, 'change');
    setControl('select-form', ui.formChoice, 'change');
    setControl('checkbox-autogen', ui.autogen, 'change');
    setControl('checkbox-autorestart', ui.autorestart, 'change');
    setControl('checkbox-kiosk', ui.kiosk, 'change');
    setControl('checkbox-audio', saved.audioEnabled, 'change');
    // compat: sesiones guardadas antes del selector de vista usaban viz3d bool
    const savedView = ui.view || (ui.viz3d ? 'city' : '2d');
    if (savedView !== '2d') setView(savedView);
    const fx = saved.fx || {};
    setControl('slider-delaydiv', fx.delaydiv, 'input');
    setControl('slider-feedback', fx.feedback, 'input');
    setControl('slider-master', fx.master, 'input');
    setControl('slider-revdecay', fx.revdecay, 'input');

    // Contornos: se marcan los guardados que sigan existiendo
    if (Array.isArray(ui.contours)) {
      document.querySelectorAll('#contour-ms-list input').forEach(cb => {
        cb.checked = ui.contours.includes(cb.value);
      });
      updateContourLabel();
    }

    // Ajustes por pista, fusionados con los defaults por si el esquema creció;
    // elecciones que apunten a presets de usuario borrados vuelven a aleatorio
    if (Array.isArray(saved.trackSettings)) {
      const valid = new Set(SynthEditor.getUserPresetNames().map(n => SynthEditor.USER_PREFIX + n));
      state.trackSettings = saved.trackSettings.map((s, i) => {
        const merged = { ...DEFAULT_TRACK_SETTINGS, midiChannel: (i % 16) + 1, ...s };
        if (merged.preset.startsWith(SynthEditor.USER_PREFIX) && !valid.has(merged.preset)) {
          merged.preset = 'random';
        }
        return merged;
      });
      state.resolvedPresets = (Array.isArray(saved.resolvedPresets) ? saved.resolvedPresets : [])
        .map(p => (p && p.startsWith(SynthEditor.USER_PREFIX) && !valid.has(p) ? null : p));
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function setupMidi(savedOutput) {
    const select = document.getElementById('select-midi-out');
    const audioCheckbox = document.getElementById('checkbox-audio');
    audioCheckbox.addEventListener('change', () => AudioEngine.setEnabled(audioCheckbox.checked));

    if (!MidiEngine.isSupported()) {
      select.disabled = true;
      select.options[0].textContent = '(no soportado)';
      return;
    }

    // Salida guardada de la sesión anterior, pendiente de que su puerto
    // aparezca (los puertos llegan async y pueden conectarse en caliente)
    let pendingOutput = savedOutput || null;

    const refreshOutputs = () => {
      const outputs = MidiEngine.getOutputs();
      const current = select.value || pendingOutput;
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
      // conserva la selección (o restaura la guardada) si el puerto está conectado
      if (current && outputs.some(o => o.id === current)) {
        select.value = current;
        if (current === pendingOutput) {
          MidiEngine.selectOutput(current);
          pendingOutput = null;
        }
      } else {
        select.value = '';
      }
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

    select.addEventListener('change', () => {
      // una elección manual anula la restauración pendiente
      pendingOutput = null;
      MidiEngine.selectOutput(select.value || null);
    });
  }

  // Reparte las pistas por el espectro estéreo: T1 a la izquierda, la última a la derecha
  function spreadPan(trackIndex, numTracks) {
    if (numTracks <= 1) return 0;
    const maxSpread = 0.85;
    return -maxSpread + (2 * maxSpread * trackIndex) / (numTracks - 1);
  }

  // Parámetros que pueden sortearse en cada generación dentro de un rango
  // (interruptor «azar» del diálogo Generación)
  const RANDOM_RANGES = ['tracks', 'duration', 'tempo'];

  function readRange(name) {
    return [`slider-${name}-min`, `slider-${name}-max`].map(id => parseInt(document.getElementById(id).value));
  }

  function getUIState() {
    const ui = {
      tempo: parseInt(document.getElementById('slider-tempo').value),
      numTracks: parseInt(document.getElementById('slider-tracks').value),
      duration: parseInt(document.getElementById('slider-duration').value),
      preset: document.getElementById('select-preset').value,
      scale: document.getElementById('select-scale').value,
      contours: getSelectedContours(),
      // 'random' o semitonos 0-11; se resuelve al generar (Generator.resolveKey)
      key: (v => (v === 'random' ? v : parseInt(v)))(document.getElementById('select-key').value),
      formChoice: document.getElementById('select-form').value,
      autogen: document.getElementById('checkbox-autogen').checked,
      autorestart: document.getElementById('checkbox-autorestart').checked,
      kiosk: document.getElementById('checkbox-kiosk').checked,
      view: state.view
    };
    for (const name of RANDOM_RANGES) {
      ui[`${name}Random`] = document.getElementById(`checkbox-${name}-random`).checked;
      ui[`${name}Range`] = readRange(name);
    }
    return ui;
  }

  const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const rangeText = ([min, max], unit = '') => (min === max ? String(min) : `${min}–${max}`) + unit;

  function updateLabels() {
    const ui = getUIState();
    document.getElementById('val-tempo').textContent = ui.tempo;
    document.getElementById('val-tracks').textContent = ui.tracksRandom ? rangeText(ui.tracksRange) : ui.numTracks;
    document.getElementById('val-duration').textContent = ui.durationRandom ? rangeText(ui.durationRange, ' min') : `${ui.duration} min`;
    document.getElementById('val-tempo-range').textContent = rangeText(ui.tempoRange);
  }

  // Rango doble (dos sliders superpuestos): cada tapa empuja a la otra en vez
  // de cruzarla, y el contenedor pinta el tramo entre ambas
  function setupRangePair(name) {
    const lo = document.getElementById(`slider-${name}-min`);
    const hi = document.getElementById(`slider-${name}-max`);
    const box = lo.parentElement;
    const sync = () => {
      const min = parseFloat(lo.min);
      const span = parseFloat(lo.max) - min || 1;
      box.style.setProperty('--from', `${(100 * (lo.value - min)) / span}%`);
      box.style.setProperty('--to', `${(100 * (hi.value - min)) / span}%`);
      // con las dos tapas juntas en el tope solo se podría arrastrar la de
      // arriba hacia la izquierda: ahí la del mínimo pasa por encima
      lo.style.zIndex = parseFloat(lo.value) >= parseFloat(lo.max) ? '2' : '';
      updateLabels();
    };
    lo.addEventListener('input', () => {
      if (parseFloat(lo.value) > parseFloat(hi.value)) hi.value = lo.value;
      sync();
    });
    hi.addEventListener('input', () => {
      if (parseFloat(hi.value) < parseFloat(lo.value)) lo.value = hi.value;
      sync();
    });
    sync();

    const toggle = document.getElementById(`checkbox-${name}-random`);
    const applyToggle = () => {
      toggle.closest('.dialog-row').classList.toggle('is-random', toggle.checked);
      updateLabels();
    };
    toggle.addEventListener('change', applyToggle);
    applyToggle();
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
    // La guía es un modal centrado; solo su apartado «En esta pieza» depende
    // de la pieza, y se rehace en cada apertura
    const guide = document.getElementById('dlg-guide');
    const guideBtn = document.querySelector('#topbar [popovertarget="dlg-guide"]');
    guide.addEventListener('toggle', event => {
      const open = event.newState === 'open';
      guideBtn.classList.toggle('dialog-open', open);
      if (open) renderGuidePiece();
    });
    // los enlaces del índice desplazan el texto sin tocar el hash de la URL
    guide.querySelector('.guide-toc').addEventListener('click', event => {
      const link = event.target.closest('a');
      if (!link) return;
      event.preventDefault();
      const target = guide.querySelector(link.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function setupUI(saved) {
    setupDialogs();
    setupContourMultiselect();
    setupMidi(saved && saved.midiOutput);

    const sliderTempo = document.getElementById('slider-tempo');

    sliderTempo.addEventListener('input', () => {
      updateLabels();
      AudioEngine.setTempo(parseInt(sliderTempo.value));
      // la duración en segundos depende del tempo
      lastShownSecond = -1;
      updatePosition(Composer.getIsPlaying() || state.cursorStep >= 0 ? state.cursorStep : -1);
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
    RANDOM_RANGES.forEach(setupRangePair);

    document.getElementById('btn-generate').addEventListener('click', generate);
    document.getElementById('btn-play').addEventListener('click', togglePlay);
    document.getElementById('btn-stop').addEventListener('click', stop);
    document.getElementById('select-view').addEventListener('change', e => setView(e.target.value));

    // Tonalidad y escala se aplican en vivo sobre la pieza actual. Elegir
    // "Aleatoria" no toca la pieza en curso: el sorteo ocurre al generar
    const retuneCurrent = () => {
      if (!state.piece) return;
      const ui = getUIState();
      const scale = ui.scale === 'random' ? state.piece.scale : ui.scale;
      const key = ui.key === 'random' ? state.piece.key : ui.key;
      if (scale === state.piece.scale && key === state.piece.key) return;
      Composer.retune(scale, key);
      updateRandomTonalityLabels();
      renderPieceBar();
      vizRefresh();
    };
    document.getElementById('select-key').addEventListener('change', retuneCurrent);
    document.getElementById('select-scale').addEventListener('change', retuneCurrent);

    // La vista 3D se redimensiona sola (ResizeObserver); el canvas 2D no.
    // Debounce: cada re-render recrea el offscreen y redibuja la pieza entera
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.view === '2d') vizRefresh();
      }, 120);
    });
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

  // Forma que entiende AudioEngine: definición editada > preset de usuario > nombre de fábrica
  function toEnginePreset(trackIndex, name) {
    const settings = state.trackSettings[trackIndex];
    if (settings.edited) return settings.edited;
    if (name.startsWith(SynthEditor.USER_PREFIX)) return SynthEditor.getUserPreset(name) || name;
    return name;
  }

  function displayName(name) {
    return name.startsWith(SynthEditor.USER_PREFIX)
      ? `★ ${name.slice(SynthEditor.USER_PREFIX.length)}`
      : name;
  }

  function currentNumTracks() {
    return state.piece ? state.piece.numTracks : getUIState().numTracks;
  }

  function generate() {
    if (Composer.getIsPlaying()) stop();

    const ui = getUIState();
    // Parámetros con «azar»: se sortean aquí, una vez por pieza. El tempo
    // sorteado se escribe en el slider de la barra superior, así que el
    // usuario lo ve y puede seguir cambiándolo en vivo (invariante 8)
    const numTracks = ui.tracksRandom ? randomInt(...ui.tracksRange) : ui.numTracks;
    const minutes = ui.durationRandom ? randomInt(...ui.durationRange) : ui.duration;
    const bpm = ui.tempoRandom ? randomInt(...ui.tempoRange) : ui.tempo;
    if (ui.tempoRandom) setControl('slider-tempo', bpm, 'input');
    else AudioEngine.setTempo(bpm);
    ensureTrackSettings(numTracks);

    const formStr = Generator.generateForm(ui.formChoice);
    const formParts = Generator.parseForm(formStr);

    // Duración objetivo -> largo de célula y repeticiones por letra. Un paso es
    // una semicorchea: a ♩=bpm suenan bpm*4 pasos por minuto. Si luego se mueve
    // el tempo en vivo, la duración en minutos cambia con él
    const plan = Composer.planDuration(formParts, minutes * bpm * 4);
    const cellLength = plan.cellLength;

    const motherCell = Generator.generateMotherCell(cellLength, ui.contours);
    // al menos tantas variaciones como pistas para que nunca falte material distinto
    const motifs = Generator.generateMotifs(motherCell, Math.max(4, numTracks), ui.contours);

    const configs = [];
    const resolved = [];
    for (let t = 0; t < numTracks; t++) {
      const preset = resolvePreset(t, ui);
      const settings = state.trackSettings[t];
      // el reparto estéreo se recalcula salvo que el usuario haya movido el paneo a mano
      if (!settings.panTouched) settings.pan = spreadPan(t, numTracks);
      resolved.push(preset);
      configs.push({ preset: toEnginePreset(t, preset), volume: settings.volume, reverb: settings.reverb, delay: settings.delay, pan: settings.pan });
    }
    state.resolvedPresets = resolved;
    AudioEngine.setupTracks(configs);
    MidiEngine.setTrackChannels(state.trackSettings.slice(0, numTracks).map(s => s.midiChannel));

    state.piece = Composer.compose({
      numTracks,
      motifs,
      formParts,
      cellLength,
      scale: Generator.resolveScale(ui.scale),
      key: Generator.resolveKey(ui.key),
      repeatsByLetter: plan.repeats
    });
    updateRandomTonalityLabels();
    // El cursor de una pausa previa no vale para la pieza nueva (compose
    // rebobina a 0); si no, vizRefresh (retune, resize, vista) lo repondría
    state.cursorStep = -1;
    state.piece.contour = motherCell.contour;
    state.piece.motifContours = motifs.map(m => m.contour);
    const extraContours = [...new Set(motifs.slice(1).map(m => m.contour).filter(c => c !== motherCell.contour))];
    const contourInfo = extraContours.length ? `${motherCell.contour} (variaciones: ${extraContours.join(', ')})` : motherCell.contour;
    const tonalPlan = state.piece.sections.map(s => s.fifthOffset).join(' → ');
    console.log(`Pieza generada — ${numTracks} pistas, ${formatTime(state.piece.totalSteps * 15 / bpm)} (objetivo ${minutes} min), célula de ${cellLength} pasos, ♩=${bpm}, contorno: ${contourInfo}, forma: ${formStr}, ${optionText('select-key', state.piece.key)} ${optionText('select-scale', state.piece.scale)}, plan tonal (quintas): ${tonalPlan}`);

    lastShownSecond = -1;
    renderPieceBar();
    vizRender();
    buildTrackPanel(numTracks);
    SynthEditor.ensureValid(numTracks);
    // los presets sorteados forman parte de lo que se restaura al recargar
    scheduleSave();
  }

  function optionText(selectId, value) {
    const opt = document.querySelector(`#${selectId} option[value="${value}"]`);
    return opt ? opt.textContent : String(value);
  }

  // La opción "Aleatoria" de escala y tonalidad muestra lo que suena ahora,
  // como el selector de preset de cada pista
  function updateRandomTonalityLabels() {
    const piece = state.piece;
    for (const [id, value] of [['select-scale', piece && piece.scale], ['select-key', piece && piece.key]]) {
      const opt = document.querySelector(`#${id} option[value="random"]`);
      if (opt) opt.textContent = piece ? `Aleatoria (${optionText(id, value)})` : 'Aleatoria';
    }
  }

  function randomOptionLabel(trackIndex) {
    const resolved = state.resolvedPresets[trackIndex];
    // corto para que quepa en la tira de la pista
    return resolved ? `${displayName(resolved)} · azar` : 'Aleatorio';
  }

  function buildTrackPanel(numTracks) {
    const panel = document.getElementById('track-panel');
    if (!panel) return;

    let html = `<div class="panel-spacer"><span>Pistas</span><span>${numTracks}</span></div>`;
    for (let t = 0; t < numTracks; t++) {
      const settings = state.trackSettings[t];
      const userIds = SynthEditor.getUserPresetNames().map(n => SynthEditor.USER_PREFIX + n);
      const options = ['random'].concat(AudioEngine.PRESETS, userIds).map(p => {
        const label = p === 'random' ? randomOptionLabel(t) : displayName(p);
        const selected = settings.preset === p ? ' selected' : '';
        return `<option value="${escapeHtml(p)}"${selected}>${escapeHtml(label)}</option>`;
      }).join('');
      const chanOptions = Array.from({ length: 16 }, (_, i) => {
        const selected = settings.midiChannel === i + 1 ? ' selected' : '';
        return `<option value="${i + 1}"${selected}>${i + 1}</option>`;
      }).join('');
      html += `
        <div class="track-strip" data-track="${t}">
          <div class="strip-row">
            <span class="strip-num">${String(t + 1).padStart(2, '0')}</span>
            <select class="strip-preset" title="Instrumento de la pista">${options}</select>
            <button class="strip-edit" title="Editor de sinte y efectos" aria-label="Editar sinte de la pista ${t + 1}">
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.3 1.9l2.8 2.8-8.6 8.6H2.7v-2.8z"/></svg>
            </button>
            <label class="strip-chan-wrap" title="Canal MIDI de la pista">ch<select class="strip-chan">${chanOptions}</select></label>
          </div>
          <div class="strip-faders">
            <label class="fader" title="Volumen"><span>vol</span><input class="strip-vol" type="range" min="0" max="1" step="0.01" value="${settings.volume}"></label>
            <label class="fader" title="Envío a reverb"><span>rev</span><input class="strip-rev" type="range" min="0" max="1" step="0.01" value="${settings.reverb}"></label>
            <label class="fader" title="Envío a delay"><span>dly</span><input class="strip-del" type="range" min="0" max="1" step="0.01" value="${settings.delay}"></label>
            <label class="fader" title="Paneo (izquierda-derecha)"><span>pan</span><input class="strip-pan" type="range" min="-1" max="1" step="0.01" value="${settings.pan}"></label>
          </div>
        </div>`;
    }
    panel.innerHTML = html;
    syncRangeFills(panel);

    panel.querySelectorAll('.track-strip').forEach(strip => {
      const t = parseInt(strip.dataset.track);
      const settings = state.trackSettings[t];

      const presetSelect = strip.querySelector('.strip-preset');
      presetSelect.addEventListener('change', () => {
        settings.preset = presetSelect.value;
        // elegir un preset descarta la edición en vivo del editor de sintes
        settings.edited = null;
        const resolved = settings.preset === 'random'
          ? Generator.pickRandom(AudioEngine.PRESETS)
          : settings.preset;
        state.resolvedPresets[t] = resolved;
        presetSelect.querySelector('option[value="random"]').textContent = randomOptionLabel(t);
        // definición completa: cambiar de preset también reemplaza la cadena de efectos
        const def = resolved.startsWith(SynthEditor.USER_PREFIX) ? SynthEditor.getUserPreset(resolved) : null;
        AudioEngine.setTrackPreset(t, def || { base: resolved, chain: [] });
        SynthEditor.refreshIfOpen(t, resolved);
      });

      strip.querySelector('.strip-edit').addEventListener('click', () => {
        SynthEditor.open(t, state.resolvedPresets[t] || 'Synth', settings.edited);
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

  // Respiro entre una pieza y la siguiente (Auto-generar / Auto-reinicio / kiosco)
  const PIECE_GAP_MS = 3000;

  function cancelNextPiece() {
    clearTimeout(state.nextPieceTimer);
    state.nextPieceTimer = null;
  }

  async function play() {
    await AudioEngine.init();
    if (!state.piece) generate();
    if (Composer.getIsPlaying()) return;

    Composer.play(
      step => {
        state.cursorStep = step;
        viz().setCursor(step);
        updatePosition(step);
      },
      () => {
        state.cursorStep = -1;
        viz().clearCursor();
        setPlayingUI(false);
        updatePosition(-1);
        // El kiosco nunca se queda en silencio: sin Auto-generar ni
        // Auto-reinicio también compone otra pieza
        const ui = getUIState();
        const regenerate = ui.autogen || (ui.kiosk && !ui.autorestart);
        if (!regenerate && !ui.autorestart) return;
        // Se compone ya, para que las pistas salientes se desvanezcan con su
        // cola (AudioEngine.setupTracks) durante el respiro previo a la nueva
        if (regenerate) generate();
        cancelNextPiece();
        state.nextPieceTimer = setTimeout(() => {
          state.nextPieceTimer = null;
          play();
        }, PIECE_GAP_MS);
      }
    );
    setPlayingUI(Composer.getIsPlaying());
  }

  // Pausa: conserva la posición y el cursor marca el punto de reanudación
  function pause() {
    cancelNextPiece();
    Composer.stop();
    setPlayingUI(false);
  }

  function togglePlay() {
    if (Composer.getIsPlaying()) pause();
    else play();
  }

  // Detener: para y rebobina al inicio (Composer.stop pausa en marcha y
  // rebobina estando parado, de ahí la doble llamada)
  function stop() {
    cancelNextPiece();
    Composer.stop();
    Composer.stop();
    state.cursorStep = -1;
    viz().clearCursor();
    setPlayingUI(false);
    updatePosition(-1);
  }

  function setPlayingUI(playing) {
    document.body.classList.toggle('is-playing', playing);
    const btn = document.getElementById('btn-play');
    btn.setAttribute('aria-pressed', String(playing));
    btn.title = playing ? 'Pausar (Espacio)' : 'Reproducir (Espacio)';
    if (playing) document.getElementById('kiosk-start').hidden = true;
  }

  // Espacio = reproducir/pausar, salvo escribiendo o eligiendo en un control
  function setupKeyboard() {
    const typing = el => el && (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox'));
    document.addEventListener('keydown', e => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.code === 'KeyF') {
        toggleFullscreen();
        return;
      }
      if (e.code !== 'Space') return;
      e.preventDefault();
      togglePlay();
    });
    // un botón o interruptor con foco se activaría además en keyup
    document.addEventListener('keyup', e => {
      if (e.code === 'Space' && (e.target.tagName === 'BUTTON' || e.target.type === 'checkbox')) e.preventDefault();
    });
  }

  // ---- Barra de la pieza: tonalidad, datos, tiempo y secciones ----

  // Nombre de la tonalidad local de una sección (base + modulación por quintas)
  function keyName(semitones) {
    return optionText('select-key', ((semitones % 12) + 12) % 12);
  }

  function stepSeconds() {
    return 60 / getUIState().tempo / 4;
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.round(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

  function renderPieceBar() {
    const piece = state.piece;
    const keyEl = document.getElementById('piece-key');
    const facts = document.getElementById('piece-facts');
    const bar = document.getElementById('section-bar');
    if (!piece) {
      keyEl.textContent = '—';
      facts.innerHTML = '';
      bar.innerHTML = '';
      return;
    }
    keyEl.innerHTML = `${escapeHtml(keyName(piece.key))}<span class="scale-name">${escapeHtml(optionText('select-scale', piece.scale).toLowerCase())}</span>`;
    const form = piece.sections.map(s => s.label).join('–');
    facts.innerHTML = [
      ['forma', form],
      ['contorno', piece.contour ? capitalize(piece.contour) : '—'],
      ['pistas', piece.numTracks],
      ['célula', `${piece.cellLength} pasos`, 'fact-cell']
    ].map(([label, value, cls]) => `<span class="${cls || ''}"><span class="fact-label">${label}</span><b>${escapeHtml(String(value))}</b></span>`).join('');

    bar.innerHTML = piece.sections.map((s, i) => {
      const local = keyName(piece.key + s.keyOffset);
      const fifths = s.fifthOffset ? ` (${s.fifthOffset > 0 ? '+' : ''}${s.fifthOffset} ${Math.abs(s.fifthOffset) === 1 ? 'quinta' : 'quintas'})` : '';
      const title = `Sección ${s.label} · ${s.totalRepeats} repeticiones · tonalidad ${local}${fifths}${s.recap ? ' · recapitulación' : ''}`;
      return `<div class="sec${s.recap ? ' recap' : ''}" data-index="${i}" style="flex: ${s.lengthSteps} 1 0" title="${escapeHtml(title)}">` +
        `<span class="sec-letter">${escapeHtml(s.label)}</span>` +
        `<span class="sec-key${s.fifthOffset ? ' modulated' : ''}">${escapeHtml(local)}</span></div>`;
    }).join('') + '<div class="section-fill"></div><div class="section-head"></div>';

    updatePosition(Composer.getIsPlaying() || state.cursorStep >= 0 ? state.cursorStep : -1);
  }

  // Apartado «En esta pieza» de la guía: la teoría aplicada a lo que suena
  function renderGuidePiece() {
    const el = document.getElementById('guide-piece');
    const piece = state.piece;
    if (!piece) {
      el.innerHTML = '<p class="guide-empty">Aún no hay pieza: pulsa Generar y vuelve a abrir la guía.</p>';
      return;
    }
    const form = piece.sections.map(s => s.label).join('–');
    const letters = [...new Set(piece.sections.map(s => s.label))];
    const contours = piece.motifContours || [piece.contour];
    const otherContours = [...new Set(contours.slice(1).filter(c => c && c !== piece.contour))];
    const peak = Math.max(...piece.sections.map(s => Math.abs(s.fifthOffset || 0)));
    const dir = piece.sections.some(s => s.fifthOffset > 0) ? 'sostenidos' : 'bemoles';
    const recap = piece.sections.find(s => s.recap);
    const facts = [
      ['Forma', `${form} — ${piece.sections.length} secciones con ${letters.length} materiales distintos (${letters.join(', ')})`],
      ['Tonalidad', `${keyName(piece.key)} ${optionText('select-scale', piece.scale).toLowerCase()}`],
      ['Célula', `${piece.cellLength} pasos (${piece.cellLength / 16} ${piece.cellLength === 16 ? 'compás' : 'compases'} de 4/4)`],
      ['Contorno', capitalize(piece.contour || '—') + (otherContours.length ? `; variaciones recontorneadas con ${otherContours.map(capitalize).join(', ')}` : '')],
      ['Motivos', `${contours.length}: la madre y ${contours.length - 1} variaciones`],
      ['Pistas', String(piece.numTracks)],
      ['Duración', `${formatTime(piece.totalSteps * stepSeconds())} a ♩=${getUIState().tempo} (${piece.totalSteps} pasos)`],
      ['Plan tonal', peak ? `hasta ${peak} ${peak === 1 ? 'quinta' : 'quintas'} hacia los ${dir}, de vuelta a la tónica` : 'sin modulación (pocas secciones)'],
      ['Recapitulación', recap ? `sección ${recap.label} (la ${piece.sections.indexOf(recap) + 1}.ª), pista ${recap.recapTrack + 1}` : 'ninguna']
    ];
    const rows = piece.sections.map((s, i) => {
      const fifths = s.fifthOffset ? `${s.fifthOffset > 0 ? '+' : '−'}${Math.abs(s.fifthOffset)}` : '0';
      return `<tr${s.recap ? ' class="recap"' : ''}><td>${i + 1}</td><td><b>${escapeHtml(s.label)}</b></td>` +
        `<td>${s.totalRepeats}×</td><td>${escapeHtml(keyName(piece.key + s.keyOffset))}</td><td>${fifths}</td>` +
        `<td>${s.recap ? 'recapitulación' : ''}</td></tr>`;
    }).join('');
    el.innerHTML =
      '<dl class="guide-facts">' + facts.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('') + '</dl>' +
      '<table class="guide-sections"><thead><tr><th>#</th><th>Letra</th><th>Repeticiones</th><th>Tonalidad</th><th>Quintas</th><th></th></tr></thead>' +
      `<tbody>${rows}</tbody></table>`;
  }

  let lastShownSecond = -1;

  // Posición de reproducción en la barra (step < 0: al inicio, sin cabezal)
  function updatePosition(step) {
    const piece = state.piece;
    if (!piece) return;
    const bar = document.getElementById('section-bar');
    const at = Math.max(0, step);
    const pct = `${(100 * at) / piece.totalSteps}%`;
    const fill = bar.querySelector('.section-fill');
    const head = bar.querySelector('.section-head');
    if (fill) fill.style.width = pct;
    if (head) head.style.left = pct;
    bar.classList.toggle('has-head', step >= 0);

    const current = step >= 0 ? piece.sections.findIndex(s => at >= s.startStep && at < s.startStep + s.lengthSteps) : -1;
    bar.querySelectorAll('.sec').forEach((el, i) => el.classList.toggle('current', i === current));

    const elapsed = Math.floor(at * stepSeconds());
    if (step >= 0 && elapsed === lastShownSecond) return;
    lastShownSecond = step >= 0 ? elapsed : -1;
    document.getElementById('piece-time').innerHTML =
      `<b>${formatTime(at * stepSeconds())}</b> / ${formatTime(piece.totalSteps * stepSeconds())}`;
  }

  function setupPieceBar() {
    document.getElementById('section-bar').addEventListener('click', e => {
      const sec = e.target.closest('.sec');
      if (!sec || !state.piece) return;
      const step = state.piece.sections[parseInt(sec.dataset.index)].startStep;
      Composer.seek(step);
      // en marcha el cursor lo mueve el próximo paso; en pausa se marca ya
      if (!Composer.getIsPlaying()) {
        state.cursorStep = step;
        viz().setCursor(step);
      }
      lastShownSecond = -1;
      updatePosition(step);
    });
  }

  // ---- Faders: el tramo activo de cada slider lo pinta el CSS con
  // --from/--to; bipolar (desde el centro) si el mínimo es negativo ----

  function syncRangeFill(input) {
    const min = input.min === '' ? 0 : parseFloat(input.min);
    const max = input.max === '' ? 100 : parseFloat(input.max);
    const span = max - min || 1;
    const pos = (100 * (parseFloat(input.value) - min)) / span;
    const zero = min < 0 && max > 0 ? (100 * -min) / span : 0;
    input.style.setProperty('--from', `${Math.min(zero, pos)}%`);
    input.style.setProperty('--to', `${Math.max(zero, pos)}%`);
  }

  function syncRangeFills(root) {
    (root || document).querySelectorAll('input[type="range"]').forEach(syncRangeFill);
  }

  function setupRangeFills() {
    document.addEventListener('input', e => {
      if (e.target.type === 'range') syncRangeFill(e.target);
    }, true);
    // sliders creados después (editor de sintes) o con value fijado por código
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        syncRangeFills();
      });
    }).observe(document.body, { childList: true, subtree: true });
    syncRangeFills();
  }

  // ---- Pantalla completa y modo kiosco ----

  function requestFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen().catch(() => { /* sin gesto o denegado */ });
  }

  // F = pantalla completa (fuera del kiosco también)
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else requestFullscreen();
  }

  const kioskOn = () => document.getElementById('checkbox-kiosk').checked;

  // Pantalla siempre encendida mientras el kiosco esté activo. El navegador
  // suelta el bloqueo al ocultarse la pestaña; se vuelve a pedir al mostrarse
  let wakeLock = null;
  let wakeLockPending = false;

  async function updateWakeLock() {
    const want = kioskOn() && document.visibilityState === 'visible';
    if (want && !wakeLock && !wakeLockPending && navigator.wakeLock) {
      wakeLockPending = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
        wakeLock = lock;
      } catch (e) {
        // denegado (ahorro de batería, política): la pantalla podrá apagarse
      }
      wakeLockPending = false;
      // el kiosco pudo apagarse mientras se esperaba el bloqueo
      if (!kioskOn()) updateWakeLock();
    } else if (!want && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      lock.release().catch(() => {});
    }
  }

  // Interfaz oculta tras IDLE_MS sin actividad (solo kiosco y sonando, sin
  // diálogos abiertos); cualquier movimiento, toque o tecla la devuelve
  const IDLE_MS = 4000;
  let idleTimer = null;

  function setIdle(idle) {
    if (document.body.classList.contains('ui-idle') === idle) return;
    document.body.classList.toggle('ui-idle', idle);
    // el piano roll 2D no observa su contenedor (la vista 3D sí)
    if (state.view === '2d') vizRefresh();
  }

  function pokeActivity() {
    setIdle(false);
    clearTimeout(idleTimer);
    if (!kioskOn()) return;
    idleTimer = setTimeout(() => {
      if (kioskOn() && Composer.getIsPlaying() && !document.querySelector(':popover-open')) setIdle(true);
      else pokeActivity();
    }, IDLE_MS);
  }

  // Sin permiso de autoplay, el primer gesto en cualquier parte arranca el
  // audio y pide pantalla completa (ambas cosas exigen gesto). Sobre un
  // control solo se pide pantalla completa: el control hace lo suyo (▶ ya
  // reproduce, y reproducir aquí además haría que su clic pausara)
  function armFirstGesture() {
    const onGesture = e => {
      document.removeEventListener('pointerdown', onGesture, true);
      document.removeEventListener('keydown', onGesture, true);
      if (!kioskOn()) return;
      requestFullscreen();
      document.getElementById('kiosk-start').hidden = true;
      const onControl = e.target.closest && e.target.closest('button, input, select, label, .sec, [popover]');
      if (!onControl && !Composer.getIsPlaying()) play();
    };
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);
  }

  // Arranque al cargar con el kiosco activo: si la política de autoplay lo
  // permite (p. ej. Chrome con --autoplay-policy=no-user-gesture-required)
  // suena ya; si no, el contexto queda suspendido y se espera el primer gesto
  // con un aviso a pantalla completa
  function kioskBoot() {
    if (!kioskOn()) return;
    armFirstGesture();
    AudioEngine.init(); // sin await: sin permiso de autoplay queda pendiente
    setTimeout(() => {
      if (!kioskOn() || Composer.getIsPlaying()) return;
      if (AudioEngine.isRunning()) play();
      else document.getElementById('kiosk-start').hidden = false;
    }, 300);
  }

  function setupKiosk() {
    const checkbox = document.getElementById('checkbox-kiosk');
    checkbox.addEventListener('change', e => {
      updateWakeLock();
      pokeActivity();
      // solo un clic real (no la restauración de ajustes) entra o sale del
      // kiosco en el acto: pantalla completa y reproducción exigen gesto
      if (!e.isTrusted) return;
      if (checkbox.checked) {
        requestFullscreen();
        if (!Composer.getIsPlaying()) play();
      } else {
        document.getElementById('kiosk-start').hidden = true;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      }
    });
    document.addEventListener('visibilitychange', updateWakeLock);
    for (const type of ['pointerdown', 'keydown', 'wheel']) {
      document.addEventListener(type, pokeActivity, { passive: true, capture: true });
    }
    // Chrome emite pointermove sin desplazamiento cuando la página cambia bajo
    // un puntero quieto; no cuentan como actividad
    document.addEventListener('pointermove', e => {
      if (e.movementX || e.movementY) pokeActivity();
    }, { passive: true, capture: true });
  }

  function setupSynthEditor() {
    SynthEditor.init({
      onChange: (t, def) => {
        ensureTrackSettings(t + 1);
        state.trackSettings[t].edited = def;
        scheduleSave();
      },
      onPresetsChanged: () => {
        // limpia elecciones que apunten a presets de usuario borrados
        const valid = new Set(SynthEditor.getUserPresetNames().map(n => SynthEditor.USER_PREFIX + n));
        state.trackSettings.forEach((settings, i) => {
          if (settings.preset.startsWith(SynthEditor.USER_PREFIX) && !valid.has(settings.preset)) {
            settings.preset = 'random';
            state.resolvedPresets[i] = null;
          }
        });
        buildTrackPanel(currentNumTracks());
        scheduleSave();
      },
      onPresetSaved: (t, name) => {
        const settings = state.trackSettings[t];
        settings.preset = SynthEditor.USER_PREFIX + name;
        settings.edited = null;
        state.resolvedPresets[t] = settings.preset;
        buildTrackPanel(currentNumTracks());
        scheduleSave();
      }
    });
  }

  function init() {
    const saved = loadSettings();
    setupUI(saved);
    setupKeyboard();
    setupPieceBar();
    setupSynthEditor();
    setupKiosk();
    restoreSettings(saved);
    updateLabels();
    Visualizer.init('grid-canvas');
    generate();
    setupRangeFills();
    kioskBoot();
    // Autosave global: cualquier input/change que burbujee (topbar, diálogos,
    // panel de pistas) reprograma el guardado. Se engancha tras restaurar para
    // no guardar en medio de la propia restauración; el editor de sintes pasa
    // por sus callbacks (onChange/onPresetsChanged/onPresetSaved)
    document.addEventListener('input', scheduleSave);
    document.addEventListener('change', scheduleSave);
  }

  return { init, generate, play, stop };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
