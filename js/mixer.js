// Consola mezcladora: un canal por pista (preset, inserts, envíos, paneo,
// mute/solo, vúmetro y fader), los retornos de reverb y delay y el master.
// No guarda estado propio: lee y escribe los ajustes por pista de App
// (trackSettings) y el grafo vía AudioEngine; lo demás lo pide a App por los
// callbacks de init, como el editor de sintes
const Mixer = (() => {
  const MAX_INSERTS = 4;
  // Pico retenido del vúmetro y su caída posterior
  const PEAK_HOLD_MS = 1500;
  const PEAK_FALL_DB_S = 24;
  // Zonas de color del vúmetro (dB)
  const METER_MID_DB = -12;
  const METER_CLIP_DB = -3;
  // El indicador del limitador se enciende a partir de esta reducción
  const LIMIT_ON_DB = -0.5;
  const FADER_MAX_DB = 6;
  // Marcas de la escala de los faders
  const SCALE_MARKS = [6, 0, -6, -12, -20, -30, -40, -60];

  let host = null;
  let root = null;
  let visible = false;
  let rafId = null;
  let meters = [];       // { source: () => [L, R] en dB, chans: [{ cover, peak, db, at, zone }] , taper }
  let limitEl = null;
  let strips = [];       // por pista: { el, inserts, mute, solo, controls }
  let busControls = {};  // nombre del ajuste de bus -> control
  let pop = null;        // popover de inserts
  let popFor = null;     // { t, slot }

  // ---- Escala de fader y vúmetro: tramos lineales en dB, más resolución
  // cerca de 0 dB que en el fondo ----
  const TAPER = [[-80, 0], [-60, 0.04], [-40, 0.16], [-30, 0.27], [-20, 0.42], [-12, 0.56], [-6, 0.68], [0, 0.82], [6, 1]];

  function rawPos(db) {
    if (!(db > TAPER[0][0])) return 0;
    for (let i = 1; i < TAPER.length; i++) {
      const [d1, p1] = TAPER[i];
      if (db <= d1) {
        const [d0, p0] = TAPER[i - 1];
        return p0 + ((db - d0) / (d1 - d0)) * (p1 - p0);
      }
    }
    return 1;
  }

  function rawDb(pos) {
    if (pos <= 0) return -Infinity;
    for (let i = 1; i < TAPER.length; i++) {
      const [d1, p1] = TAPER[i];
      if (pos <= p1) {
        const [d0, p0] = TAPER[i - 1];
        return d0 + ((pos - p0) / (p1 - p0)) * (d1 - d0);
      }
    }
    return TAPER[TAPER.length - 1][0];
  }

  // Escala normalizada a su tope (el master llega a 0 dB, los demás a +6)
  function makeTaper(maxDb) {
    const top = rawPos(maxDb);
    return {
      maxDb,
      pos: db => Math.min(1, rawPos(db) / top),
      db: pos => (pos >= 1 ? maxDb : rawDb(pos * top))
    };
  }

  const gainToDb = g => (g > 0 ? 20 * Math.log10(g) : -Infinity);
  const dbToGain = db => (db === -Infinity ? 0 : Math.pow(10, db / 20));
  const clamp01 = v => Math.max(0, Math.min(1, v));

  function fmtDb(db, digits = 1) {
    if (db === -Infinity || db < -79.5) return '−∞';
    const text = Math.abs(db).toFixed(digits);
    if (Number(text) === 0) return (0).toFixed(digits);
    return (db < 0 ? '−' : '+') + text;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---- Control arrastrable (perilla o fader): arrastre vertical, rueda,
  // flechas, doble clic al valor por defecto. Guarda la posición 0..1 sin
  // redondear para que el arrastre no se atasque en valores discretos ----
  function bindControl(el, opts) {
    const c = { value: opts.value, pos: opts.toPos(opts.value), dragging: false };
    const keyStep = opts.keyStep || 0.02;

    function paint() {
      opts.render(c.pos, c.value);
      const aria = opts.aria ? opts.aria(c.value) : c.value;
      el.setAttribute('aria-valuenow', String(aria));
      el.setAttribute('aria-valuetext', opts.format(c.value));
    }

    function input(pos) {
      c.pos = clamp01(pos);
      const v = opts.fromPos(c.pos);
      const changed = v !== c.value;
      c.value = v;
      paint();
      if (changed) opts.onInput(v);
    }

    c.set = v => {
      if (c.dragging) return;
      c.value = v;
      c.pos = opts.toPos(v);
      paint();
    };

    let startY = 0;
    let startPos = 0;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus();
      el.setPointerCapture(e.pointerId);
      c.dragging = true;
      startY = e.clientY;
      startPos = c.pos;
      el.classList.add('is-dragging');
    });
    el.addEventListener('pointermove', e => {
      if (!c.dragging) return;
      const range = typeof opts.range === 'function' ? opts.range() : opts.range;
      const fine = e.shiftKey ? 0.2 : 1;
      input(startPos + ((startY - e.clientY) / Math.max(40, range)) * fine);
    });
    const end = e => {
      if (!c.dragging) return;
      c.dragging = false;
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ya liberado */ }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => input(opts.toPos(opts.def)));
    el.addEventListener('wheel', e => {
      e.preventDefault();
      input(c.pos + (e.deltaY < 0 ? 1 : -1) * keyStep);
    }, { passive: false });
    el.addEventListener('keydown', e => {
      const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
      if (steps !== undefined) input(c.pos + steps * keyStep);
      else if (e.key === 'Home') input(0);
      else if (e.key === 'End') input(1);
      else return;
      e.preventDefault();
    });
    paint();
    return c;
  }

  // ---- Perilla: arco de 270°, unipolar o bipolar (desde el centro) ----
  const ARC_START = -135;
  const ARC_END = 135;

  function arcPath(fromDeg, toDeg) {
    const r = 12;
    const pt = deg => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(16 + r * Math.cos(a)).toFixed(2)} ${(16 + r * Math.sin(a)).toFixed(2)}`;
    };
    if (Math.abs(toDeg - fromDeg) < 0.5) return '';
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    const sweep = toDeg > fromDeg ? 1 : 0;
    return `M ${pt(fromDeg)} A ${r} ${r} 0 ${large} ${sweep} ${pt(toDeg)}`;
  }

  // opts: { label, title, value, def, min, max, step?, bipolar?, format, onInput }
  function knob(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'mx-knob-wrap';
    wrap.innerHTML = `
      <div class="mx-knob" role="slider" tabindex="0" aria-label="${escapeHtml(opts.title)}" title="${escapeHtml(opts.title)}"
        aria-valuemin="${opts.min}" aria-valuemax="${opts.max}">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path class="mx-knob-track" d="${arcPath(ARC_START, ARC_END)}"/>
          <path class="mx-knob-fill"/>
          <line class="mx-knob-ptr" x1="16" y1="16" x2="16" y2="6"/>
        </svg>
      </div>
      <span class="mx-knob-label">${escapeHtml(opts.label)}</span>
      <span class="mx-knob-val readout"></span>`;
    const el = wrap.querySelector('.mx-knob');
    const fill = wrap.querySelector('.mx-knob-fill');
    const ptr = wrap.querySelector('.mx-knob-ptr');
    const val = wrap.querySelector('.mx-knob-val');
    const span = opts.max - opts.min;
    const ctl = bindControl(el, {
      value: opts.value,
      def: opts.def,
      toPos: v => (v - opts.min) / span,
      fromPos: p => {
        let v = opts.min + p * span;
        if (opts.step) v = opts.min + Math.round((v - opts.min) / opts.step) * opts.step;
        return Math.min(opts.max, Math.max(opts.min, v));
      },
      range: 140,
      keyStep: opts.step ? opts.step / span : 0.02,
      format: opts.format,
      aria: v => Math.round(v * 1000) / 1000,
      // se dibuja el valor, no la posición: los discretos saltan a su punto
      render: (pos, value) => {
        const deg = ARC_START + ((value - opts.min) / span) * (ARC_END - ARC_START);
        const from = opts.bipolar ? 0 : ARC_START;
        fill.setAttribute('d', arcPath(Math.min(from, deg), Math.max(from, deg)));
        ptr.setAttribute('transform', `rotate(${deg.toFixed(1)} 16 16)`);
        val.textContent = opts.format(value);
      },
      onInput: opts.onInput
    });
    return { el: wrap, ctl };
  }

  // ---- Fader vertical en dB con su escala y un vúmetro estéreo ----
  // opts: { title, gain, maxDb, onInput(gain) }
  function faderBlock(opts, meterSource) {
    const taper = makeTaper(opts.maxDb);
    const block = document.createElement('div');
    block.className = 'mx-fader-block';
    const marks = SCALE_MARKS.filter(db => db <= opts.maxDb).map(db =>
      `<span style="bottom:${(100 * taper.pos(db)).toFixed(2)}%">${db > 0 ? '+' + db : db === 0 ? '0' : '−' + -db}</span>`).join('');
    block.innerHTML = `
      <div class="mx-fader-area">
        <div class="mx-fader" role="slider" tabindex="0" aria-orientation="vertical"
          aria-label="${escapeHtml(opts.title)}" title="${escapeHtml(opts.title)} (doble clic: 0 dB)"
          aria-valuemin="-80" aria-valuemax="${opts.maxDb}">
          <div class="mx-fader-slot"></div>
          <div class="mx-fader-cap"></div>
        </div>
        <div class="mx-scale" aria-hidden="true">${marks}</div>
        <div class="mx-meter" aria-hidden="true">
          <div class="mx-meter-ch"><div class="mx-meter-cover"></div><div class="mx-peak"></div></div>
          <div class="mx-meter-ch"><div class="mx-meter-cover"></div><div class="mx-peak"></div></div>
        </div>
      </div>
      <div class="mx-db readout"></div>`;
    // cortes de color del vúmetro en la escala de este fader
    block.style.setProperty('--cut-mid', `${(100 * taper.pos(METER_MID_DB)).toFixed(2)}%`);
    block.style.setProperty('--cut-clip', `${(100 * taper.pos(METER_CLIP_DB)).toFixed(2)}%`);
    const fader = block.querySelector('.mx-fader');
    const dbEl = block.querySelector('.mx-db');
    const ctl = bindControl(fader, {
      value: opts.gain,
      def: Math.min(1, dbToGain(opts.maxDb)),
      toPos: g => taper.pos(gainToDb(g)),
      fromPos: p => dbToGain(taper.db(p)),
      range: () => fader.clientHeight - 26,
      keyStep: 0.01,
      format: g => `${fmtDb(gainToDb(g))} dB`,
      aria: g => {
        const db = gainToDb(g);
        return db === -Infinity ? -80 : Math.round(db * 10) / 10;
      },
      render: (pos, g) => {
        fader.style.setProperty('--pos', pos.toFixed(4));
        dbEl.textContent = fmtDb(gainToDb(g));
      },
      onInput: opts.onInput
    });
    const chans = Array.from(block.querySelectorAll('.mx-meter-ch')).map(ch => ({
      cover: ch.querySelector('.mx-meter-cover'),
      peak: ch.querySelector('.mx-peak'),
      db: -Infinity, at: 0, last: 0, zone: '', shown: -1, peakShown: -1
    }));
    meters.push({ source: meterSource, chans, taper });
    return { el: block, ctl };
  }

  function zoneOf(db) {
    if (db >= METER_CLIP_DB) return 'clip';
    if (db >= METER_MID_DB) return 'mid';
    return 'low';
  }

  function updateMeters(now) {
    const m = AudioEngine.getMeters();
    for (const meter of meters) {
      const values = meter.source(m) || [-Infinity, -Infinity];
      meter.chans.forEach((ch, i) => {
        const db = Number.isFinite(values[i]) ? values[i] : -Infinity;
        const pos = meter.taper.pos(db);
        // menos de medio píxel no se repinta
        if (Math.abs(pos - ch.shown) > 0.002) {
          ch.shown = pos;
          ch.cover.style.transform = `scaleY(${(1 - pos).toFixed(4)})`;
        }
        // pico retenido: sube al instante, espera y cae a velocidad fija
        if (db >= ch.db) {
          ch.db = db;
          ch.at = now;
        } else if (now - ch.at > PEAK_HOLD_MS) {
          ch.db = Math.max(db, ch.db - (PEAK_FALL_DB_S * (now - ch.last)) / 1000);
        }
        ch.last = now;
        const peakPos = meter.taper.pos(ch.db);
        if (Math.abs(peakPos - ch.peakShown) > 0.002) {
          ch.peakShown = peakPos;
          ch.peak.style.bottom = `${(100 * peakPos).toFixed(2)}%`;
          ch.peak.classList.toggle('is-off', peakPos <= 0);
        }
        const zone = zoneOf(ch.db);
        if (zone !== ch.zone) {
          ch.peak.dataset.zone = zone;
          ch.zone = zone;
        }
      });
    }
    if (limitEl) {
      const red = m.reduction || 0;
      const on = red < LIMIT_ON_DB;
      limitEl.classList.toggle('is-on', on);
      // solo si cambia: cada texto nuevo es una mutación del DOM, y App
      // observa las mutaciones para repintar los sliders
      const text = on ? fmtDb(red) : '0.0';
      const b = limitEl.querySelector('b');
      if (b.textContent !== text) b.textContent = text;
    }
  }

  // Un único rAF para todos los vúmetros, solo con la consola a la vista.
  // Tone.Meter suaviza en cada lectura: hay que leer en cada frame
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    updateMeters(now);
  }

  function startMeters() {
    if (rafId === null) rafId = requestAnimationFrame(frame);
  }

  function stopMeters() {
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
  }

  // ---- Inserts ----

  // Definición { base, params, chain } de la pista lista para editar: la
  // edición en curso o, si no hay, la del preset efectivo (que pasa a serlo)
  function editableDef(t) {
    const settings = host.settingsOf(t);
    if (!settings.edited) {
      const def = SynthEditor.defFromName(host.resolvedOf(t) || 'Synth');
      settings.edited = JSON.parse(JSON.stringify({ base: def.base, params: def.params || {}, chain: def.chain || [] }));
    }
    if (!Array.isArray(settings.edited.chain)) settings.edited.chain = [];
    return settings.edited;
  }

  function chainOf(t) {
    const settings = host.settingsOf(t);
    if (settings.edited) return settings.edited.chain || [];
    const def = SynthEditor.defFromName(host.resolvedOf(t) || 'Synth');
    return def.chain || [];
  }

  function renderInserts(t) {
    const strip = strips[t];
    if (!strip) return;
    const box = strip.inserts;
    const chain = chainOf(t);
    box.innerHTML = '';
    for (let slot = 0; slot < MAX_INSERTS; slot++) {
      const fx = chain[slot];
      const el = document.createElement('div');
      el.className = 'mx-slot';
      if (fx) {
        el.classList.add('is-full');
        el.classList.toggle('is-bypassed', !!fx.bypass);
        el.innerHTML = `<button class="mx-slot-name" title="Parámetros de ${escapeHtml(fx.type)}">${escapeHtml(fx.type)}</button>` +
          `<button class="mx-slot-bypass" aria-pressed="${!fx.bypass}" title="${fx.bypass ? 'En bypass: clic para activar' : 'Activo: clic para bypass'}" aria-label="Bypass de ${escapeHtml(fx.type)}">●</button>`;
        el.querySelector('.mx-slot-name').addEventListener('click', e => openFxPop(t, slot, e.currentTarget));
        el.querySelector('.mx-slot-bypass').addEventListener('click', () => toggleBypass(t, slot));
      } else if (slot === chain.length) {
        el.innerHTML = '<button class="mx-slot-add" title="Añadir un efecto de inserción" aria-label="Añadir efecto">+</button>';
        el.querySelector('.mx-slot-add').addEventListener('click', e => openCatalog(t, e.currentTarget));
      } else {
        el.classList.add('is-empty');
      }
      box.appendChild(el);
    }
    if (chain.length > MAX_INSERTS) {
      box.title = `La cadena tiene ${chain.length} efectos: la consola muestra los ${MAX_INSERTS} primeros (quitar uno deja ver el siguiente)`;
    } else {
      box.removeAttribute('title');
    }
  }

  function toggleBypass(t, slot) {
    const def = editableDef(t);
    const fx = def.chain[slot];
    if (!fx) return;
    if (fx.bypass) delete fx.bypass;
    else fx.bypass = true;
    AudioEngine.setInsertBypass(t, slot, !!fx.bypass);
    host.commitEdited(t);
    renderInserts(t);
  }

  // Cambio estructural (añadir, quitar, reordenar): la cadena se recrea
  function applyChain(t) {
    const def = editableDef(t);
    AudioEngine.setTrackChain(t, def.chain);
    host.commitEdited(t);
    renderInserts(t);
  }

  function ensurePop() {
    if (pop) return;
    pop = document.createElement('div');
    pop.id = 'mixer-fx-pop';
    pop.className = 'mx-pop';
    pop.setAttribute('popover', 'auto');
    document.body.appendChild(pop);
    pop.addEventListener('toggle', e => {
      if (e.newState !== 'open') popFor = null;
    });
  }

  function placePop(anchor) {
    const rect = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let top = rect.bottom + 4;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 4);
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - w - 8))}px`;
  }

  function showPop(anchor) {
    if (!pop.matches(':popover-open')) pop.showPopover();
    placePop(anchor);
  }

  function popHead(title, buttons) {
    const head = document.createElement('div');
    head.className = 'mx-pop-head';
    const span = document.createElement('span');
    span.textContent = title;
    head.appendChild(span);
    const btns = document.createElement('span');
    for (const [text, tip, handler, disabled] of buttons) {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = tip;
      b.setAttribute('aria-label', tip);
      b.disabled = !!disabled;
      b.addEventListener('click', handler);
      btns.appendChild(b);
    }
    head.appendChild(btns);
    return head;
  }

  function openFxPop(t, slot, anchor) {
    ensurePop();
    const def = editableDef(t);
    const fx = def.chain[slot];
    if (!fx) return;
    popFor = { t, slot };
    pop.innerHTML = '';
    const shown = Math.min(def.chain.length, MAX_INSERTS);
    const reopen = newSlot => {
      const slotEl = strips[t] && strips[t].inserts.children[newSlot];
      const btn = slotEl && slotEl.querySelector('.mx-slot-name');
      if (btn) openFxPop(t, newSlot, btn);
      else pop.hidePopover();
    };
    pop.appendChild(popHead(`Pista ${t + 1} · ${slot + 1}. ${fx.type}`, [
      ['↑', 'Subir en la cadena', () => {
        const chain = editableDef(t).chain;
        [chain[slot - 1], chain[slot]] = [chain[slot], chain[slot - 1]];
        applyChain(t);
        reopen(slot - 1);
      }, slot === 0],
      ['↓', 'Bajar en la cadena', () => {
        const chain = editableDef(t).chain;
        [chain[slot], chain[slot + 1]] = [chain[slot + 1], chain[slot]];
        applyChain(t);
        reopen(slot + 1);
      }, slot >= shown - 1],
      ['✕', 'Quitar de la cadena', () => {
        editableDef(t).chain.splice(slot, 1);
        applyChain(t);
        pop.hidePopover();
      }]
    ]));
    const body = document.createElement('div');
    body.className = 'mx-pop-body';
    fx.params = fx.params || {};
    for (const row of SynthEditor.FX_SCHEMAS[fx.type] || []) {
      body.appendChild(SynthEditor.renderRow(row, fx.params[row.path], value => {
        // el spec vigente puede haber cambiado de objeto (el editor de sintes
        // reemplaza settings.edited al tocar el sinte)
        const cur = editableDef(t).chain[slot];
        if (!cur) return;
        cur.params = cur.params || {};
        cur.params[row.path] = value;
        AudioEngine.setTrackEffectParams(t, slot, { [row.path]: value });
        host.commitEdited(t);
      }));
    }
    pop.appendChild(body);
    showPop(anchor);
  }

  function openCatalog(t, anchor) {
    ensurePop();
    popFor = { t, slot: -1 };
    pop.innerHTML = '';
    pop.appendChild(popHead(`Pista ${t + 1} · añadir efecto`, []));
    const list = document.createElement('div');
    list.className = 'mx-catalog';
    for (const type of Object.keys(SynthEditor.FX_SCHEMAS)) {
      const b = document.createElement('button');
      b.textContent = type;
      b.addEventListener('click', () => {
        const def = editableDef(t);
        if (def.chain.length >= MAX_INSERTS) return;
        def.chain.push({ type, params: JSON.parse(JSON.stringify(SynthEditor.FX_DEFAULTS[type] || {})) });
        applyChain(t);
        const slot = def.chain.length - 1;
        const btn = strips[t].inserts.children[slot].querySelector('.mx-slot-name');
        openFxPop(t, slot, btn);
      });
      list.appendChild(b);
    }
    pop.appendChild(list);
    showPop(anchor);
  }

  // ---- Strips ----

  const sendFormat = v => fmtDb(gainToDb(v), 0);
  const panFormat = v => {
    const n = Math.round(Math.abs(v) * 100);
    return n === 0 ? 'C' : `${v < 0 ? 'L' : 'R'}${n}`;
  };

  function buildTrackStrip(t) {
    const settings = host.settingsOf(t);
    const head = host.trackHead(t);
    const el = document.createElement('div');
    el.className = 'mx-strip mx-channel';
    el.dataset.track = t;
    const chanOptions = Array.from({ length: 16 }, (_, i) =>
      `<option value="${i + 1}"${settings.midiChannel === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
    el.innerHTML = `
      <div class="mx-top">
        <div class="mx-row">
          <span class="mx-num"${head.title}>${String(t + 1).padStart(2, '0')}${head.mark}</span>
          <select class="mx-preset" title="Instrumento de la pista">${host.presetOptionsHtml(t)}</select>
        </div>
        <div class="mx-row">
          <button class="mx-edit" title="Editor del sinte (los efectos se editan aquí, en Inserts)" aria-label="Editar sinte de la pista ${t + 1}">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.3 1.9l2.8 2.8-8.6 8.6H2.7v-2.8z"/></svg>
          </button>
          <label class="mx-chan" title="Canal MIDI de la pista">ch<select>${chanOptions}</select></label>
        </div>
        <div class="mx-section">Inserts</div>
        <div class="mx-inserts"></div>
        <div class="mx-knobs mx-sends"></div>
        <div class="mx-knobs mx-panrow">
          <div class="mx-ms">
            <button class="mx-mute" title="Silenciar la pista (mute)">M</button>
            <button class="mx-solo" title="Escuchar solo esta pista (solo)">S</button>
          </div>
        </div>
      </div>`;
    const strip = { el, inserts: el.querySelector('.mx-inserts'), mute: el.querySelector('.mx-mute'), solo: el.querySelector('.mx-solo') };
    strips[t] = strip;

    const presetSelect = el.querySelector('.mx-preset');
    presetSelect.addEventListener('change', () => {
      host.choosePreset(t, presetSelect.value);
      presetSelect.innerHTML = host.presetOptionsHtml(t);
      renderInserts(t);
    });
    el.querySelector('.mx-edit').addEventListener('click', () => host.openEditor(t));
    el.querySelector('.mx-chan select').addEventListener('change', e => {
      settings.midiChannel = parseInt(e.target.value);
      MidiEngine.setTrackChannel(t, settings.midiChannel);
      host.save();
    });

    const sends = el.querySelector('.mx-sends');
    sends.appendChild(knob({
      label: 'Aux1 Rev', title: 'Envío a reverb (post-fader)', value: settings.reverb, def: 0.2, min: 0, max: 1,
      format: sendFormat,
      onInput: v => {
        host.settingsOf(t).reverb = v;
        AudioEngine.setTrackReverb(t, v);
        host.save();
      }
    }).el);
    sends.appendChild(knob({
      label: 'Aux2 Dly', title: 'Envío a delay (post-fader)', value: settings.delay, def: 0, min: 0, max: 1,
      format: sendFormat,
      onInput: v => {
        host.settingsOf(t).delay = v;
        AudioEngine.setTrackDelay(t, v);
        host.save();
      }
    }).el);
    el.querySelector('.mx-panrow').prepend(knob({
      label: 'Pan', title: 'Paneo (izquierda-derecha)', value: settings.pan, def: 0, min: -1, max: 1, bipolar: true,
      format: panFormat,
      onInput: v => {
        const s = host.settingsOf(t);
        s.pan = v;
        s.panTouched = true;
        AudioEngine.setTrackPan(t, v);
        host.save();
      }
    }).el);

    strip.mute.addEventListener('click', () => {
      host.toggleMute(t);
      syncMuteSolo();
    });
    strip.solo.addEventListener('click', () => {
      host.toggleSolo(t);
      syncMuteSolo();
    });

    el.appendChild(faderBlock({
      title: `Volumen de la pista ${t + 1}`, gain: settings.volume, maxDb: FADER_MAX_DB,
      onInput: g => {
        host.settingsOf(t).volume = g;
        AudioEngine.setTrackVolume(t, g);
        host.save();
      }
    }, m => m.tracks[t]).el);
    renderInserts(t);
    return el;
  }

  // Retorno de un auxiliar: parámetros del bus (state.bus de App), mute,
  // vúmetro y fader de retorno
  function buildReturnStrip(aux) {
    const el = document.createElement('div');
    el.className = 'mx-strip mx-return';
    const name = aux === 0 ? 'Reverb' : 'Delay';
    el.innerHTML = `
      <div class="mx-top">
        <div class="mx-row"><span class="mx-title">${aux === 0 ? 'Aux1' : 'Aux2'}</span><span class="mx-title-name">${name}</span></div>
        <div class="mx-section">Bus</div>
        <div class="mx-knobs mx-bus"></div>
        <div class="mx-fill"></div>
        <div class="mx-knobs mx-panrow">
          <div class="mx-ms"><button class="mx-mute" title="Silenciar el retorno">M</button></div>
        </div>
      </div>`;
    const bus = el.querySelector('.mx-bus');
    const names = aux === 0 ? ['revdecay'] : ['delaydiv', 'feedback'];
    for (const key of names) {
      const p = host.bus.get(key);
      const k = knob({
        label: p.label, title: p.title, value: p.value, def: p.def, min: p.min, max: p.max, step: p.step,
        format: p.format,
        onInput: v => host.bus.set(key, v)
      });
      busControls[key] = k.ctl;
      bus.appendChild(k.el);
    }
    const mute = el.querySelector('.mx-mute');
    const syncMute = () => {
      const on = AudioEngine.isReturnMuted(aux);
      mute.classList.toggle('is-on', on);
      mute.setAttribute('aria-pressed', String(on));
    };
    mute.addEventListener('click', () => {
      AudioEngine.setReturnMute(aux, !AudioEngine.isReturnMuted(aux));
      syncMute();
    });
    syncMute();
    el.appendChild(faderBlock({
      title: `Retorno de ${name.toLowerCase()}`, gain: AudioEngine.getReturnLevel(aux), maxDb: FADER_MAX_DB,
      onInput: g => {
        AudioEngine.setReturnLevel(aux, g);
        host.save();
      }
    }, m => m.returns[aux]).el);
    return el;
  }

  function buildMasterStrip() {
    const el = document.createElement('div');
    el.className = 'mx-strip mx-master';
    el.innerHTML = `
      <div class="mx-top">
        <div class="mx-row"><span class="mx-title">Master</span></div>
        <div class="mx-fill"></div>
        <div class="mx-limit" title="Reducción de ganancia del limitador de salida (dB)"><span>Lim</span><b class="readout">0.0</b></div>
      </div>`;
    limitEl = el.querySelector('.mx-limit');
    const p = host.bus.get('master');
    const block = faderBlock({
      title: 'Volumen master', gain: p.value, maxDb: 0,
      onInput: g => host.bus.set('master', g)
    }, m => m.master);
    busControls.master = block.ctl;
    el.appendChild(block.el);
    return el;
  }

  function syncMuteSolo() {
    if (!visible) return;
    strips.forEach((strip, t) => {
      if (!strip) return;
      const muted = host.isMuted(t);
      const soloed = host.isSoloed(t);
      strip.mute.classList.toggle('is-on', muted);
      strip.mute.setAttribute('aria-pressed', String(muted));
      strip.solo.classList.toggle('is-on', soloed);
      strip.solo.setAttribute('aria-pressed', String(soloed));
      strip.el.classList.toggle('is-silent', !host.isAudible(t));
    });
  }

  // Reconstruye la consola entera (pieza nueva, presets de usuario)
  function build() {
    if (!root || !visible || !host.hasPiece()) return;
    if (pop && pop.matches(':popover-open')) pop.hidePopover();
    meters = [];
    strips = [];
    busControls = {};
    limitEl = null;
    const n = host.numTracks();
    // Canales a la izquierda (scroll horizontal si no entran); retornos y
    // master en el bloque fijo de la derecha, con el hueco sobrante en medio
    root.innerHTML = '<div class="mx-channels"></div><div class="mx-master-wrap"></div>';
    const channels = root.querySelector('.mx-channels');
    for (let t = 0; t < n; t++) channels.appendChild(buildTrackStrip(t));
    const fixed = root.querySelector('.mx-master-wrap');
    fixed.appendChild(buildReturnStrip(0));
    fixed.appendChild(buildReturnStrip(1));
    fixed.appendChild(buildMasterStrip());
    syncMuteSolo();
  }

  // Ajustes de bus cambiados fuera de la consola (master en el diálogo
  // Salida, restauración de ajustes)
  function syncBus() {
    if (!visible) return;
    for (const [key, ctl] of Object.entries(busControls)) ctl.set(host.bus.get(key).value);
  }

  function setVisible(on) {
    visible = !!on;
    root.classList.toggle('hidden', !visible);
    if (visible) {
      build();
      startMeters();
    } else {
      stopMeters();
      if (pop && pop.matches(':popover-open')) pop.hidePopover();
    }
  }

  function init(containerId, callbacks) {
    root = document.getElementById(containerId);
    host = callbacks;
  }

  return { init, build, setVisible, syncBus, syncMuteSolo, isVisible: () => visible };
})();
