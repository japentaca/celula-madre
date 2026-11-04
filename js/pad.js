// Pista de sostén (pads / cuerdas): no toca motivos, sostiene los acordes del
// plan armónico (Harmony) con conducción de voces. Se compone al final de
// Composer.compose, tras todos los pases, así que ninguno la toca. Su fila del
// grid lleva una celda por acorde (la voz superior, para los visualizadores)
// con `voices`, las celdas de cada voz; stepEvents lleva una entrada por voz
// atacada (Pad.schedule), que referencia esas mismas celdas
const Pad = (() => {
  // Registro de las voces: debajo de las melodías y por encima del bajo
  const LOW = 48;          // Do3
  const HIGH = 74;         // Re5
  const CENTER = 59;       // Si3: centro de la primera disposición
  const MAX_SPAN = 14;     // posición cerrada: como mucho una novena entre extremos
  const VOICES = 3;
  // Velocity: nivel dinámico del plan formal escalado; un pad se oye de fondo
  const VEL_BASE = 0.42;
  const VEL_MIN = 0.28;
  const VEL_MAX = 0.62;
  // Carácter agitado o brillante: el acorde se ataca y se suelta a la blanca
  const SHORT_STEPS = 8;
  // Intervalos (semitonos mod 12) que el pad no sostiene contra una nota
  // melódica audible en tiempo fuerte: la voz del pad cede
  const CLASH = new Set([1, 6, 11]);

  const mod = (a, n) => ((a % n) + n) % n;

  function scaleLength(scale) {
    return (Generator.SCALES[scale] || Generator.SCALES.major).length;
  }

  // Altura de un grado con octava en la región del acorde, con la alteración
  // del acorde para su clase (en un acorde tenido la sensible se escribe
  // siempre: no hay línea melódica que pueda bajar)
  function voiceCell(ctx, chord, degree, octave) {
    const n = scaleLength(ctx.scale);
    const cell = { midi: null, degree, keyOffset: chord.keyOffset || 0 };
    if (chord.mode) cell.mode = chord.mode;
    if (octave) cell.octave = octave;
    const alter = chord.alters ? chord.alters[mod(degree, n)] || 0 : 0;
    if (alter) cell.alter = alter;
    cell.midi = Generator.cellMidi(degree, ctx.scale, ctx.key, cell, ctx.modulation);
    return cell;
  }

  // Todas las realizaciones de cada tono del acorde dentro del registro
  function candidates(ctx, chord) {
    const n = scaleLength(ctx.scale);
    const byTone = chord.tones.map(() => []);
    for (let d = -7; d <= 7; d++) {
      const i = chord.tones.indexOf(mod(d, n));
      if (i < 0) continue;
      for (let o = -2; o <= 2; o++) {
        const cell = voiceCell(ctx, chord, d, o);
        if (cell.midi >= LOW && cell.midi <= HIGH) byTone[i].push(cell);
      }
    }
    return byTone;
  }

  // Disposición del acorde: VOICES voces que cubren todos sus tonos (con la
  // fundamental doblada si tiene menos), en posición cerrada, la fundamental
  // abajo en el primer acorde; después, la que menos mueve las voces respecto
  // a la anterior (notas comunes quietas, el resto por el camino más corto)
  function voice(ctx, chord, prev) {
    const byTone = candidates(ctx, chord);
    const rootIdx = Math.max(0, chord.tones.indexOf(chord.root));
    // tonos a cubrir: los del acorde (hasta VOICES) y la fundamental doblada
    const needed = chord.tones.slice(0, VOICES).map((_, i) => i);
    while (needed.length < VOICES) needed.push(rootIdx);
    let best = null;
    const pick = (k, chosen) => {
      if (k === needed.length) {
        const midis = chosen.map(c => c.midi).sort((a, b) => a - b);
        for (let i = 1; i < midis.length; i++) if (midis[i] === midis[i - 1]) return;
        const span = midis[midis.length - 1] - midis[0];
        if (span > MAX_SPAN) return;
        let cost;
        if (prev) {
          const p = prev.map(c => c.midi).sort((a, b) => a - b);
          cost = midis.reduce((acc, m, i) => acc + Math.abs(m - p[i]), 0);
        } else {
          const lowest = chosen.reduce((a, b) => (b.midi < a.midi ? b : a));
          cost = Math.abs(midis.reduce((a, b) => a + b, 0) / midis.length - CENTER) +
            (mod(lowest.degree, scaleLength(ctx.scale)) === chord.root ? 0 : 6);
        }
        cost += span * 0.05;
        if (!best || cost < best.cost) best = { cost, cells: chosen.slice() };
        return;
      }
      for (const c of byTone[needed[k]]) {
        chosen.push(c);
        pick(k + 1, chosen);
        chosen.pop();
      }
    };
    pick(0, []);
    return best ? best.cells.sort((a, b) => a.midi - b.midi) : null;
  }

  function sectionAtStep(sections, s) {
    return sections.find(sec => s >= sec.startStep && s < sec.startStep + sec.lengthSteps) || null;
  }

  // ¿Suena el pad en este acorde? Calla en la primera frase de la exposición
  // (la pieza arranca con el material solo) y en lo demás sí
  function active(ctx, chord, section, index) {
    if (index !== 0) return true;
    const first = section.phrases && section.phrases[0];
    const end = first ? first.startStep + first.lengthSteps : section.startStep + ctx.cellLength;
    return chord.startStep >= end;
  }

  // Compone la fila del pad en grid[t]. Devuelve false si no hay plan armónico
  // (cromática): entonces la pista queda vacía
  function compose(ctx, t) {
    const h = ctx.harmony;
    const row = ctx.grid[t];
    if (!h || !h.chords || !h.chords.length) return false;
    const chords = h.chords;
    const last = chords[chords.length - 1];
    let prev = null;
    for (const chord of chords) {
      const section = sectionAtStep(ctx.sections, chord.startStep);
      if (!section) continue;
      const index = ctx.sections.indexOf(section);
      if (!active(ctx, chord, section, index)) { prev = null; continue; }
      const cells = voice(ctx, chord, prev);
      if (!cells) continue;
      prev = cells;
      const arch = section.character && section.character.archetype;
      const short = (arch === 'agitated' || arch === 'brilliant') && !(section.retransition &&
        chord.startStep >= section.retransition.startStep);
      const length = Math.min(chord.lengthSteps, ctx.totalSteps - chord.startStep);
      const durationSteps = short ? Math.min(length, SHORT_STEPS) : length;
      const level = FormPlan.levelAt(ctx.form, section, chord.startStep);
      const velocity = Math.max(VEL_MIN, Math.min(VEL_MAX, VEL_BASE * level));
      const voices = dropClashes(ctx, t, chord.startStep, durationSteps, cells);
      for (const v of voices) {
        v.velocity = velocity;
        v.sustain = 1;
        v.motifIndex = null;
        v.durationSteps = durationSteps;
        v.baseSteps = durationSteps;
        v.pad = true;
        if (chord === last) v.lastChord = true;
      }
      // la celda del grid es la voz superior, con todas las voces colgadas
      const top = voices[voices.length - 1];
      top.voices = voices;
      top.chord = chord;
      row[chord.startStep] = top;
    }
    return true;
  }

  // Red de seguridad: Harmony.apply ya acercó al acorde las notas de tiempo
  // fuerte, pero una nota melódica audible ajena puede quedar a un semitono o
  // un tritono de una voz del pad. Esa voz cede en ese acorde (siempre queda
  // al menos una)
  function dropClashes(ctx, padTrack, start, length, cells) {
    const sounding = [];
    for (let t = 0; t < ctx.grid.length; t++) {
      if (t === padTrack) continue;
      const row = ctx.grid[t];
      for (let s = Math.max(0, start - Generator.MAX_SUSTAIN_STEPS); s < start + length && s < row.length; s++) {
        const cell = row[s];
        if (!cell || cell.velocity <= Generator.GHOST_VELOCITY) continue;
        const end = s + (cell.durationSteps || 1);
        // tiempos fuertes en los que suena esa nota mientras dura el acorde
        for (let b = Math.max(s, start); b < Math.min(end, start + length); b++) {
          if (b % 4 === 0) { sounding.push(cell.midi); break; }
        }
      }
    }
    if (!sounding.length) return cells;
    const keep = cells.filter(c => !sounding.some(m => CLASH.has(mod(c.midi - m, 12))));
    if (keep.length) return keep;
    // si todas chocan, queda la que menos
    const score = c => sounding.filter(m => CLASH.has(mod(c.midi - m, 12))).length;
    return [cells.reduce((a, b) => (score(b) < score(a) ? b : a))];
  }

  // Altas en stepEvents de las voces del pad: una por voz, salvo las notas
  // comunes con el acorde anterior pegado, que se ligan (la voz anterior se
  // alarga y la nueva no se ataca: un pad no respira en cada cambio de
  // acorde). Se rehace en cada retune, porque la altura de las voces (y con
  // ella qué notas son comunes) cambia con la escala
  function schedule(piece, t) {
    if (t < 0) return;
    for (const events of piece.stepEvents) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].trackIndex === t) events.splice(i, 1);
    }
    const row = piece.grid[t];
    let open = [];        // voces sonando: { cell, start }
    for (let s = 0; s < row.length; s++) {
      const top = row[s];
      if (!top) continue;
      const next = [];
      for (const v of top.voices) {
        v.durationSteps = v.baseSteps;
        // `final` (la coda alarga la nota) lo lleva la voz que suena al acabar
        if (v.lastChord) v.final = true;
        else delete v.final;
        const held = open.find(o => o.cell.midi === v.midi && o.end === s);
        if (held) {
          held.cell.durationSteps += v.durationSteps;
          held.end = s + v.durationSteps;
          if (v.lastChord) held.cell.final = true;
          v.tied = true;
          next.push(held);
        } else {
          v.tied = false;
          piece.stepEvents[s].push({ trackIndex: t, cell: v });
          next.push({ cell: v, end: s + v.durationSteps });
        }
      }
      open = next;
    }
  }

  // Tras un retune: misma disposición en grados, alteraciones y midi según el
  // acorde re-descrito (Harmony.refresh), y ligaduras recalculadas
  function refresh(piece) {
    const t = piece.padTrack;
    if (t === undefined || t < 0) return;
    const h = piece.harmony;
    const n = scaleLength(piece.scale);
    for (const top of piece.grid[t]) {
      if (!top) continue;
      for (const v of top.voices) {
        const chord = top.chord;
        const alter = h && h.active !== false && chord.alters ? chord.alters[mod(v.degree, n)] || 0 : 0;
        if (alter) v.alter = alter;
        else delete v.alter;
        v.midi = Generator.cellMidi(v.degree, piece.scale, piece.key, v, piece.modulation);
      }
    }
    schedule(piece, t);
  }

  return { compose, schedule, refresh };
})();
