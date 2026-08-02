// Editor de sintetizador y efectos por pista: modal que edita en vivo el sinte
// (esquema declarativo de parámetros por tipo) y una cadena de efectos de
// inserción, y gestiona presets de usuario en localStorage con export/import.
// No toca el grafo de audio directamente: todo pasa por la API de AudioEngine;
// cada cambio se comunica a App por callback para que la definición editada
// persista entre generaciones (trackSettings.edited)
const SynthEditor = (() => {
  const LS_KEY = 'binario.userPresets';
  const USER_PREFIX = 'user:';

  const OSC_TYPES = ['sine', 'triangle', 'sawtooth', 'square', 'fatsawtooth', 'pulse'];

  // Fila de esquema: { path, label, min, max, scale?, step?, unit?, options?, fallback? }
  // Con options renderiza un select; si no, slider lineal o logarítmico
  const envRows = prefix => ([
    { path: `${prefix}.attack`, label: 'Attack', min: 0.001, max: 3, scale: 'log', unit: 's' },
    { path: `${prefix}.decay`, label: 'Decay', min: 0.01, max: 3, scale: 'log', unit: 's' },
    { path: `${prefix}.sustain`, label: 'Sustain', min: 0, max: 1 },
    { path: `${prefix}.release`, label: 'Release', min: 0.01, max: 8, scale: 'log', unit: 's' }
  ]);

  const oscRow = { path: 'oscillator.type', label: 'Onda', options: OSC_TYPES };
  const volumeRow = { path: 'volume', label: 'Ganancia', min: -24, max: 18, unit: 'dB', fallback: 0 };
  const portamentoRow = { path: 'portamento', label: 'Portamento', min: 0, max: 0.5, unit: 's', fallback: 0 };
  const detuneRow = { path: 'detune', label: 'Detune', min: -100, max: 100, step: 1, unit: 'ct', fallback: 0 };

  const SYNTH_SCHEMAS = {
    Synth: [
      { section: 'Oscilador', rows: [oscRow, detuneRow, portamentoRow] },
      { section: 'Envolvente', rows: envRows('envelope') },
      { section: 'Salida', rows: [volumeRow] }
    ],
    FMSynth: [
      { section: 'Oscilador', rows: [
        oscRow,
        { path: 'harmonicity', label: 'Harmonic', min: 0.25, max: 8, scale: 'log' },
        { path: 'modulationIndex', label: 'Índice mod', min: 0, max: 40 },
        { path: 'modulation.type', label: 'Onda mod', options: OSC_TYPES },
        portamentoRow
      ] },
      { section: 'Envolvente', rows: envRows('envelope') },
      { section: 'Envolvente de modulación', rows: envRows('modulationEnvelope') },
      { section: 'Salida', rows: [volumeRow] }
    ],
    AMSynth: [
      { section: 'Oscilador', rows: [
        oscRow,
        { path: 'harmonicity', label: 'Harmonic', min: 0.25, max: 8, scale: 'log' },
        { path: 'modulation.type', label: 'Onda mod', options: OSC_TYPES },
        portamentoRow
      ] },
      { section: 'Envolvente', rows: envRows('envelope') },
      { section: 'Salida', rows: [volumeRow] }
    ],
    MonoSynth: [
      { section: 'Oscilador', rows: [oscRow, detuneRow, portamentoRow] },
      { section: 'Envolvente', rows: envRows('envelope') },
      { section: 'Filtro', rows: [
        { path: 'filter.type', label: 'Tipo', options: ['lowpass', 'highpass', 'bandpass'] },
        { path: 'filter.Q', label: 'Q', min: 0.1, max: 15, scale: 'log' },
        { path: 'filterEnvelope.baseFrequency', label: 'Frec base', min: 20, max: 10000, scale: 'log', unit: 'Hz' },
        { path: 'filterEnvelope.octaves', label: 'Octavas', min: 0, max: 7 }
      ] },
      { section: 'Envolvente de filtro', rows: envRows('filterEnvelope') },
      { section: 'Salida', rows: [volumeRow] }
    ],
    SynthPair: [
      { section: 'Oscilador', rows: [oscRow, detuneRow] },
      { section: 'Envolvente', rows: envRows('envelope') },
      { section: 'Salida', rows: [volumeRow] }
    ]
  };

  // Los tipos deben coincidir con EFFECTS de audio.js
  const FX_SCHEMAS = {
    Filter: [
      { path: 'type', label: 'Tipo', options: ['lowpass', 'highpass', 'bandpass', 'notch'] },
      { path: 'frequency', label: 'Frec', min: 20, max: 18000, scale: 'log', unit: 'Hz' },
      { path: 'Q', label: 'Q', min: 0.1, max: 18, scale: 'log' }
    ],
    AutoFilter: [
      { path: 'frequency', label: 'Veloc', min: 0.05, max: 12, scale: 'log', unit: 'Hz' },
      { path: 'baseFrequency', label: 'Frec base', min: 40, max: 4000, scale: 'log', unit: 'Hz' },
      { path: 'octaves', label: 'Octavas', min: 0, max: 6 },
      { path: 'depth', label: 'Prof', min: 0, max: 1 },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    Chorus: [
      { path: 'frequency', label: 'Veloc', min: 0.1, max: 8, scale: 'log', unit: 'Hz' },
      { path: 'delayTime', label: 'Retardo', min: 1, max: 20, unit: 'ms' },
      { path: 'depth', label: 'Prof', min: 0, max: 1 },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    Phaser: [
      { path: 'frequency', label: 'Veloc', min: 0.05, max: 8, scale: 'log', unit: 'Hz' },
      { path: 'octaves', label: 'Octavas', min: 0, max: 6 },
      { path: 'baseFrequency', label: 'Frec base', min: 100, max: 2000, scale: 'log', unit: 'Hz' },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    Tremolo: [
      { path: 'frequency', label: 'Veloc', min: 0.1, max: 15, scale: 'log', unit: 'Hz' },
      { path: 'depth', label: 'Prof', min: 0, max: 1 },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    Vibrato: [
      { path: 'frequency', label: 'Veloc', min: 0.5, max: 12, scale: 'log', unit: 'Hz' },
      { path: 'depth', label: 'Prof', min: 0, max: 1 },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    Distortion: [
      { path: 'distortion', label: 'Cantidad', min: 0, max: 1 },
      { path: 'oversample', label: 'Oversample', options: ['none', '2x', '4x'] },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ],
    BitCrusher: [
      { path: 'bits', label: 'Bits', min: 1, max: 12, step: 1 },
      { path: 'wet', label: 'Mezcla', min: 0, max: 1 }
    ]
  };

  const FX_DEFAULTS = {
    Filter: { type: 'lowpass', frequency: 2000, Q: 1 },
    AutoFilter: { frequency: 1, baseFrequency: 200, octaves: 3, depth: 0.7, wet: 1 },
    Chorus: { frequency: 1.5, delayTime: 3.5, depth: 0.5, wet: 0.5 },
    Phaser: { frequency: 0.5, octaves: 3, baseFrequency: 350, wet: 0.5 },
    Tremolo: { frequency: 4, depth: 0.6, wet: 1 },
    Vibrato: { frequency: 5, depth: 0.15, wet: 1 },
    Distortion: { distortion: 0.3, oversample: '2x', wet: 0.5 },
    BitCrusher: { bits: 6, wet: 0.4 }
  };

  let root = null;
  let refs = null;
  let current = null; // { trackIndex, def: { base, params, chain } }
  let cbs = {};

  const clone = obj => JSON.parse(JSON.stringify(obj));

  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function setPath(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] = o[keys[i]] || {};
    o[keys[keys.length - 1]] = value;
  }

  function nested(path, value) {
    const o = {};
    setPath(o, path, value);
    return o;
  }

  function rowFallback(row) {
    if (row.fallback !== undefined) return row.fallback;
    return row.options ? row.options[0] : (row.min + row.max) / 2;
  }

  // Mapeo slider(0..1) <-> valor; el log evita que los rangos de frecuencia y
  // tiempo concentren todo lo útil en el primer tramo del recorrido
  function toSlider(row, value) {
    if (row.scale === 'log') {
      if (value <= row.min) return 0;
      return Math.log(value / row.min) / Math.log(row.max / row.min);
    }
    return (value - row.min) / (row.max - row.min);
  }

  function fromSlider(row, t) {
    let v = row.scale === 'log'
      ? row.min * Math.pow(row.max / row.min, t)
      : row.min + t * (row.max - row.min);
    if (row.step) v = Math.round(v / row.step) * row.step;
    return v;
  }

  function fmt(row, v) {
    if (typeof v !== 'number') return String(v);
    let text;
    if (row.step === 1) text = String(Math.round(v));
    else if (row.unit === 'Hz' && v >= 1000) text = `${(v / 1000).toFixed(1)}k`;
    else if (Math.abs(v) >= 100) text = v.toFixed(0);
    else if (Math.abs(v) >= 10) text = v.toFixed(1);
    else if (Math.abs(v) >= 1) text = v.toFixed(2);
    else text = v.toFixed(3);
    return row.unit ? text + row.unit : text;
  }

  // ---- Presets de usuario (localStorage) ----

  function getUserPresets() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }

  function setUserPresets(presets) {
    localStorage.setItem(LS_KEY, JSON.stringify(presets));
  }

  function getUserPresetNames() {
    return Object.keys(getUserPresets()).sort();
  }

  // Acepta 'nombre' o 'user:nombre'; devuelve una copia o null
  function getUserPreset(name) {
    const key = name.startsWith(USER_PREFIX) ? name.slice(USER_PREFIX.length) : name;
    const preset = getUserPresets()[key];
    return preset ? clone(preset) : null;
  }

  // ---- UI ----

  function notifyChange() {
    if (cbs.onChange && current) cbs.onChange(current.trackIndex, clone(current.def));
  }

  function renderRow(row, value, onChange) {
    const el = document.createElement('div');
    el.className = 'editor-row';
    const label = document.createElement('label');
    label.textContent = row.label;
    el.appendChild(label);
    if (row.options) {
      const select = document.createElement('select');
      for (const opt of row.options) {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        select.appendChild(o);
      }
      select.value = row.options.includes(value) ? value : row.options[0];
      select.addEventListener('change', () => onChange(select.value));
      el.appendChild(select);
      el.appendChild(document.createElement('span'));
    } else {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 1;
      slider.step = 0.001;
      const val = document.createElement('span');
      val.className = 'editor-val';
      let v = Number(value);
      if (!isFinite(v)) v = rowFallback(row);
      v = Math.min(row.max, Math.max(row.min, v));
      slider.value = toSlider(row, v);
      val.textContent = fmt(row, v);
      slider.addEventListener('input', () => {
        const nv = fromSlider(row, parseFloat(slider.value));
        val.textContent = fmt(row, nv);
        onChange(nv);
      });
      el.appendChild(slider);
      el.appendChild(val);
    }
    return el;
  }

  // Completa def.params con los valores reales del sinte vivo para que la
  // definición sea autosuficiente al guardarla como preset
  function materializeParams() {
    const live = AudioEngine.getTrackSynthParams(current.trackIndex) || {};
    for (const section of SYNTH_SCHEMAS[current.def.base]) {
      for (const row of section.rows) {
        if (getPath(current.def.params, row.path) === undefined) {
          const value = getPath(live, row.path);
          setPath(current.def.params, row.path, value !== undefined ? value : rowFallback(row));
        }
      }
    }
  }

  function renderSynth() {
    const col = refs.synthCol;
    col.innerHTML = '';
    const baseRow = document.createElement('div');
    baseRow.className = 'editor-row';
    const baseLabel = document.createElement('label');
    baseLabel.textContent = 'Sinte';
    baseRow.appendChild(baseLabel);
    const baseSelect = document.createElement('select');
    for (const name of AudioEngine.PRESETS) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = name;
      baseSelect.appendChild(o);
    }
    baseSelect.value = current.def.base;
    baseSelect.addEventListener('change', () => {
      current.def.base = baseSelect.value;
      current.def.params = {};
      // recrea el sinte conservando la cadena de efectos actual
      AudioEngine.setTrackPreset(current.trackIndex, {
        base: current.def.base, params: null, chain: current.def.chain
      });
      materializeParams();
      renderSynth();
      notifyChange();
    });
    baseRow.appendChild(baseSelect);
    baseRow.appendChild(document.createElement('span'));
    col.appendChild(baseRow);

    for (const section of SYNTH_SCHEMAS[current.def.base]) {
      const header = document.createElement('div');
      header.className = 'editor-section';
      header.textContent = section.section;
      col.appendChild(header);
      for (const row of section.rows) {
        col.appendChild(renderRow(row, getPath(current.def.params, row.path), value => {
          setPath(current.def.params, row.path, value);
          AudioEngine.setTrackSynthParams(current.trackIndex, nested(row.path, value));
          notifyChange();
        }));
      }
    }
  }

  function applyChain() {
    AudioEngine.setTrackChain(current.trackIndex, current.def.chain);
    renderChain();
    notifyChange();
  }

  function renderFx(fx, index) {
    const item = document.createElement('div');
    item.className = 'fx-item';
    const head = document.createElement('div');
    head.className = 'fx-head';
    const title = document.createElement('span');
    title.textContent = `${index + 1}. ${fx.type}`;
    head.appendChild(title);
    const btns = document.createElement('span');
    const mkBtn = (text, tip, handler, disabled) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = tip;
      b.disabled = !!disabled;
      b.addEventListener('click', handler);
      btns.appendChild(b);
    };
    mkBtn('↑', 'Subir en la cadena', () => {
      const chain = current.def.chain;
      [chain[index - 1], chain[index]] = [chain[index], chain[index - 1]];
      applyChain();
    }, index === 0);
    mkBtn('↓', 'Bajar en la cadena', () => {
      const chain = current.def.chain;
      [chain[index], chain[index + 1]] = [chain[index + 1], chain[index]];
      applyChain();
    }, index === current.def.chain.length - 1);
    mkBtn('✕', 'Quitar de la cadena', () => {
      current.def.chain.splice(index, 1);
      applyChain();
    });
    head.appendChild(btns);
    item.appendChild(head);
    for (const row of FX_SCHEMAS[fx.type]) {
      item.appendChild(renderRow(row, fx.params[row.path], value => {
        fx.params[row.path] = value;
        AudioEngine.setTrackEffectParams(current.trackIndex, index, { [row.path]: value });
        notifyChange();
      }));
    }
    return item;
  }

  function renderChain() {
    refs.chain.innerHTML = '';
    current.def.chain.forEach((fx, i) => refs.chain.appendChild(renderFx(fx, i)));
  }

  function updateDeleteState() {
    refs.deleteBtn.disabled = !getUserPresets()[refs.name.value.trim()];
  }

  function isOpen() {
    return !!(root && root.matches(':popover-open'));
  }

  function close() {
    if (isOpen()) root.hidePopover();
    current = null;
  }

  function ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'synth-editor';
    // manual: sin light-dismiss, para poder tocar el resto de la UI mientras
    // se edita en vivo; se cierra con ✕ o Esc
    root.setAttribute('popover', 'manual');
    root.innerHTML = `
      <div class="dialog-header">
        <span id="se-title"></span>
        <button class="dialog-close" id="se-close">✕</button>
      </div>
      <div class="editor-body">
        <div class="editor-col" id="se-synth-col"></div>
        <div class="editor-col">
          <div class="editor-section">Cadena de efectos</div>
          <div class="fx-add-row">
            <select id="se-fx-type"></select>
            <button id="se-fx-add">+ Añadir</button>
          </div>
          <div id="se-chain"></div>
        </div>
      </div>
      <div class="editor-footer">
        <input id="se-name" placeholder="nombre del preset" spellcheck="false">
        <button id="se-save" title="Guardar sinte + efectos como preset de usuario">Guardar</button>
        <button id="se-delete" title="Borrar el preset de usuario con ese nombre">Borrar</button>
        <button id="se-export" title="Descargar todos los presets de usuario (JSON)">↧</button>
        <button id="se-import" title="Importar presets de usuario (JSON)">↥</button>
        <input type="file" id="se-file" accept=".json,application/json" hidden>
      </div>`;
    document.body.appendChild(root);
    refs = {
      title: root.querySelector('#se-title'),
      synthCol: root.querySelector('#se-synth-col'),
      fxType: root.querySelector('#se-fx-type'),
      chain: root.querySelector('#se-chain'),
      name: root.querySelector('#se-name'),
      deleteBtn: root.querySelector('#se-delete'),
      file: root.querySelector('#se-file')
    };

    for (const type of Object.keys(FX_SCHEMAS)) {
      const o = document.createElement('option');
      o.value = type;
      o.textContent = type;
      refs.fxType.appendChild(o);
    }

    root.querySelector('#se-close').addEventListener('click', close);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && isOpen()) close();
    });

    root.querySelector('#se-fx-add').addEventListener('click', () => {
      const type = refs.fxType.value;
      current.def.chain.push({ type, params: clone(FX_DEFAULTS[type]) });
      applyChain();
    });

    refs.name.addEventListener('input', updateDeleteState);

    root.querySelector('#se-save').addEventListener('click', () => {
      const name = refs.name.value.trim();
      if (!name || !current) return;
      const presets = getUserPresets();
      presets[name] = clone(current.def);
      setUserPresets(presets);
      updateDeleteState();
      if (cbs.onPresetSaved) cbs.onPresetSaved(current.trackIndex, name);
    });

    root.querySelector('#se-delete').addEventListener('click', () => {
      const name = refs.name.value.trim();
      const presets = getUserPresets();
      if (!presets[name]) return;
      delete presets[name];
      setUserPresets(presets);
      updateDeleteState();
      if (cbs.onPresetsChanged) cbs.onPresetsChanged();
    });

    root.querySelector('#se-export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(getUserPresets(), null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'binario-presets.json';
      a.click();
      URL.revokeObjectURL(a.href);
    });

    root.querySelector('#se-import').addEventListener('click', () => refs.file.click());
    refs.file.addEventListener('change', () => {
      const file = refs.file.files[0];
      refs.file.value = '';
      if (!file) return;
      file.text().then(text => {
        let data;
        try { data = JSON.parse(text); } catch (e) {
          console.error('JSON de presets inválido');
          return;
        }
        const presets = getUserPresets();
        let count = 0;
        for (const [name, def] of Object.entries(data || {})) {
          if (def && SYNTH_SCHEMAS[def.base]) {
            presets[name] = {
              base: def.base,
              params: def.params || {},
              chain: (def.chain || []).filter(fx => fx && FX_SCHEMAS[fx.type])
            };
            count++;
          }
        }
        setUserPresets(presets);
        console.log(`${count} presets de usuario importados`);
        updateDeleteState();
        if (cbs.onPresetsChanged) cbs.onPresetsChanged();
      });
    });
  }

  function defFromName(name) {
    const userPreset = name.startsWith(USER_PREFIX) ? getUserPreset(name) : null;
    if (userPreset) return userPreset;
    const base = AudioEngine.PRESETS.includes(name) ? name : 'Synth';
    return { base, params: {}, chain: [] };
  }

  // resolvedName: nombre efectivo de la pista ('FMSynth' o 'user:Nombre');
  // editedDef: definición en curso si la pista ya fue editada (o null)
  function open(trackIndex, resolvedName, editedDef) {
    ensureDom();
    current = { trackIndex, def: editedDef ? clone(editedDef) : defFromName(resolvedName) };
    materializeParams();
    refs.title.textContent = `Pista ${trackIndex + 1} — sinte y efectos`;
    refs.name.value = resolvedName.startsWith(USER_PREFIX)
      ? resolvedName.slice(USER_PREFIX.length)
      : '';
    updateDeleteState();
    renderSynth();
    renderChain();
    if (!isOpen()) root.showPopover();
  }

  // Reabre con estado fresco si el preset de la pista cambió desde fuera
  function refreshIfOpen(trackIndex, resolvedName) {
    if (current && current.trackIndex === trackIndex && isOpen()) {
      open(trackIndex, resolvedName, null);
    }
  }

  // Cierra si la pista editada dejó de existir tras una regeneración
  function ensureValid(numTracks) {
    if (current && current.trackIndex >= numTracks) close();
  }

  function init(callbacks) {
    cbs = callbacks || {};
  }

  return {
    init,
    open,
    close,
    refreshIfOpen,
    ensureValid,
    getUserPresetNames,
    getUserPreset,
    USER_PREFIX
  };
})();
