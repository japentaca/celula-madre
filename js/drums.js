// Pista de percusión derivada de la célula: no tiene patrones de catálogo, su
// ritmo sale de la máscara rítmica del motivo de cada letra (bombo donde la
// célula ataca en tiempo, hi-hat en sus huecos, notas fantasma en sus
// contratiempos). Se compone al final de Composer.compose, tras todos los
// pases y tras el pad, así que ninguno la toca. Determinista: no usa azar.
// Su fila del grid lleva una celda por paso con golpe (el más importante, para
// los visualizadores) con `voices`, las celdas de todos los golpes de ese
// paso; stepEvents lleva una entrada por golpe. Las alturas son notas General
// MIDI fijas: retune y Harmony.spell se saltan las celdas `drum`
const Drums = (() => {
  const BAR = 16;
  // Notas General MIDI (canal 10) y carril (0 abajo, 1 arriba) en el piano roll
  const KIT = {
    kick: { midi: 36, lane: 0 },
    tomLow: { midi: 43, lane: 0.2 },
    tomMid: { midi: 47, lane: 0.3 },
    tomHi: { midi: 50, lane: 0.4 },
    snare: { midi: 38, lane: 0.55 },
    hat: { midi: 42, lane: 0.8 },
    open: { midi: 46, lane: 0.9 },
    crash: { midi: 49, lane: 1 }
  };
  // El golpe que representa al paso en los visualizadores 3D (uno por paso)
  const PRIORITY = ['crash', 'kick', 'snare', 'tomLow', 'tomMid', 'tomHi', 'open', 'hat'];

  // Variante por arquetipo de la letra. snare: tiempos del compás (en pasos)
  // con caja; hat: cómo se deriva el hi-hat de la célula; sync: bombos en el
  // «y» de la célula ('anticipate': solo si el tiempo siguiente queda vacío);
  // ghosts: cajas fantasma en sus semicorcheas a contratiempo; toms: toms
  // graves en sus contratiempos; open: hi-hat abierto en su silencio más largo
  const STYLES = {
    exposition: { snare: [4, 12], hat: 'gaps', sync: 'anticipate' },
    lyrical: { snare: [8], hat: 'offgaps', sync: 'none', light: true },
    dark: { snare: [8], hat: 'off', sync: 'none', toms: true, light: true },
    agitated: { snare: [4, 12], hat: 'sixteenths', sync: 'all', ghosts: true },
    brilliant: { snare: [4, 12], hat: 'eighths', sync: 'anticipate', open: true }
  };

  // Capas: 1 bombo y caja, 2 hi-hat y toms, 3 síncopas y notas fantasma. Las
  // capas 2 y 3 entran al subir la intensidad del plan formal (antes en los
  // caracteres densos)
  const LAYER2_AT = 0.15;
  const LAYER3_AT = 0.45;
  const LAYER3_DENSE_AT = 0.25;
  // Relleno de fin de frase (pasos): corto en las cadencias internas, largo
  // al final de sección
  const FILL_SHORT = 4;
  const FILL_LONG = 8;
  // Con tantas pistas melódicas atacando en un paso, el hi-hat y las notas
  // fantasma ceden (la textura ya marca esa subdivisión)
  const DUCK_ATTACKS = 3;
  const DUCK = 0.7;

  // Motivo del que deriva la percusión de una letra: el que más pesa en su
  // carácter (la madre en la exposición, su primera variación favorita en las
  // demás), para que cada letra tenga su propio ritmo
  function sourceMotif(character, motifs) {
    const w = character && character.motifWeights;
    if (!w) return motifs[0];
    let best = 0;
    for (let i = 1; i < w.length && i < motifs.length; i++) if (w[i] > w[best]) best = i;
    return motifs[best];
  }

  // Patrón de un largo de célula: pattern[paso] = [{ inst, vel, layer }]
  function buildPattern(src, style) {
    const L = src.length;
    const on = s => !!src[s].note;
    const vels = src.filter(c => c.note).map(c => c.velocity).sort((a, b) => a - b);
    const median = vels.length ? vels[Math.floor(vels.length / 2)] : 0;
    const pat = Array.from({ length: L }, () => []);
    const has = (s, inst) => pat[s].some(h => h.inst === inst);
    const put = (s, inst, vel, layer) => { if (!has(s, inst)) pat[s].push({ inst, vel, layer }); };
    const bars = L / BAR;

    // Caja en los tiempos del estilo; algo más fuerte si la célula ataca ahí
    for (let s = 0; s < L; s += 4) {
      if (style.snare.includes(s % BAR)) put(s, 'snare', on(s) ? 0.85 : 0.75, 1);
    }
    // Bombo donde la célula ataca en tiempo (salvo los tiempos de caja), en
    // la cabeza de la célula y, si un compás queda sin ninguno, en su cabeza
    for (let s = 0; s < L; s += 4) {
      if (on(s) && !has(s, 'snare')) put(s, 'kick', s % BAR === 0 ? 0.95 : 0.85, 1);
    }
    put(0, 'kick', 0.95, 1);
    for (let b = 0; b < bars; b++) {
      let any = false;
      for (let s = b * BAR; s < (b + 1) * BAR; s++) if (has(s, 'kick')) any = true;
      if (!any) put(b * BAR, 'kick', 0.9, 1);
    }
    // Síncopas: los «y» acentuados de la célula
    if (style.sync !== 'none') {
      for (let s = 2; s < L; s += 4) {
        if (!on(s) || src[s].velocity < median) continue;
        const next = (s + 2) % L;
        if (style.sync === 'all' || (!on(next) && !has(next, 'kick'))) put(s, 'kick', 0.7, 3);
      }
    }
    // Cajas fantasma en las semicorcheas a contratiempo de la célula
    if (style.ghosts) {
      for (let s = 1; s < L; s += 2) if (on(s)) put(s, 'snare', 0.3, 3);
    }
    // Toms graves en los contratiempos de la célula (carácter sombrío)
    if (style.toms) {
      for (let s = 2; s < L; s += 4) if (on(s)) put(s, 'tomLow', 0.6, 2);
      for (let s = 1; s < L; s += 2) if (on(s)) put(s, 'tomMid', 0.42, 3);
    }
    // Hi-hat
    if (style.hat === 'gaps' || style.hat === 'offgaps') {
      const stride = style.hat === 'gaps' ? 2 : 4;
      const first = style.hat === 'gaps' ? 0 : 2;
      for (let b = 0; b < bars; b++) {
        let count = 0;
        for (let s = b * BAR + first; s < (b + 1) * BAR; s += stride) {
          if (on(s)) continue;
          put(s, 'hat', s % 4 === 0 ? 0.55 : 0.45, 2);
          count++;
        }
        // célula tan llena que no deja huecos: contratiempos de corchea
        if (count < (style.hat === 'gaps' ? 2 : 1)) {
          for (let s = b * BAR + 2; s < (b + 1) * BAR; s += style.hat === 'gaps' ? 4 : 8) put(s, 'hat', 0.4, 2);
        }
      }
    } else if (style.hat === 'eighths') {
      for (let s = 0; s < L; s += 2) put(s, 'hat', on(s) ? 0.6 : s % 4 === 0 ? 0.5 : 0.4, 2);
    } else if (style.hat === 'sixteenths') {
      for (let s = 0; s < L; s++) put(s, 'hat', on(s) ? 0.6 : s % 4 === 0 ? 0.5 : s % 2 === 0 ? 0.4 : 0.28, 2);
    }
    // Hi-hat abierto en el silencio más largo de la célula
    if (style.open) {
      const onsets = [];
      for (let s = 0; s < L; s++) if (on(s)) onsets.push(s);
      let best = null;
      for (let i = 0; i < onsets.length; i++) {
        const end = i + 1 < onsets.length ? onsets[i + 1] : L;
        if (!best || end - onsets[i] > best.end - best.start) best = { start: onsets[i], end };
      }
      if (best && best.end - best.start >= 4) {
        let p = -1;
        for (let s = best.start + 2; s < best.end; s++) {
          if (s % 4 === 2) { p = s; break; }
        }
        if (p >= 0) {
          pat[p] = pat[p].filter(h => h.inst !== 'hat');
          put(p, 'open', 0.5, 2);
        }
      }
    }
    return pat;
  }

  function hitCell(inst, velocity, section) {
    const cell = {
      midi: KIT[inst].midi, degree: 0, keyOffset: section.keyOffset || 0,
      velocity: Math.max(0.05, Math.min(1, velocity)), sustain: 0.25,
      motifIndex: null, durationSteps: 1, drum: inst, lane: KIT[inst].lane
    };
    if (section.mode) cell.mode = section.mode;
    return cell;
  }

  // Ataques melódicos audibles en el paso (pistas melódicas: ctx.numTracks)
  function melodicAttacks(ctx, s) {
    let n = 0;
    for (let t = 0; t < ctx.numTracks; t++) {
      const cell = ctx.grid[t][s];
      if (cell && cell.velocity > Generator.GHOST_VELOCITY) n++;
    }
    return n;
  }

  // Compone la fila de percusión en grid[t]. motifs: los de la pieza (el
  // ritmo deriva de ellos)
  function compose(ctx, t, motifs) {
    const row = ctx.grid[t];
    const { sections, form, totalSteps, cellLength } = ctx;
    const hits = new Map();   // paso → [{ inst, vel }]
    const add = (s, inst, vel) => {
      if (s < 0 || s >= totalSteps) return;
      if (!hits.has(s)) hits.set(s, []);
      const list = hits.get(s);
      const prev = list.find(h => h.inst === inst);
      if (prev) prev.vel = Math.max(prev.vel, vel);
      else list.push({ inst, vel });
    };
    const patterns = {};
    const crashes = new Set();   // cabezas que reciben plato + bombo
    if (form && form.climaxStep !== undefined) crashes.add(Math.floor(form.climaxStep / BAR) * BAR);

    // Cierre: el último compás solo lleva un bombo en su cabeza y el anterior
    // se queda en bombo y caja
    const lastBar = totalSteps - BAR;
    const thinFrom = totalSteps - 2 * BAR;
    let entered = false;

    sections.forEach((section, index) => {
      const ch = section.character;
      const style = STYLES[ch && ch.archetype] || STYLES.exposition;
      if (!patterns[section.label]) patterns[section.label] = buildPattern(sourceMotif(ch, motifs), style);
      const pattern = patterns[section.label];
      const src = sourceMotif(ch, motifs);
      const dense = !!ch && ch.density === 'dense';
      const rt = section.retransition;
      const sectionEnd = section.startStep + section.lengthSteps;
      const phrases = section.phrases && section.phrases.length
        ? section.phrases
        : [{ startStep: section.startStep, lengthSteps: section.lengthSteps, cadence: null }];
      if (index > 0) crashes.add(section.startStep);

      phrases.forEach((phrase, j) => {
        let start = phrase.startStep;
        const end = start + phrase.lengthSteps;
        // La pieza arranca con el material solo: la percusión entra tras la
        // primera frase (o a su mitad, si esa frase es la pieza entera)
        if (index === 0 && j === 0) {
          if (end < totalSteps) return;
          start += phrase.lengthSteps / 2;
        }
        const intensity = FormPlan.intensityAt(form, start + (end - start) / 2, totalSteps);
        let maxLayer = 1;
        if (intensity >= LAYER2_AT || dense) maxLayer = 2;
        if (intensity >= LAYER3_AT || (dense && intensity >= LAYER3_DENSE_AT)) maxLayer = 3;

        const inRetrans = !!rt && end > rt.startStep;
        const fading = inRetrans && rt.shape === 'diminuendo';
        // Relleno al final de la frase; redoble en crescendo al final de la
        // retransición; nada si la retransición se apaga o la pieza termina
        const isLast = j === phrases.length - 1;
        let fill = isLast && maxLayer >= 2 && !style.light ? FILL_LONG : FILL_SHORT;
        fill = Math.min(fill, (end - start) / 4);
        let roll = 0;
        if (inRetrans && rt.shape === 'crescendo' && isLast) {
          roll = Math.min(BAR, rt.lengthSteps, end - start);
          fill = 0;
        }
        if (fading || end >= totalSteps || fill < 2) fill = 0;
        const fillStart = end - fill;
        const rollStart = end - roll;

        for (let s = start; s < end; s++) {
          if (s >= lastBar) {
            if (s === lastBar) add(s, 'kick', 0.6);
            continue;
          }
          const level = FormPlan.levelAt(form, section, s);
          const scale = 0.55 + 0.45 * Math.min(level, 1.3);
          const layerCap = s >= thinFrom || (fading && s >= rt.startStep) ? 1 : maxLayer;
          const inFill = fill > 0 && s >= fillStart;
          const inRoll = roll > 0 && s >= rollStart;
          for (const h of pattern[(s - section.startStep) % cellLength]) {
            if (h.layer > layerCap) continue;
            // en rellenos y redobles solo sigue el bombo
            if ((inFill || inRoll) && h.inst !== 'kick') continue;
            let vel = h.vel * scale;
            if (h.layer >= 2 && melodicAttacks(ctx, s) >= DUCK_ATTACKS) vel *= DUCK;
            add(s, h.inst, vel);
          }
          if (inFill) {
            const p = s - fillStart;
            // en los caracteres ralos, solo las dos últimas semicorcheas
            const cellOn = !!src[(s - section.startStep) % cellLength].note;
            const plays = p >= fill - 2 || (!style.light && (p === 0 || cellOn));
            if (plays) {
              const f = p / fill;
              const inst = f < 0.3 ? 'snare' : f < 0.55 ? 'tomHi' : f < 0.8 ? 'tomMid' : 'tomLow';
              add(s, inst, (0.5 + 0.4 * (p + 1) / fill) * scale);
            }
          }
          if (inRoll) {
            const p = s - rollStart;
            // corcheas en la primera mitad, semicorcheas en la segunda
            if (p >= roll / 2 || p % 2 === 0) add(s, 'snare', (0.3 + 0.6 * (p + 1) / roll) * scale);
          }
        }
        // tras un relleno largo o un redoble, la frase siguiente abre con plato
        if ((fill >= FILL_LONG || roll > 0) && end < totalSteps) crashes.add(end);
        // el plato de cabeza solo suena si la percusión ya había entrado
        if (crashes.has(start) && entered && start < thinFrom) {
          const scale = 0.55 + 0.45 * Math.min(FormPlan.levelAt(form, section, start), 1.3);
          add(start, 'crash', 0.6 * scale);
          add(start, 'kick', 0.95 * scale);
        }
        entered = true;
      });
      // plato del clímax (cae a mitad de frase)
      for (const s of crashes) {
        if (s <= section.startStep || s >= sectionEnd || s >= thinFrom || !hits.has(s)) continue;
        const scale = 0.55 + 0.45 * Math.min(FormPlan.levelAt(form, section, s), 1.3);
        add(s, 'crash', 0.6 * scale);
        add(s, 'kick', 0.95 * scale);
      }
    });

    const sectionOf = s => sections.find(sec => s >= sec.startStep && s < sec.startStep + sec.lengthSteps) || sections[0];
    for (const [s, list] of hits) {
      const section = sectionOf(s);
      const voices = list
        .sort((a, b) => PRIORITY.indexOf(a.inst) - PRIORITY.indexOf(b.inst))
        .map(h => hitCell(h.inst, h.vel, section));
      const top = voices[0];
      top.voices = voices;
      row[s] = top;
    }
    return hits.size > 0;
  }

  // Altas en stepEvents: una por golpe (las alturas son fijas, así que no hay
  // que rehacerlas en retune)
  function schedule(piece, t) {
    if (t === undefined || t < 0) return;
    const row = piece.grid[t];
    for (let s = 0; s < row.length; s++) {
      if (!row[s]) continue;
      for (const cell of row[s].voices) piece.stepEvents[s].push({ trackIndex: t, cell });
    }
  }

  return { compose, schedule, KIT, STYLES };
})();
