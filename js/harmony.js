const Harmony = (() => {
  // Intensidad del pase (0 = desactivado, 1 = normal). El plan se sortea por
  // letra de forma, pero el pase sobre la rejilla es determinista: misma
  // entrada → mismas correcciones, así la recapitulación sigue literal
  const INTENSITY = 1;

  const { GHOST_VELOCITY } = Generator;

  const mod = (a, n) => ((a % n) + n) % n;
  // Intervalo en semitonos reducido a [-6, 5]
  const signed = x => mod(x + 6, 12) - 6;

  // Familias armónicas por escala. Las progresiones son grados de la
  // fundamental relativos a la tónica LOCAL de la sección (0 = I). Se evitan
  // las tríadas disminuidas de cada modo (vii° en mayor, ii° en menor, vi° en
  // dórica, iii° en mixolidia): su tritono interno chocaría con el contrapunto.
  // Largo de progresión 2 o 4 (potencia de 2): el bucle cuadra con las
  // particiones de la sección. `pivots`: grados de la tonalidad de DESTINO
  // que se prueban como acorde pivote al preparar una modulación hacia ella
  // (predominantes primero). `deceptive`: el acorde de la cadencia rota
  // (V–vi; en dórica, cuyo vi es disminuido, V–IV)
  const HEPTATONIC_FUNCTIONS = { 0: 'T', 2: 'T', 5: 'T', 1: 'S', 3: 'S', 4: 'D', 6: 'D' };
  const FAMILIES = {
    major: {
      progressions: [[0, 3, 4, 0], [0, 5, 3, 4], [5, 3, 0, 4], [0, 4, 5, 3], [0, 1, 4, 0],
        [0, 3, 1, 4], [0, 5, 1, 4], [0, 2, 3, 4], [0, 4], [0, 3]],
      dominant: 4, predominant: 3, deceptive: 5, functions: HEPTATONIC_FUNCTIONS, pivots: [1, 3, 5]
    },
    minor: {
      progressions: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 5, 3, 4], [0, 6, 5, 4], [0, 3, 6, 2],
        [0, 2, 3, 4], [0, 6, 5, 6], [0, 3], [0, 6]],
      dominant: 4, predominant: 3, deceptive: 5, functions: HEPTATONIC_FUNCTIONS, pivots: [3, 5, 2]
    },
    dorian: {
      progressions: [[0, 3, 0, 3], [0, 3, 6, 0], [0, 1, 3, 0], [0, 2, 3, 0], [0, 6, 3, 0],
        [0, 3, 4, 0], [0, 3], [0, 6]],
      dominant: 4, predominant: 3, deceptive: 3, functions: HEPTATONIC_FUNCTIONS, pivots: [3, 1, 6]
    },
    mixolydian: {
      progressions: [[0, 6, 3, 0], [0, 4, 3, 0], [0, 6, 0, 3], [0, 3, 6, 0], [0, 1, 6, 0],
        [0, 5, 6, 0], [0, 6], [0, 3]],
      dominant: 4, predominant: 3, deceptive: 5, functions: HEPTATONIC_FUNCTIONS, pivots: [3, 6, 1]
    },
    // Pentatónica (Do Re Mi Sol La): solo hay tríadas sin segundas sobre I (Do
    // Mi Sol) y vi (La Do Mi); V y ii quedan como quintas vacías (Sol–Re,
    // Re–La), porque cualquier tercera nota formaría una segunda, que en
    // pentatónica el contrapunto trata como disonancia
    pentatonic: {
      chords: { 0: [0, 2, 3], 1: [1, 4], 3: [3, 1], 4: [4, 0, 2] },
      progressions: [[0, 4, 1, 3], [0, 3, 4, 0], [4, 1, 3, 0], [0, 1, 3, 0], [0, 4, 0, 3], [0, 3]],
      dominant: 3, predominant: 1, deceptive: 4, functions: { 0: 'T', 4: 'T', 1: 'S', 3: 'D' }, pivots: []
    }
    // La cromática no tiene centro tonal ni tríadas por grados: sin plan
  };

  // Escalas cuyo V de cadencia lleva sensible (tercera mayor, cell.alter):
  // en menor y dórica el v natural no resuelve; la mixolidia conserva su
  // cadencia modal v–I
  const LEADING_TONE_SCALES = new Set(['minor', 'dorian']);
  const MINORISH = new Set(['minor', 'dorian']);

  // Grado que sustituye a la tríada disminuida del modo (aparece cuando una
  // letra con progresión de un modo suena en una región de otro, p. ej. en el
  // relativo): la dominante por V, la predominante por IV y las de tónica
  // (vi° dórica, iii° mixolidia) por IV y I
  const DIM_SUBSTITUTE = { 6: 4, 1: 3, 5: 3, 2: 0 };

  // Al re-afinar a una escala de otro largo, el grado de cada acorde se
  // traduce por función (V sigue siendo dominante, IV pasa a ii, etc.)
  const STEP_MAP = {
    '7>5': { 0: 0, 1: 1, 2: 0, 3: 1, 4: 3, 5: 4, 6: 3 },
    '5>7': { 0: 0, 1: 1, 3: 4, 4: 5 }
  };

  const ROMAN_BY_INTERVAL = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];
  const QUALITIES = {
    '0,4,7': 'maj', '0,3,7': 'min', '0,3,6': 'dim', '0,4,8': 'aug',
    '0,5,7': 'sus4', '0,2,7': 'sus2', '0,7': '5', '0,5': '5'
  };

  function familyOf(scale) {
    return FAMILIES[scale] || null;
  }

  function scaleLength(scale) {
    return (Generator.SCALES[scale] || Generator.SCALES.major).length;
  }

  const sameRegion = (a, b) =>
    (a.keyOffset || 0) === (b.keyOffset || 0) && (a.mode || null) === (b.mode || null);

  // Tónica local en modulación suave, en grados de la escala base: los grados
  // base se reparten biyectivamente sobre la escala de destino y su tónica es
  // el grado cuya altura alterada cae en key + keyOffset
  function localTonic(scale, keyOffset) {
    if (!keyOffset) return 0;
    const n = scaleLength(scale);
    for (let d = 0; d < n; d++) {
      if (mod(Generator.degreeToMidiInKey(d, scale, 0, keyOffset), 12) === keyOffset) return d;
    }
    return 0;
  }

  // Marco tonal de una región { keyOffset, mode }: cómo suenan sus grados.
  // pcs[d]: clase de altura (semitonos sobre la tonalidad base, sin `alter`)
  // del grado d; tonicDeg: grado de la tónica local (0 con modulación real,
  // donde los grados se cuentan desde ella; el de la tónica alterada en la
  // suave, donde siguen siendo los de la base); scale: escala local, que
  // decide la familia armónica (el relativo de una pieza mayor es menor)
  function frameOf(ctx, region) {
    const n = scaleLength(ctx.scale);
    const keyOffset = region.keyOffset || 0;
    if (ctx.modulation === 'soft') {
      const pcs = [];
      for (let d = 0; d < n; d++) pcs.push(mod(Generator.degreeToMidiInKey(d, ctx.scale, 0, keyOffset), 12));
      return { n, pcs, tonicDeg: localTonic(ctx.scale, keyOffset), tonicPc: keyOffset, scale: ctx.scale };
    }
    const r = Generator.regionOf(ctx.scale, keyOffset, region.mode);
    return { n, pcs: Generator.SCALES[r.scale].map(i => mod(r.tonic + i, 12)), tonicDeg: 0, tonicPc: r.tonic, scale: r.scale };
  }

  // Grados (clases, en el marco) de la tríada propia sobre el grado `step`
  function triadIn(frame, step) {
    const fam = familyOf(frame.scale);
    if (fam && fam.chords) return (fam.chords[step] || fam.chords[0]).map(d => mod(d + frame.tonicDeg, frame.n));
    return [step, step + 2, step + 4].map(d => mod(d + frame.tonicDeg, frame.n));
  }

  function qualityOf(pcs) {
    const rel = [...new Set(pcs.map(pc => mod(pc - pcs[0], 12)))].sort((a, b) => a - b);
    return QUALITIES[rel.join(',')] || 'other';
  }

  function safeStep(frame, step) {
    if (frame.n !== 7) return step;
    const tones = triadIn(frame, step);
    return qualityOf(tones.map(d => frame.pcs[d])) === 'dim' ? DIM_SUBSTITUTE[step] : step;
  }

  function roman(interval, quality) {
    const label = ROMAN_BY_INTERVAL[mod(interval, 12)];
    return quality === 'min' || quality === 'dim' ? label.toLowerCase() : label;
  }

  // Deletrea en el marco F (heptatónico) un acorde dado por sus clases de
  // altura [fundamental, tercera, quinta]: elige la fundamental cuyo apilado
  // por terceras necesita menos alteraciones (±1 semitono) y devuelve sus
  // grados y las alteraciones por clase de grado. La séptima opcional (de una
  // dominante) no es tono del acorde — chocaría con la fundamental — pero sí
  // tiñe el compás: su alteración se aplica igual (Sib en el V7/IV de Do)
  function spellChord(F, target, seventhPc) {
    let best = null;
    for (let r = 0; r < 7; r++) {
      const classes = target.map((_, i) => (r + 2 * i) % 7);
      const alt = target.map((pc, i) => signed(pc - F.pcs[classes[i]]));
      const cost = alt.reduce((a, x) => a + (Math.abs(x) > 1 ? 10 : Math.abs(x)), 0);
      if (!best || cost < best.cost) best = { classes, alt, cost };
    }
    const alters = {};
    best.classes.forEach((c, i) => { if (best.alt[i]) alters[c] = best.alt[i]; });
    let seventh = false;
    if (seventhPc !== undefined) {
      const c7 = (best.classes[0] + 6) % 7;
      const a7 = signed(seventhPc - F.pcs[c7]);
      if (a7 && Math.abs(a7) === 1) {
        alters[c7] = a7;
        seventh = true;
      }
    }
    return { tones: best.classes, alters: Object.keys(alters).length ? alters : null, seventh };
  }

  // Acorde pivote hacia la región G desde el marco F: un grado de la lista
  // `pivots` de la familia de destino cuya tríada (no disminuida) es diatónica
  // en ambas tonalidades y no es la tónica ni la dominante de destino. null si
  // no hay (p. ej. hacia el homónimo menor, que no comparte predominantes)
  function pivotStep(F, G) {
    if (F.n !== 7 || G.n !== 7) return null;
    for (const k of familyOf(G.scale).pivots) {
      const pcs = triadIn(G, k).map(d => G.pcs[d]);
      if (qualityOf(pcs) === 'dim') continue;
      if (pcs.every(pc => F.pcs.includes(pc))) return k;
    }
    return null;
  }

  // Rellena los campos derivados de un acorde a partir de su especificación
  // simbólica y de las regiones de su sección y de la siguiente: fundamental y
  // tonos (clases de grado en el marco de la sección), `alters` (semitonos por
  // clase de grado que Harmony.spell aplica a toda nota de esa clase mientras
  // dura el acorde, o null), calidad, cifrado y función. Especificación:
  //   { step }                        acorde propio sobre el grado `step`
  //   { step, role: 'cadential' }     V de cadencia (sensible en menor/dórica)
  //   { ref: 'next', role: 'prep' }   dominante de la tonalidad siguiente (V/x)
  //   { ref: 'next', role: 'pivot', step }  pivote: grado `step` de la
  //                                   siguiente, diatónico también aquí
  // Se recalcula en cada retune, así que el plan no depende del midi guardado
  function describe(chord, ctx, section, next) {
    const F = frameOf(ctx, section);
    const fam = familyOf(F.scale);
    chord.alters = null;
    delete chord.pivotOf;
    delete chord.prepared;
    let step = chord.step;
    if (chord.ref === 'next' && next) {
      const G = frameOf(ctx, next);
      const nextTonic = roman(G.tonicPc - F.tonicPc, MINORISH.has(G.scale) ? 'min' : 'maj');
      if (F.n === 7 && G.n === 7) {
        let spelled;
        if (chord.role === 'prep') {
          const root = G.tonicPc + 7;
          spelled = spellChord(F, [root, root + 4, root + 7].map(pc => mod(pc, 12)), mod(root + 10, 12));
          chord.label = `V${spelled.seventh ? '7' : ''}/${nextTonic}`;
          chord.fn = 'D';
          chord.prepared = true;
        } else {
          const gTones = triadIn(G, chord.step);
          spelled = spellChord(F, gTones.map(d => G.pcs[d]));
        }
        chord.root = spelled.tones[0];
        chord.tones = spelled.tones;
        chord.alters = spelled.alters;
        const pcs = chord.tones.map(d => mod(F.pcs[d] + ((spelled.alters && spelled.alters[d]) || 0), 12));
        chord.quality = qualityOf(pcs);
        if (chord.role === 'pivot') {
          const own = roman(pcs[0] - F.tonicPc, chord.quality);
          chord.pivotOf = roman(pcs[0] - G.tonicPc, chord.quality);
          chord.label = spelled.alters ? `${chord.pivotOf}/${nextTonic}` : own;
          chord.fn = 'S';
        }
        return chord;
      }
      // Pentatónica: sin tríadas por terceras ni alteraciones. La dominante de
      // destino solo se usa si es un acorde propio; si no, semicadencia
      if (chord.role === 'prep') {
        const target = mod(G.tonicPc + 7, 12);
        const own = Object.keys(fam.chords || {}).map(Number)
          .find(k => F.pcs[triadIn(F, k)[0]] === target);
        step = own !== undefined ? own : fam.dominant;
        chord.prepared = own !== undefined;
      } else {
        step = fam.predominant;
      }
    }
    step = safeStep(F, step);
    chord.tones = triadIn(F, step);
    chord.root = chord.tones[0];
    if (chord.role === 'cadential' && F.n === 7 && LEADING_TONE_SCALES.has(F.scale)) {
      const third = chord.tones[1];
      const alter = signed(F.pcs[chord.root] + 4 - F.pcs[third]);
      if (alter) chord.alters = { [third]: alter };
    }
    const pcs = chord.tones.map(d => mod(F.pcs[d] + ((chord.alters && chord.alters[d]) || 0), 12));
    // En la pentatónica con modulación suave la escala colapsa grados a 3–4
    // quintas de distancia y el acorde puede deformarse: calidad 'other'
    chord.quality = qualityOf(pcs);
    const suffix = { dim: '°', aug: '+', sus4: 'sus4', sus2: 'sus2', 5: '5' }[chord.quality] || '';
    chord.label = roman(pcs[0] - F.tonicPc, chord.quality) + suffix;
    chord.fn = chord.role === 'prep' ? 'D' : (fam.functions[step] || 'T');
    return chord;
  }

  // Cadencia sobre los acordes [start, end] de una frase (índices de la
  // sección), según su tipo:
  //   'authentic'  … IV? – V – I (consecuente; última sección: en la base)
  //   'deceptive'  … V – vi (consecuente de una frase interna: cadencia rota)
  //   'half'       … – V, abierta (antecedente, o fin de sección que sigue en
  //                la misma tonalidad)
  //   'modulating' (sigue otra tonalidad) … – pivote – V/x: la preparación.
  //                El pivote (acorde común a ambas tonalidades, funcionando
  //                como predominante de la nueva) solo si quedan al menos 2
  //                acordes propios antes, para no borrar la tonalidad propia;
  //                sin pivote posible (homónimo), el acorde del bucle. En la
  //                pentatónica V/x es el acorde propio con esa fundamental
  //                (con modulación real siempre lo hay entre tonalidades
  //                vecinas por quintas; si no, queda la semicadencia)
  // `tail` (retransición, FormPlan): número de acordes finales de la frase
  // sobre la dominante de la tonalidad que sigue — V prolongado ('half', con
  // sensible) o V/x ('modulating') — marcados `retrans`; con 4 o más, el
  // primero de ellos es el pivote o la predominante que lo prepara. Si el
  // bucle ya dejaba V justo antes, se cambia por I (semicadencia) o por la
  // subdominante (perfecta) para no repetir el dominante
  function applyCadence(out, start, end, kind, fam, pivot, tail = 1) {
    const V = { step: fam.dominant, role: 'cadential' };
    if (kind === 'authentic' || kind === 'deceptive') {
      out[end] = { step: kind === 'authentic' ? 0 : fam.deceptive };
      if (end - 1 >= start) out[end - 1] = { ...V };
      if (end - 2 >= start && out[end - 2].step === fam.dominant && !out[end - 2].role) out[end - 2] = { step: fam.predominant };
      return;
    }
    const v = tail >= 4 ? tail - 1 : tail;
    const dominant = kind === 'modulating' ? { step: fam.dominant, ref: 'next', role: 'prep' } : V;
    for (let k = end - v + 1; k <= end; k++) out[k] = tail > 1 ? { ...dominant, retrans: true } : { ...dominant };
    const p = end - v;
    if (p < start) return;
    if (kind === 'modulating') {
      // En la pentatónica (sin pivotes) la predominante suele ser el mismo
      // acorde que prepara (II5): se deja el bucle
      if (p >= 2 && pivot !== null) out[p] = { step: pivot, ref: 'next', role: 'pivot' };
      else if (p >= 2 && !fam.chords) out[p] = { step: fam.predominant };
    } else if (tail >= 4) {
      out[p] = { step: fam.predominant };
    } else if (out[p].step === fam.dominant && !out[p].role) {
      out[p] = { step: 0 };
    }
  }

  function cadenceKind(section, next) {
    if (!next) return 'authentic';
    return sameRegion(section, next) ? 'half' : 'modulating';
  }

  // Acordes de una sección: el bucle de la letra arranca en cada frase
  // (FormPlan: section.phrases) y cada frase cierra con su cadencia (en
  // chord.cadence del último acorde): las internas según el plan formal
  // (antecedente en semicadencia, consecuente en perfecta o rota), la última
  // según lo que sigue (cadenceKind) y, si la sección precede a la
  // recapitulación, prolongando la dominante a lo largo de la retransición.
  // Toda frase tiene al menos 2 acordes (frase >= 64 pasos o la sección
  // entera; acorde <= media célula)
  function buildSectionChords(section, next, letterPlan, ctx) {
    const { chordSteps, progression } = letterPlan;
    const F = frameOf(ctx, section);
    const fam = familyOf(F.scale);
    const kind = cadenceKind(section, next);
    const pivot = kind === 'modulating' ? pivotStep(F, frameOf(ctx, next)) : null;
    const count = section.lengthSteps / chordSteps;
    const phrases = section.phrases && section.phrases.length
      ? section.phrases
      : [{ startStep: section.startStep, lengthSteps: section.lengthSteps, cadence: null }];
    const out = new Array(count);
    const ends = [];
    phrases.forEach((phrase, j) => {
      const a = (phrase.startStep - section.startStep) / chordSteps;
      const b = a + phrase.lengthSteps / chordSteps - 1;
      for (let i = a; i <= b; i++) out[i] = { step: progression[(i - a) % progression.length] };
      const isLast = j === phrases.length - 1;
      const rt = section.retransition;
      const tail = isLast && rt ? rt.lengthSteps / chordSteps : 1;
      const cadence = isLast ? kind : phrase.cadence;
      applyCadence(out, a, b, cadence, fam, pivot, tail);
      ends.push({ b, cadence });
    });
    const chords = out.map((spec, i) => describe({
      startStep: section.startStep + i * chordSteps,
      lengthSteps: chordSteps,
      keyOffset: section.keyOffset || 0,
      mode: section.mode || null,
      ...spec
    }, ctx, section, next));
    for (const e of ends) chords[e.b].cadence = e.cadence;
    return chords;
  }

  // Encaje de una progresión con la melodía ya colocada: fracción de ataques
  // audibles en cabeza de medio compás que ya son tono del acorde
  function fitness(chords, ctx) {
    let hits = 0;
    let total = 0;
    const n = scaleLength(ctx.scale);
    for (const chord of chords) {
      for (let s = chord.startStep; s < chord.startStep + chord.lengthSteps; s += 8) {
        for (let t = 0; t < ctx.numTracks; t++) {
          const cell = ctx.grid[t][s];
          if (!cell || cell.velocity <= GHOST_VELOCITY) continue;
          total++;
          if (chord.tones.includes(mod(cell.degree, n))) hits++;
        }
      }
    }
    return total ? hits / total : 0;
  }

  // ctx: { sections, grid, numTracks, cellLength, scale, key, totalSteps, modulation }
  // Plan armónico de la pieza, sorteado por letra de forma (invariante 7): el
  // ritmo armónico (un acorde cada cellLength/4 o /2 pasos, en [8, 32]) y la
  // progresión en bucle (grados desde la tónica local). Entre las
  // progresiones de la familia de la primera aparición se prefieren las que
  // ya encajan con la melodía (sorteo ponderado: armonizar la célula más que
  // forzarla); si la letra reaparece en una región de otro modo (relativo,
  // homónimo), la misma progresión se lee en ese modo, con la tríada
  // disminuida sustituida. Las cadencias dependen de la posición, igual que
  // la tonalidad: la última sección cierra con V–I, las que preceden a una
  // modulación la preparan y las demás quedan en semicadencia. Corre antes
  // de humanizar, que usa el acorde final, sobre la rejilla recién colocada.
  // Escribe section.chords/progression/progressionSteps/chordSteps/cadence y
  // devuelve el plan { scale, active, chords } (todos los acordes de la
  // pieza, los mismos objetos que section.chords) o null en la cromática
  function plan(ctx) {
    if (!familyOf(ctx.scale) || INTENSITY === 0) {
      for (const section of ctx.sections) {
        section.chords = [];
        section.progression = null;
        section.cadence = null;
      }
      return null;
    }
    const byLetter = {};
    ctx.sections.forEach((section, i) => {
      const next = ctx.sections[i + 1] || null;
      if (!byLetter[section.label]) {
        const fam = familyOf(frameOf(ctx, section).scale);
        const options = [ctx.cellLength / 4, ctx.cellLength / 2].filter(h => h >= 8 && h <= 32);
        const chordSteps = Generator.pickRandom(options);
        const scored = fam.progressions.map(progression => {
          const chords = buildSectionChords(section, next, { chordSteps, progression }, ctx);
          return { progression, weight: Math.exp(8 * fitness(chords, ctx)) };
        });
        let r = Math.random() * scored.reduce((sum, c) => sum + c.weight, 0);
        let pick = scored[scored.length - 1];
        for (const c of scored) {
          r -= c.weight;
          if (r <= 0) { pick = c; break; }
        }
        byLetter[section.label] = { chordSteps, progression: pick.progression };
      }
      const letterPlan = byLetter[section.label];
      section.chords = buildSectionChords(section, next, letterPlan, ctx);
      section.progressionSteps = letterPlan.progression;
      section.chordSteps = letterPlan.chordSteps;
      section.cadence = cadenceKind(section, next);
      if (section.phrases && section.phrases.length) section.phrases[section.phrases.length - 1].cadence = section.cadence;
      labelProgression(section, ctx);
    });
    return { scale: ctx.scale, active: true, chords: ctx.sections.flatMap(s => s.chords) };
  }

  // Cifrado del bucle de la letra en el modo de la sección
  function labelProgression(section, ctx) {
    section.progression = section.progressionSteps.map(step =>
      describe({ step, keyOffset: section.keyOffset, mode: section.mode }, ctx, section, null).label);
  }

  // Acorde vigente en cada paso (o null): lo usan el pase, el contrapunto,
  // las alteraciones y quien necesite consultar el plan paso a paso. Se
  // cachea por plan (los acordes no cambian de sitio, solo de descripción)
  const mapCache = new WeakMap();
  function chordMap(ctx) {
    const h = ctx.harmony;
    if (!h || h.active === false) return null;
    let map = mapCache.get(h);
    if (!map || map.length !== ctx.totalSteps) {
      map = new Array(ctx.totalSteps).fill(null);
      for (const chord of h.chords) {
        for (let s = chord.startStep; s < chord.startStep + chord.lengthSteps && s < ctx.totalSteps; s++) map[s] = chord;
      }
      mapCache.set(h, map);
    }
    return map;
  }

  // Altura sin alteración de una nota (o de un grado candidato) en su región
  function naturalMidi(ctx, cell, degree) {
    return Generator.cellMidi(degree, ctx.scale, ctx.key, { keyOffset: cell.keyOffset, mode: cell.mode, octave: cell.octave }, ctx.modulation);
  }

  // ¿La línea de la pista sigue en el sentido de la alteración? Una
  // alteración es una nota de tendencia: la sensible (+1) sube a la tónica,
  // la séptima de una dominante (−1) baja. Se escribe solo si la nota
  // siguiente de la pista (sin alterar, para no depender de su propia
  // alteración) queda igual o más allá en ese sentido, o si no hay
  // siguiente: menor melódica, no armónica — Sol♯ bajando a Fa sonaba a nota
  // falsa. Las repeticiones de la misma altura se saltan (Sol Sol La: las
  // dos suben; Sol Sol Fa: ninguna, sin un Sol♯–Sol cromático en medio). Una
  // celda que aún no está en la rejilla (adorno recién creado) se altera; el
  // spell final de compose la deja coherente con su contexto
  function resolves(ctx, s, cell, degree, alter) {
    const row = ctx.grid.find(r => r[s] === cell);
    if (!row) return true;
    const own = naturalMidi(ctx, cell, degree);
    for (let p = s + 1; p < row.length; p++) {
      const next = row[p];
      if (!next) continue;
      const d = naturalMidi(ctx, next, next.degree) - own;
      if (d === 0) continue;
      return alter > 0 ? d > 0 : d < 0;
    }
    return true;
  }

  // Alteración (semitonos) que corresponde al grado `degree` de una nota de
  // la región de `cell` en el paso s: la del acorde vigente para esa clase de
  // grado (sensible del V en menor, notas de una dominante secundaria) si la
  // línea de la pista resuelve en su sentido (`resolves`), o 0. Las notas de
  // otra región (adornos junto a una frontera) no se alteran. Depende de la
  // nota siguiente de la pista, así que quien cambia o quita una nota deja
  // desfasada la anterior: Composer.compose cierra con un `spell`
  function alterAt(ctx, s, cell, degree) {
    const map = chordMap(ctx);
    const chord = map && map[s];
    if (!chord || !chord.alters || !sameRegion(chord, cell)) return 0;
    const alter = chord.alters[mod(degree, scaleLength(ctx.scale))] || 0;
    return alter && resolves(ctx, s, cell, degree, alter) ? alter : 0;
  }

  // midi que tendría la nota `cell` del paso s con el grado `degree`
  function midiAt(ctx, s, cell, degree) {
    const alter = alterAt(ctx, s, cell, degree);
    return Generator.cellMidi(degree, ctx.scale, ctx.key, { keyOffset: cell.keyOffset, mode: cell.mode, octave: cell.octave, alter }, ctx.modulation);
  }

  // Única forma de escribir la altura de una nota en los pases: grado, su
  // alteración según el plan y midi derivado de ambos (retune-safe)
  function setPitch(ctx, s, cell, degree) {
    cell.degree = degree;
    const alter = alterAt(ctx, s, cell, degree);
    if (alter || cell.alter) cell.alter = alter;
    cell.midi = Generator.cellMidi(degree, ctx.scale, ctx.key, cell, ctx.modulation);
  }

  // Aplica a toda la rejilla las alteraciones del plan (tras planificar, al
  // cerrar los pases y en cada retune): toda nota de la clase alterada
  // mientras dura el acorde la lleva si su línea resuelve, también en tiempo
  // débil. Devuelve cuántas notas cambiaron de altura
  function spell(ctx) {
    let changed = 0;
    for (const row of ctx.grid) {
      for (let s = 0; s < row.length; s++) {
        const cell = row[s];
        if (!cell) continue;
        const before = cell.midi;
        setPitch(ctx, s, cell, cell.degree);
        if (cell.midi !== before) changed++;
      }
    }
    return changed;
  }

  // Re-describe el plan tras un retune (no regenera: los grados relativos de
  // cada acorde se conservan). Entre escalas del mismo largo los tonos en
  // grados no cambian, solo calidad, cifrado y alteraciones; a otro largo el
  // grado se traduce por función; a la cromática el plan queda inactivo
  // hasta volver. Reescribe cell.alter de toda la pieza (la sensible de menor
  // sobra en mayor, la dominante secundaria cambia con el modo)
  function refresh(piece) {
    const h = piece.harmony;
    if (!h) return;
    const fam = familyOf(piece.scale);
    h.active = !!fam;
    if (fam) {
      const from = scaleLength(h.scale);
      const to = scaleLength(piece.scale);
      const map = from === to ? null : STEP_MAP[from + '>' + to];
      piece.sections.forEach((section, i) => {
        const next = piece.sections[i + 1] || null;
        for (const chord of section.chords) {
          if (chord.originalStep === undefined) chord.originalStep = chord.step;
          chord.step = map ? map[chord.originalStep] : chord.originalStep;
          describe(chord, piece, section, next);
        }
        if (section.progressionSteps) labelProgression(section, piece);
      });
      if (!map) h.scale = piece.scale;
    }
    spell(piece);
  }

  // Tonos del acorde final (I de la tonalidad base), para que el final del
  // humanizador se pose en él. Sin plan (cromática), la tríada más cercana a
  // tercera y quinta sobre la tónica
  function finalChord(ctx) {
    const n = scaleLength(ctx.scale);
    if (ctx.harmony && ctx.harmony.chords.length) {
      const chord = ctx.harmony.chords[ctx.harmony.chords.length - 1];
      return { size: n, root: chord.root, degrees: chord.tones };
    }
    const intervals = Generator.SCALES[ctx.scale] || Generator.SCALES.major;
    const nearest = target => {
      let best = 0;
      intervals.forEach((iv, idx) => {
        if (Math.abs(iv - target) < Math.abs(intervals[best] - target)) best = idx;
      });
      return best;
    };
    return { size: n, root: 0, degrees: [0, nearest(3.5), nearest(7)] };
  }

  // ¿Es `degree` tono del acorde? Con `region` (una celda), además debe ser
  // de la región del acorde: los grados de otra tonalidad no son comparables
  function isChordTone(chord, degree, n, region) {
    if (region && !sameRegion(chord, region)) return false;
    return chord.tones.includes(mod(degree, n));
  }

  // Nota de paso o bordadura: llega y sale por grado conjunto, con notas a
  // menos de un tiempo a cada lado. Esas vecinas caen en pasos débiles (que el
  // pase no toca) o en cabezas de medio compás (ya fijadas en la fase 1), así
  // que la tolerancia no cambia al re-ejecutar el pase
  function isNonChordOrnament(row, s, degree, totalSteps) {
    let prev = null;
    for (let p = s - 1; p >= Math.max(0, s - 4); p--) if (row[p]) { prev = row[p]; break; }
    let next = null;
    for (let p = s + 1; p <= Math.min(totalSteps - 1, s + 4); p++) if (row[p]) { next = row[p]; break; }
    return !!prev && !!next && Math.abs(prev.degree - degree) === 1 && Math.abs(next.degree - degree) === 1;
  }

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key, modulation, harmony }
  // Ajusta la rejilla al plan armónico, en grados:
  //   1. En cabeza de acorde y de medio compás (s % 8 === 0) toda nota audible
  //      ajena al acorde se mueve ±1 grado al tono del acorde más cercano (en
  //      7 y 5 notas siempre hay uno a un grado); entre dos opciones, la más
  //      cercana a la nota anterior de la pista y, si empatan, hacia abajo.
  //   2. En la cabeza de cada acorde (y en cada medio compás de la
  //      retransición), la voz más grave que ataca (la de midi
  //      más bajo; las pistas comparten registro, así que «bajo» es por nota y
  //      no por pista) baja hasta la fundamental si está a 1–2 grados por
  //      debajo — de tercera a fundamental, sin saltos que deformen la línea.
  //      Al bajar sigue siendo la más grave, así que la elección es estable.
  //   3. En los demás tiempos (s % 4 === 0) igual que en 1, salvo notas de
  //      paso o bordaduras por grado conjunto, que se toleran.
  // Los tiempos débiles quedan libres. No toca notas fantasma (velocity ≤
  // GHOST_VELOCITY), las finales (cell.final, ya en la tríada de tónica), la
  // pista de recapitulación en su sección (su retorno es literal) ni notas de
  // otra región que la del acorde. Determinista e idempotente; nunca añade,
  // quita ni desplaza notas, ni toca velocity o sustain; solo escribe degree
  // (y la alteración que le toca) y deriva midi (retune-safe). Corre tras
  // Energy (armoniza la textura ya aclarada) y antes del contrapunto, que
  // resuelve los choques que queden
  function apply(ctx) {
    const stats = { checked: 0, inChordBefore: 0, moved: 0, bass: 0, tolerated: 0, unresolved: 0 };
    if (INTENSITY === 0 || !ctx.harmony) return stats;
    const n = scaleLength(ctx.scale);
    const chords = chordMap(ctx);
    if (!chords) return stats;
    const recapAt = new Array(ctx.totalSteps).fill(-1);
    for (const section of ctx.sections) {
      if (!section.recap) continue;
      for (let s = section.startStep; s < section.startStep + section.lengthSteps; s++) recapAt[s] = section.recapTrack;
    }
    const eligible = (t, s, chord) => {
      const cell = ctx.grid[t][s];
      return cell && cell.velocity > GHOST_VELOCITY && !cell.final && recapAt[s] !== t && sameRegion(chord, cell) ? cell : null;
    };
    const prevDegree = (t, s) => {
      for (let p = s - 1; p >= 0; p--) if (ctx.grid[t][p]) return ctx.grid[t][p].degree;
      return null;
    };
    const moveToChord = (t, s, cell, chord) => {
      const options = [cell.degree - 1, cell.degree + 1]
        .filter(d => d >= -7 && d <= 7 && isChordTone(chord, d, n));
      if (!options.length) {
        stats.unresolved++;
        return;
      }
      const prev = prevDegree(t, s);
      if (options.length === 2 && prev !== null &&
          Math.abs(options[1] - prev) < Math.abs(options[0] - prev)) options.reverse();
      setPitch(ctx, s, cell, options[0]);
      stats.moved++;
    };

    // Medición antes de tocar nada: notas audibles en tiempo fuerte en el acorde
    for (let s = 0; s < ctx.totalSteps; s += 4) {
      const chord = chords[s];
      if (!chord) continue;
      for (let t = 0; t < ctx.numTracks; t++) {
        const cell = ctx.grid[t][s];
        if (!cell || cell.velocity <= GHOST_VELOCITY) continue;
        stats.checked++;
        if (isChordTone(chord, cell.degree, n)) stats.inChordBefore++;
      }
    }

    // Fases 1 y 2: cabezas de acorde y de medio compás. En la retransición
    // (chord.retrans) el bajo va a la fundamental en cada medio compás, no
    // solo en la cabeza del acorde: pedal de dominante
    for (let s = 0; s < ctx.totalSteps; s += 4) {
      const chord = chords[s];
      const head = chord && chord.startStep === s;
      if (!chord || (s % 8 !== 0 && !head)) continue;
      for (let t = 0; t < ctx.numTracks; t++) {
        const cell = eligible(t, s, chord);
        if (cell && !isChordTone(chord, cell.degree, n)) moveToChord(t, s, cell, chord);
      }
      if (!head && !chord.retrans) continue;
      let bass = null;
      for (let t = 0; t < ctx.numTracks; t++) {
        const cell = ctx.grid[t][s];
        if (!cell || cell.velocity <= GHOST_VELOCITY) continue;
        if (!bass || cell.midi < bass.midi) bass = cell;
      }
      // Solo si la más grave es elegible: una nota protegida (recapitulación,
      // final) sigue siendo el bajo aunque no se toque
      if (!bass || bass.final || mod(bass.degree, n) === chord.root) continue;
      const t = ctx.grid.findIndex(row => row[s] === bass);
      if (!eligible(t, s, chord)) continue;
      for (let k = 1; k <= 2; k++) {
        const d = bass.degree - k;
        if (d >= -7 && mod(d, n) === chord.root) {
          setPitch(ctx, s, bass, d);
          stats.bass++;
          break;
        }
      }
    }

    // Fase 3: los demás tiempos, con tolerancia a notas de paso y bordaduras
    for (let s = 4; s < ctx.totalSteps; s += 8) {
      const chord = chords[s];
      if (!chord || chord.startStep === s) continue;
      for (let t = 0; t < ctx.numTracks; t++) {
        const cell = eligible(t, s, chord);
        if (!cell || isChordTone(chord, cell.degree, n)) continue;
        if (isNonChordOrnament(ctx.grid[t], s, cell.degree, ctx.totalSteps)) {
          stats.tolerated++;
          continue;
        }
        moveToChord(t, s, cell, chord);
      }
    }
    return stats;
  }

  return {
    plan, apply, refresh, spell, chordMap, finalChord, isChordTone, describe,
    alterAt, midiAt, setPitch, frameOf, sameRegion, FAMILIES
  };
})();
