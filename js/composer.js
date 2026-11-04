const Composer = (() => {
  let piece = null;
  let isPlaying = false;
  let repeatEventId = null;
  let currentStep = 0;

  const STEP = '16n';
  // Coda tras el último paso: las notas finales (`cell.final`, Humanizer)
  // se alargan esto y las pistas se desvanecen en ese tiempo
  const ENDING_TAIL_STEPS = 16;
  // Pasadas extra de contrapunto al cerrar los pases: cada una sobre
  // alteraciones recién coherentes (Harmony.spell); la primera siempre y las
  // demás solo si la anterior cambió alguna altura. En la práctica basta una
  const SPELL_PASSES = 4;
  // Repeticiones totales de célula por sección (potencias de 2) cuando no hay
  // plan de duración (planDuration)
  const SECTION_REPEAT_CHOICES = [2, 4];
  // Planes de duración aceptables: error relativo (en log) hasta este margen
  // por encima del mejor; entre ellos se sortea para variar el largo de célula
  const DURATION_TOLERANCE = 0.06;
  // Más repeticiones que esto por sección suenan a bucle: entre los planes
  // aceptables se prefieren los que no lo pasan y, si ninguno, los de célula
  // más larga (piezas largas: células largas antes que muchas vueltas)
  const REPEAT_SOFT_CAP = 16;
  // Límite del viaje por el ciclo de quintas: la tonalidad no se aleja más de
  // este número de quintas (en cualquiera de los dos sentidos) desde la base
  const MAX_FIFTH_STEPS = 4;
  // Modulación real: peso de cada destino al trazar la ruta del plan tonal
  // (tonalidades vecinas de la región en curso). En menor el primer destino
  // natural es el relativo mayor; en mixolidia, la subdominante. Las escalas
  // sin relativo (pentatónica, cromática) solo viajan por quintas
  const ROUTE_WEIGHTS = {
    major: { dominant: 3, subdominant: 2, relative: 3, parallel: 1 },
    minor: { dominant: 2, subdominant: 2, relative: 4, parallel: 1 },
    dorian: { dominant: 2, subdominant: 2, relative: 2, parallel: 1 },
    mixolydian: { dominant: 1, subdominant: 3, relative: 2, parallel: 1 },
    other: { dominant: 1, subdominant: 1 }
  };

  // Compresión de dinámica al tocar (no altera la partitura): el rango audible
  // se estrecha hacia DYN_CENTER con razón DYN_RATIO (0.5 ≈ compresor 2:1)
  // para que las notas suaves no desaparezcan ni las fuertes golpeen. Las
  // notas fantasma (velocity <= Generator.GHOST_VELOCITY: disonancias apagadas
  // por el contrapunto, ecos del humanizador) se dejan tal cual — su papel es
  // ser casi inaudibles
  const DYN_CENTER = 0.65;
  const DYN_RATIO = 0.5;

  function shapeVelocity(v) {
    if (v <= Generator.GHOST_VELOCITY) return v;
    return Math.min(1, DYN_CENTER + (v - DYN_CENTER) * DYN_RATIO);
  }

  // Divide N repeticiones en bloques de tamaño potencia de 2 (p.ej. 4 -> [2,1,1] o [4])
  function partitionRepeats(n) {
    if (n === 1 || Math.random() < 0.4) return [n];
    const half = n / 2;
    return partitionRepeats(half).concat(partitionRepeats(half));
  }

  // Llena un tramo con motivos que no estén sonando ya en otras pistas (slotUsage).
  // Si el tramo entero no tiene motivo libre se parte en mitades; si ni un tramo
  // mínimo lo tiene, silencio: nunca se duplica un motivo entre pistas
  // next (opcional) es el motivo del bloque que ya sigue al tramo, para no repetirlo.
  // weights (opcional): preferencia de motivos del carácter de la letra
  // (FormPlan): la madre domina en la exposición, las variaciones en el resto
  function fillSpan(slotStart, size, prev, motifCount, slotUsage, next = -1, weights = null) {
    const used = new Set();
    for (let i = 0; i < size; i++) {
      for (const m of slotUsage[slotStart + i]) used.add(m);
    }
    const candidates = [];
    for (let m = 0; m < motifCount; m++) {
      if (m !== prev && m !== next && !used.has(m)) candidates.push(m);
    }
    if (candidates.length) {
      const w = m => (weights ? weights[m] : 1);
      let roll = Math.random() * candidates.reduce((a, m) => a + w(m), 0);
      let motifIndex = candidates[candidates.length - 1];
      for (const m of candidates) {
        roll -= w(m);
        if (roll <= 0) { motifIndex = m; break; }
      }
      for (let i = 0; i < size; i++) slotUsage[slotStart + i].add(motifIndex);
      return [{ motifIndex, repeats: size }];
    }
    if (size > 1) {
      const half = size / 2;
      const left = fillSpan(slotStart, half, prev, motifCount, slotUsage, -1, weights);
      const lastLeft = left[left.length - 1].motifIndex;
      const right = fillSpan(slotStart + half, half, lastLeft === null ? -1 : lastLeft, motifCount, slotUsage, next, weights);
      return left.concat(right);
    }
    return [{ motifIndex: null, repeats: size }];
  }

  // Secuencia de bloques de una pista dentro de una sección: cada bloque toca
  // un motivo (madre o variación) o calla; bloques adyacentes no repiten motivo
  function buildTrackBlocks(totalRepeats, motifCount, slotUsage, character) {
    const sizes = partitionRepeats(totalRepeats);
    const blocks = [];
    let prev = -1;
    let slot = 0;
    for (const size of sizes) {
      if (Math.random() < character.blockSilence) {
        blocks.push({ motifIndex: null, repeats: size });
        prev = -1;
      } else {
        const span = fillSpan(slot, size, prev, motifCount, slotUsage, -1, character.motifWeights);
        blocks.push(...span);
        const last = span[span.length - 1].motifIndex;
        prev = last === null ? -1 : last;
      }
      slot += size;
    }
    return blocks;
  }

  // Reparto de bloques de una letra según su carácter (FormPlan): solo tocan
  // las pistas de su orquestación (character.tracks), con su probabilidad de
  // bloque mudo y su preferencia de motivos. ensureCoverage tiene la última
  // palabra: puede hacer entrar una pista fuera de la orquestación antes que
  // dejar un silencio general
  function buildSectionSpec(numTracks, motifCount, totalRepeats, character) {
    const slotUsage = Array.from({ length: totalRepeats }, () => new Set());
    const trackBlocks = [];
    for (let t = 0; t < numTracks; t++) {
      const playing = character.tracks.includes(t);
      trackBlocks.push(playing ? buildTrackBlocks(totalRepeats, motifCount, slotUsage, character) : null);
    }
    ensureCoverage(trackBlocks, totalRepeats, motifCount, slotUsage, character.motifWeights);
    return { totalRepeats, trackBlocks };
  }

  // Ninguna repetición de célula de la sección queda muda en todas las pistas:
  // los silencios por bloque/pista se sortean por separado y, al coincidir,
  // dejaban silencios generales de decenas de segundos. En cada repetición sin
  // motivo, una pista con un bloque mudo ahí (antes que una pista callada toda
  // la sección, que conserva su papel de orquestación) lo rellena. El bloque se
  // bisecciona (invariante 1) y solo se rellenan las mitades sin cobertura; en
  // ellas no suena nada, así que siempre hay motivo libre (invariante 2)
  function ensureCoverage(trackBlocks, totalRepeats, motifCount, slotUsage, weights = null) {
    const fillGap = (start, size, prev, next) => {
      let uncovered = 0;
      for (let i = start; i < start + size; i++) if (slotUsage[i].size === 0) uncovered++;
      if (uncovered === 0) return [{ motifIndex: null, repeats: size }];
      if (uncovered === size) return fillSpan(start, size, prev, motifCount, slotUsage, next, weights);
      const half = size / 2;
      const left = fillGap(start, half, prev, -1);
      const lastLeft = left[left.length - 1].motifIndex;
      return left.concat(fillGap(start + half, half, lastLeft === null ? -1 : lastLeft, next));
    };
    // Bloque mudo de la pista t que contiene la repetición slot, o null
    const silentBlockAt = (t, slot) => {
      const blocks = trackBlocks[t];
      if (blocks === null) return { index: 0, start: 0, prev: -1, next: -1 };
      let start = 0;
      for (let i = 0; i < blocks.length; i++) {
        const end = start + blocks[i].repeats;
        if (slot < end) {
          if (blocks[i].motifIndex !== null) return null;
          const prev = i > 0 && blocks[i - 1].motifIndex !== null ? blocks[i - 1].motifIndex : -1;
          const next = i + 1 < blocks.length && blocks[i + 1].motifIndex !== null ? blocks[i + 1].motifIndex : -1;
          return { index: i, start, prev, next };
        }
        start = end;
      }
      return null;
    };
    for (let slot = 0; slot < totalRepeats; slot++) {
      if (slotUsage[slot].size > 0) continue;
      const playing = [];
      const silent = [];
      trackBlocks.forEach((blocks, t) => {
        if (blocks === null) silent.push(t);
        else if (silentBlockAt(t, slot)) playing.push(t);
      });
      const t = Generator.pickRandom(playing.length ? playing : silent);
      if (trackBlocks[t] === null) trackBlocks[t] = [{ motifIndex: null, repeats: totalRepeats }];
      const { index, start, prev, next } = silentBlockAt(t, slot);
      const size = trackBlocks[t][index].repeats;
      trackBlocks[t].splice(index, 1, ...fillGap(start, size, prev, next));
    }
  }

  // Plan de duración: elige el largo de célula y las repeticiones de cada
  // letra de la forma para acercarse a targetSteps. Todo sigue siendo potencia
  // de 2 (invariante 1), así que la duración real solo se aproxima. Prueba,
  // para cada largo de célula, las repeticiones base/2, base y base*2 por letra
  // (≤ 5 letras distintas → pocas centenas de combinaciones) y sortea entre
  // las que quedan cerca del mejor ajuste.
  // Devuelve { cellLength, repeats: { letra: n }, steps }
  function planDuration(formParts, targetSteps) {
    const counts = {};
    for (const letter of formParts) counts[letter] = (counts[letter] || 0) + 1;
    const letters = Object.keys(counts);
    const plans = [];
    for (const cellLength of Generator.CELL_LENGTHS) {
      let base = 1;
      while (cellLength * formParts.length * base * 2 <= targetSteps) base *= 2;
      const choices = [base / 2, base, base * 2].filter(r => r >= 1);
      const walk = (i, repeats, cells) => {
        if (i === letters.length) {
          const steps = cellLength * cells;
          plans.push({ cellLength, repeats: { ...repeats }, steps, error: Math.abs(Math.log(steps / targetSteps)) });
          return;
        }
        for (const r of choices) {
          repeats[letters[i]] = r;
          walk(i + 1, repeats, cells + r * counts[letters[i]]);
        }
      };
      walk(0, {}, 0);
    }
    const best = Math.min(...plans.map(p => p.error));
    const ok = plans.filter(p => p.error <= best + DURATION_TOLERANCE);
    const calm = ok.filter(p => Math.max(...Object.values(p.repeats)) <= REPEAT_SOFT_CAP);
    const longest = Math.max(...ok.map(p => p.cellLength));
    const pool = calm.length ? calm : ok.filter(p => p.cellLength === longest);
    const { cellLength, repeats, steps } = Generator.pickRandom(pool);
    return { cellLength, repeats, steps };
  }

  // Tonalidades vecinas de una región { fifths, mode }: dominante y
  // subdominante (mismo modo), relativo (cambio de género con la misma
  // armadura) y, solo desde la tónica, el homónimo (mixtura modal), del que se
  // vuelve a casa sin seguir viajando
  function neighborRegions(scale, region) {
    const out = [];
    if (region.mode === 'parallel') return out;
    const hasRelations = !!Generator.MODE_RELATIONS[scale];
    for (const d of [1, -1]) {
      const fifths = region.fifths + d;
      if (Math.abs(fifths) <= MAX_FIFTH_STEPS) out.push({ fifths, mode: region.mode, kind: d > 0 ? 'dominant' : 'subdominant' });
    }
    if (hasRelations) {
      out.push({ fifths: region.fifths, mode: region.mode ? null : 'relative', kind: 'relative' });
      if (!region.mode && region.fifths === 0) out.push({ fifths: 0, mode: 'parallel', kind: 'parallel' });
    }
    return out;
  }

  const sameRegion = (a, b) => a.fifths === b.fifths && (a.mode || null) === (b.mode || null);

  // Lejanía tonal (índice en la ruta) de la sección i: arco que sube de la
  // tónica hasta peak en la sección del clímax (c) y baja a la tónica en la
  // del final del arco (end, la recapitulación); desde ahí, tónica. Entre
  // secciones consecutivas cambia como mucho en 1 porque peak <= min(c, end - c)
  function tonalLevel(i, peak, c, end) {
    if (!peak || i <= 0 || i >= end) return 0;
    return i <= c ? Math.round(peak * i / c) : Math.round(peak * (end - i) / (end - c));
  }

  // Plan tonal: arco compuesto de antemano y coordinado con el plan formal
  // (FormPlan): la región más lejana cae en la sección del clímax de
  // intensidad y la recapitulación vuelve a la tonalidad base. Se sortea una
  // lejanía máxima (peak, acotada por MAX_FIFTH_STEPS y por las secciones
  // que hay antes y después del clímax; la mayoría de las veces la máxima
  // posible) y una ruta de peak regiones vecinas encadenadas; la sección i
  // toca la región route[tonalLevel(i)]: se aleja hacia el clímax y vuelve
  // por el mismo camino, terminando siempre en la tonalidad base. Así cada
  // modulación va a una tonalidad vecina (preparable con un pivote y la
  // dominante de destino) y solo cae en fronteras de sección. Al acercarse al
  // clímax la ruta prefiere el lado de la dominante (tensión) y lejos de él
  // la subdominante. 'soft' conserva el viaje por quintas en un sentido de
  // la modulación suave; 'none' no modula
  function planTonality(sections, scale, modulation, form) {
    const c = form.climaxSection;
    const end = form.tonalEnd;
    const peakCap = modulation === 'none' || c < 1 || c >= end ? 0 : Math.min(MAX_FIFTH_STEPS, c, end - c);
    const peak = peakCap > 0 ? (Math.random() < 0.6 ? peakCap : 1 + Math.floor(Math.random() * peakCap)) : 0;
    form.peak = peak;
    const route = [{ fifths: 0, mode: null, kind: null }];
    if (modulation === 'soft') {
      const flatBias = scale === 'minor' || scale === 'dorian' ? 0.7 : 0.3;
      const dir = Math.random() < flatBias ? -1 : 1;
      for (let i = 1; i <= peak; i++) route.push({ fifths: dir * i, mode: null, kind: dir > 0 ? 'dominant' : 'subdominant' });
    } else {
      const weights = ROUTE_WEIGHTS[scale] || ROUTE_WEIGHTS.other;
      while (route.length <= peak) {
        const cur = route[route.length - 1];
        const options = neighborRegions(scale, cur).filter(r => !route.some(v => sameRegion(v, r)));
        if (!options.length) break;
        // Seguir en el mismo sentido por quintas pesa algo más que dar la
        // vuelta; la tensión (paso k de peak hacia el clímax) inclina hacia la
        // dominante
        const tension = route.length / peak;
        const bias = { dominant: 0.6 + 0.8 * tension, subdominant: 1.4 - 0.8 * tension };
        const weighted = options.map(r => ({ r, w: (weights[r.kind] || 0) * (bias[r.kind] || 1) * (cur.kind && r.kind === cur.kind ? 1.5 : 1) }))
          .filter(o => o.w > 0);
        if (!weighted.length) break;
        let roll = Math.random() * weighted.reduce((a, o) => a + o.w, 0);
        let pick = weighted[weighted.length - 1].r;
        for (const o of weighted) {
          roll -= o.w;
          if (roll <= 0) { pick = o.r; break; }
        }
        route.push(pick);
      }
    }
    const top = route.length - 1;
    sections.forEach((section, i) => {
      const region = route[Math.min(top, tonalLevel(i, peak, c, end))];
      section.fifths = region.fifths;
      section.keyOffset = ((region.fifths * 7) % 12 + 12) % 12;
      section.mode = region.mode;
      describeRegion(section, scale, modulation);
    });
    // Cómo se llega a cada sección: el mismo tipo de paso a la ida y a la vuelta
    sections.forEach((section, i) => {
      const prev = sections[i - 1];
      if (!prev || sameRegion(prev, section)) {
        section.arrival = null;
        return;
      }
      const df = section.fifths - prev.fifths;
      section.arrival = df > 0 ? 'dominant' : df < 0 ? 'subdominant' : (prev.mode === 'parallel' || section.mode === 'parallel' ? 'parallel' : 'relative');
    });
  }

  // Campos derivados de la región de una sección para la escala actual (se
  // recalculan en retune): tónica local en semitonos sobre la base (`tonic`),
  // escala local (`localScale`, distinta de la de la pieza en relativo y
  // homónimo), transporte efectivo con signo (`shift`) y `fifthOffset`, la
  // posición de la tónica local en el ciclo de quintas (la que dibuja la
  // vista «fifths»): igual a `fifths` salvo en relativos, que se mueven por
  // el ciclo hasta su tónica (La menor = +3 desde Do)
  function describeRegion(section, scale, modulation) {
    if (modulation === 'soft') {
      section.tonic = section.keyOffset;
      section.localScale = scale;
      section.shift = 0;
      section.fifthOffset = section.fifths;
      return;
    }
    const r = Generator.regionOf(scale, section.keyOffset, section.mode);
    section.tonic = r.tonic;
    section.localScale = r.scale;
    section.shift = r.shift;
    const k = (r.tonic * 7) % 12;
    section.fifthOffset = Math.abs(k - section.fifths) <= Math.abs(k - 12 - section.fifths) ? k : k - 12;
  }

  // Registro de cada sección (section.octave, octavas enteras que cellMidi
  // suma sin tocar el grado): el transporte efectivo T (shift de la región
  // con modulación real, 0 en suave y ninguna, más 12 × octave) se elige por
  // programación dinámica sobre toda la pieza, entre las octavas que dejan T a
  // menos de REGISTER_WINDOW semitonos del registro del carácter de la letra
  // (12 × character.register), minimizando el salto de altura media entre
  // secciones consecutivas (contenido de la letra + T, descontado el cambio
  // de registro deliberado entre caracteres) más REGISTER_PULL × la distancia
  // al registro del carácter. Así las modulaciones reales no arrastran la
  // melodía de un tirón de 7 semitonos y la vuelta de A, en la tónica, cae
  // siempre en su registro de exposición. Se fija al componer: retune
  // conserva las octavas (re-describe shift, así que ida y vuelta es exacta).
  // Límites audibles: el percentil REGISTER_LOW_Q de las notas de la sección
  // (con la tonalidad real) no baja de REGISTER_FLOOR ni el REGISTER_HIGH_Q
  // pasa de REGISTER_CEIL. Sin ellos, carácter sombrío (−1 octava) + transporte
  // de la modulación real (hasta −6) + tónica grave dejaban frases enteras por
  // debajo de Do2, inaudibles con un sinte senoidal en altavoces normales
  const REGISTER_WINDOW = 8;
  const REGISTER_MAX = 17;
  const REGISTER_PULL = 0.5;
  const REGISTER_FLOOR = 48;
  const REGISTER_CEIL = 93;
  const REGISTER_LOW_Q = 0.1;
  const REGISTER_HIGH_Q = 0.9;
  function planRegister(sections, motifs, scale, key, modulation) {
    const stats = sections.map(section => {
      const local = modulation === 'real' ? section.localScale : scale;
      const notes = [];
      let sum = 0;
      let count = 0;
      section.trackBlocks.forEach(blocks => {
        if (!blocks) return;
        for (const block of blocks) {
          if (block.motifIndex === null) continue;
          for (const step of motifs[block.motifIndex]) {
            if (!step.note) continue;
            const midi = Generator.degreeToMidi(step.degree, local, key);
            sum += (midi - key - 60) * block.repeats;
            count += block.repeats;
            notes.push(midi);
          }
        }
      });
      notes.sort((a, b) => a - b);
      const q = f => (notes.length ? notes[Math.min(notes.length - 1, Math.floor(f * notes.length))] : 60 + key);
      return { mean: count ? sum / count : 0, low: q(REGISTER_LOW_Q), high: q(REGISTER_HIGH_Q) };
    });
    const content = stats.map(st => st.mean);
    const options = sections.map((section, i) => {
      const shift = modulation === 'real' ? section.shift : 0;
      const target = 12 * section.character.register;
      const { low, high } = stats[i];
      const range = [-2, -1, 0, 1, 2].map(k => ({ k, T: shift + 12 * k })).filter(o => Math.abs(o.T) <= REGISTER_MAX);
      const audible = range.filter(o => low + o.T >= REGISTER_FLOOR && high + o.T <= REGISTER_CEIL);
      // Si ninguna octava cabe entera, la que menos se sale por abajo o por arriba
      const overflow = o => Math.max(0, REGISTER_FLOOR - low - o.T) + Math.max(0, high + o.T - REGISTER_CEIL);
      const all = audible.length ? audible : [range.reduce((a, b) => (overflow(b) < overflow(a) ? b : a))];
      const near = all.filter(o => Math.abs(o.T - target) <= REGISTER_WINDOW);
      return near.length ? near : [all.reduce((a, b) => (Math.abs(b.T - target) < Math.abs(a.T - target) ? b : a))];
    });
    const level = (i, o) => content[i] + o.T - 12 * sections[i].character.register;
    const own = (i, o) => REGISTER_PULL * Math.abs(o.T - 12 * sections[i].character.register);
    let costs = options[0].map(o => ({ cost: own(0, o), path: [o] }));
    for (let i = 1; i < sections.length; i++) {
      costs = options[i].map(o => {
        let best = null;
        for (const p of costs) {
          const cost = p.cost + own(i, o) + Math.abs(level(i, o) - level(i - 1, p.path[p.path.length - 1]));
          if (!best || cost < best.cost) best = { cost, path: p.path.concat(o) };
        }
        return best;
      });
    }
    const best = costs.reduce((a, b) => (b.cost < a.cost ? b : a));
    sections.forEach((section, i) => { section.octave = best.path[i].k; });
  }

  // opts: { numTracks, motifs, formParts, cellLength, scale, key, repeatsByLetter?, modulation? }
  // repeatsByLetter (de planDuration) fija las repeticiones de cada letra; sin
  // él se sortean entre SECTION_REPEAT_CHOICES. modulation: 'real' (por
  // defecto), 'soft' o 'none' (Generator.MODULATIONS)
  function compose(opts) {
    const { numTracks, motifs, formParts, cellLength, scale, key, repeatsByLetter } = opts;
    const modulation = Generator.MODULATIONS.includes(opts.modulation) ? opts.modulation : 'real';

    // Repeticiones por letra (del plan de duración o sorteadas) y posiciones:
    // el plan formal las necesita antes de repartir bloques
    const repeatsOf = {};
    for (const letter of formParts) {
      if (!repeatsOf[letter]) {
        repeatsOf[letter] = (repeatsByLetter && repeatsByLetter[letter]) ||
          SECTION_REPEAT_CHOICES[Math.floor(Math.random() * SECTION_REPEAT_CHOICES.length)];
      }
    }
    let pos = 0;
    const sections = formParts.map(letter => {
      const section = { label: letter, totalRepeats: repeatsOf[letter], startStep: pos, lengthSteps: cellLength * repeatsOf[letter], recap: false };
      pos += section.lengthSteps;
      return section;
    });
    const totalSteps = pos;

    // Plan formal (FormPlan): carácter de cada letra (registro, densidad,
    // orquestación, nivel, motivos), frases, clímax, vuelta de A y su
    // retransición, y el perfil de intensidad que leen los pases
    const form = FormPlan.plan(sections, { cellLength, numTracks, motifCount: motifs.length });

    // Cada letra de la forma comparte spec: "A" suena igual cada vez que aparece
    const specByLetter = {};
    for (const section of sections) {
      if (!specByLetter[section.label]) {
        specByLetter[section.label] = buildSectionSpec(numTracks, motifs.length, section.totalRepeats, section.character);
      }
      section.trackBlocks = specByLetter[section.label].trackBlocks;
    }

    // Recapitulación: en la vuelta final de A (o, si la forma no la tiene, en
    // la última sección: form.recapIndex) una pista vuelve a la célula
    // original (o a una variación) durante toda la sección; las demás siguen
    // sus bloques normales pero callan donde coincidirían con el motivo
    // recapitulado. En la vuelta de A pesa más la madre
    if (form.recapIndex > 0) {
      const recapIdx = form.recapIndex;
      const motherChance = form.returnIndex === recapIdx ? 0.7 : 0.5;
      const recapMotif = Math.random() < motherChance || motifs.length === 1
        ? 0
        : 1 + Math.floor(Math.random() * (motifs.length - 1));
      const base = sections[recapIdx];
      // sorteada entre las pistas con material (no siempre la primera)
      const candidates = [];
      base.trackBlocks.forEach((blocks, t) => { if (blocks !== null) candidates.push(t); });
      const recapTrack = Generator.pickRandom(candidates);
      base.trackBlocks = base.trackBlocks.map((blocks, t) => {
        if (t === recapTrack) return [{ motifIndex: recapMotif, repeats: base.totalRepeats }];
        if (blocks === null) return null;
        return blocks.map(b => (b.motifIndex === recapMotif ? { ...b, motifIndex: null } : b));
      });
      base.recap = true;
      base.recapTrack = recapTrack;
    }

    const grid = Array.from({ length: numTracks }, () => new Array(totalSteps).fill(null));
    const stepEvents = Array.from({ length: totalSteps }, () => []);
    const blockMarkers = [];

    // Plan tonal (planTonality): arco de regiones vecinas que vuelve a la
    // tonalidad base; las modulaciones solo caen en fronteras de sección —
    // nunca en medio de un bloque — y cada nota guarda la región de su sección
    // (keyOffset y mode), lo que hace retune-safe la modulación
    planTonality(sections, scale, modulation, form);
    // Registro por sección (octava del transporte) según carácter y continuidad
    planRegister(sections, motifs, scale, key, modulation);
    for (const section of sections) {
      for (let t = 0; t < numTracks; t++) {
        const blocks = section.trackBlocks[t];
        if (blocks === null) continue;
        let blockPos = section.startStep;
        for (const block of blocks) {
          const blockSteps = cellLength * block.repeats;
          if (block.motifIndex !== null) {
            const motif = motifs[block.motifIndex];
            for (let s = 0; s < blockSteps; s++) {
              const step = motif[s % motif.length];
              if (!step.note) continue;
              const cell = {
                midi: Generator.cellMidi(step.degree, scale, key, section, modulation),
                degree: step.degree,
                keyOffset: section.keyOffset,
                velocity: step.velocity,
                sustain: step.sustain,
                motifIndex: block.motifIndex
              };
              if (section.mode) cell.mode = section.mode;
              if (section.octave) cell.octave = section.octave;
              grid[t][blockPos + s] = cell;
            }
            blockMarkers.push({
              trackIndex: t,
              startStep: blockPos,
              lengthSteps: blockSteps,
              motifIndex: block.motifIndex
            });
          }
          blockPos += blockSteps;
        }
      }
    }

    // Plan armónico: progresión por letra con cadencia al final de cada
    // sección (section.chords). Se sortea sobre la rejilla recién colocada,
    // para elegir progresiones que encajen con la melodía, y antes de
    // humanizar, cuyo final se posa en el acorde de cierre. null en cromática.
    // Las secciones que preceden a una modulación la preparan (pivote y
    // dominante de la nueva tonalidad) y los V de menor llevan sensible:
    // Harmony.spell escribe esas alteraciones (cell.alter) en la rejilla
    const harmony = Harmony.plan({ sections, grid, numTracks, totalSteps, cellLength, scale, key, modulation, form });
    const ctx = { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key, modulation, harmony, form };
    Harmony.spell(ctx);

    // Humanización: retoca notas, dinámica y articulación trabajando en grados;
    // debe ir antes de las duraciones porque añade/quita notas y cambia huecos
    Humanizer.humanize(ctx);

    // Energía: si demasiadas pistas atacan a la vez, las menos salientes ceden
    // notas (menos y más largas). Va tras humanizar, para medir la textura
    // real, y antes de armonía y contrapunto, que así trabajan sobre la
    // textura ya aclarada
    Energy.balance(ctx);

    // Armonía: acerca al acorde vigente las notas de tiempo fuerte (±1 grado)
    // y lleva el bajo a la fundamental. Va tras Energy, que solo borra notas
    // y alarga sustains (no le cambia las alturas y su saliencia apenas
    // depende de ellas), para no armonizar notas que luego desaparecen; y
    // antes del contrapunto, que tiene la última palabra sobre los choques
    Harmony.apply(ctx);

    // Contrapunto: consonancia vertical entre pistas (mueve grados ±1, apaga o
    // acorta notas), prefiriendo el acorde vigente. Va tras humanizar, para
    // vigilar también las notas que la humanización añade, y antes de las
    // duraciones, porque ajusta sustains
    Counterpoint.enforce(ctx);

    // Las alteraciones miran la nota siguiente de su pista, y los pases
    // quitan, añaden y mueven notas: un spell las deja coherentes con la
    // rejilla definitiva y el contrapunto vuelve a pasar sobre ella
    // (determinista: solo toca lo que quedó desfasado, p. ej. un unísono que
    // no abrió porque su nota siguiente aún iba a moverse). Mientras ese
    // repaso cambie alguna altura se repite, hasta SPELL_PASSES, y se cierra
    // siempre con spell para que `alter` quede coherente (retune depende de
    // ello)
    let stale = Harmony.spell(ctx);
    for (let pass = 0; pass < SPELL_PASSES && (stale || pass === 0); pass++) {
      Counterpoint.enforce(ctx);
      stale = Harmony.spell(ctx);
    }

    // Duraciones: cada nota sostiene una fracción (sustain) del hueco hasta la
    // siguiente nota de su pista — legato como máximo, nunca superposición
    for (let t = 0; t < numTracks; t++) {
      const row = grid[t];
      const notePositions = [];
      for (let s = 0; s < totalSteps; s++) {
        if (row[s]) notePositions.push(s);
      }
      for (let i = 0; i < notePositions.length; i++) {
        const s = notePositions[i];
        const cell = row[s];
        const gap = (i + 1 < notePositions.length ? notePositions[i + 1] : totalSteps) - s;
        cell.durationSteps = Math.max(1, Math.round(cell.sustain * Math.min(gap, Generator.MAX_SUSTAIN_STEPS)));
        stepEvents[s].push({ trackIndex: t, cell });
      }
    }

    piece = { sections, totalSteps, grid, stepEvents, blockMarkers, numTracks, cellLength, scale, key, modulation, harmony, form };
    // Una pieza nueva invalida cualquier pausa pendiente de la anterior
    currentStep = 0;
    return piece;
  }

  function getPiece() {
    return piece;
  }

  // Re-mapea los grados de la pieza actual a otra tonalidad/escala sin regenerarla;
  // funciona también en plena reproducción. Conserva la modulación por secciones
  // aplicando la región (keyOffset, mode) guardada en cada nota; las regiones
  // se re-describen para la escala nueva (el relativo de mayor es menor, el de
  // menor es mayor…). stepEvents apunta a las mismas celdas, así que basta con
  // el grid. El plan armónico se re-describe (calidad, cifrado y alteraciones:
  // Harmony.refresh reescribe cell.alter) sin re-armonizar las notas
  function retune(scale, key) {
    if (!piece) return;
    piece.scale = scale;
    piece.key = key;
    for (const section of piece.sections) describeRegion(section, scale, piece.modulation);
    Harmony.refresh(piece);
    for (const row of piece.grid) {
      for (const cell of row) {
        if (cell) cell.midi = Generator.cellMidi(cell.degree, scale, key, cell, piece.modulation);
      }
    }
  }

  function play(onStep, onComplete) {
    if (isPlaying || !piece || piece.totalSteps === 0) return;
    isPlaying = true;
    // Reanuda desde donde se pausó; tras el final (o tras rebobinar) parte de 0
    if (currentStep >= piece.totalSteps) currentStep = 0;

    Tone.Transport.cancel();
    // Los niveles se reponen al reanudar y no al parar: al acabar la coda
    // aún pueden quedar releases largos que volverían de golpe
    AudioEngine.restoreTrackLevels();
    // Reloj MIDI antes que las notas: a igual tiempo, Tone dispara los eventos
    // en orden de alta y el start (o continue) debe preceder a la primera nota
    // Con el reloj MIDI en reposo devuelve un instante alineado a su rejilla
    const startAt = MidiEngine.startClock(currentStep);
    let fading = false;
    repeatEventId = Tone.Transport.scheduleRepeat(time => {
      const step = currentStep;
      const stepSeconds = Tone.Time(STEP).toSeconds();
      // Coda: el transporte sigue ENDING_TAIL_STEPS pasos sin notas nuevas
      // mientras las notas finales suenan y las pistas se desvanecen; reverb y
      // delay no se tocan y conservan su cola. Cortar en el último paso daba
      // un golpe seco con los ecos colgando
      if (step >= piece.totalSteps) {
        if (step === piece.totalSteps) {
          fading = true;
          AudioEngine.fadeOutTracks(time, ENDING_TAIL_STEPS * stepSeconds);
        }
        currentStep++;
        if (step < piece.totalSteps + ENDING_TAIL_STEPS) return;
        Tone.Draw.schedule(() => {
          if (!isPlaying) return;
          stop();
          if (onComplete) onComplete();
        }, time);
        return;
      }
      // Un seek durante la coda vuelve a la pieza: niveles de vuelta
      if (fading) {
        fading = false;
        AudioEngine.restoreTrackLevels(time);
      }
      currentStep++;

      // Factor 0.95 para que sintes monofónicos no pisen el retrigger en legato
      for (const { trackIndex, cell } of piece.stepEvents[step]) {
        const steps = cell.durationSteps + (cell.final ? ENDING_TAIL_STEPS : 0);
        const duration = steps * stepSeconds * 0.95;
        const velocity = shapeVelocity(cell.velocity);
        AudioEngine.playNote(trackIndex, cell.midi, time, duration, velocity);
        MidiEngine.playNote(trackIndex, cell.midi, time, duration, velocity);
      }
      Tone.Draw.schedule(() => {
        if (isPlaying && onStep) onStep(step);
      }, time);
    }, STEP);

    Tone.Transport.start(startAt);
  }

  // Parada con memoria: en marcha pausa (conserva currentStep para que play
  // reanude ahí); estando ya parado rebobina el transporte a 0
  function stop() {
    if (!isPlaying) {
      currentStep = 0;
      return;
    }
    isPlaying = false;
    Tone.Transport.stop();
    if (repeatEventId !== null) {
      Tone.Transport.clear(repeatEventId);
      repeatEventId = null;
    }
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    MidiEngine.allNotesOff();
    MidiEngine.stopClock();
  }

  // Salto a un paso (p. ej. el inicio de una sección): en marcha, el próximo
  // tick del transporte sigue desde ahí; parado, play reanuda desde ahí. Las
  // notas ya disparadas terminan con su propia duración
  function seek(step) {
    if (!piece) return;
    currentStep = Math.max(0, Math.min(piece.totalSteps - 1, Math.floor(step)));
  }

  function getCurrentStep() {
    return currentStep;
  }

  function getIsPlaying() {
    return isPlaying;
  }

  return { compose, planDuration, retune, play, stop, seek, getPiece, getIsPlaying, getCurrentStep, shapeVelocity };
})();
