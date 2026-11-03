const Composer = (() => {
  let piece = null;
  let isPlaying = false;
  let repeatEventId = null;
  let currentStep = 0;

  const STEP = '16n';
  // Coda tras el último paso: las notas finales (`cell.final`, Humanizer)
  // se alargan esto y las pistas se desvanecen en ese tiempo
  const ENDING_TAIL_STEPS = 16;
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
  // next (opcional) es el motivo del bloque que ya sigue al tramo, para no repetirlo
  function fillSpan(slotStart, size, prev, motifCount, slotUsage, next = -1) {
    const used = new Set();
    for (let i = 0; i < size; i++) {
      for (const m of slotUsage[slotStart + i]) used.add(m);
    }
    const candidates = [];
    for (let m = 0; m < motifCount; m++) {
      if (m !== prev && m !== next && !used.has(m)) candidates.push(m);
    }
    if (candidates.length) {
      const motifIndex = candidates[Math.floor(Math.random() * candidates.length)];
      for (let i = 0; i < size; i++) slotUsage[slotStart + i].add(motifIndex);
      return [{ motifIndex, repeats: size }];
    }
    if (size > 1) {
      const half = size / 2;
      const left = fillSpan(slotStart, half, prev, motifCount, slotUsage);
      const lastLeft = left[left.length - 1].motifIndex;
      const right = fillSpan(slotStart + half, half, lastLeft === null ? -1 : lastLeft, motifCount, slotUsage, next);
      return left.concat(right);
    }
    return [{ motifIndex: null, repeats: size }];
  }

  // Secuencia de bloques de una pista dentro de una sección: cada bloque toca
  // un motivo (madre o variación) o calla; bloques adyacentes no repiten motivo
  function buildTrackBlocks(totalRepeats, motifCount, slotUsage) {
    const sizes = partitionRepeats(totalRepeats);
    const blocks = [];
    let prev = -1;
    let slot = 0;
    for (const size of sizes) {
      if (Math.random() < 0.15) {
        blocks.push({ motifIndex: null, repeats: size });
        prev = -1;
      } else {
        const span = fillSpan(slot, size, prev, motifCount, slotUsage);
        blocks.push(...span);
        const last = span[span.length - 1].motifIndex;
        prev = last === null ? -1 : last;
      }
      slot += size;
    }
    return blocks;
  }

  function buildSectionSpec(numTracks, motifCount, fixedRepeats) {
    const totalRepeats = fixedRepeats ||
      SECTION_REPEAT_CHOICES[Math.floor(Math.random() * SECTION_REPEAT_CHOICES.length)];
    const slotUsage = Array.from({ length: totalRepeats }, () => new Set());
    const trackBlocks = [];
    for (let t = 0; t < numTracks; t++) {
      const trackSilent = Math.random() < 0.2;
      trackBlocks.push(trackSilent ? null : buildTrackBlocks(totalRepeats, motifCount, slotUsage));
    }
    ensureCoverage(trackBlocks, totalRepeats, motifCount, slotUsage);
    return { totalRepeats, trackBlocks };
  }

  // Ninguna repetición de célula de la sección queda muda en todas las pistas:
  // los silencios por bloque/pista se sortean por separado y, al coincidir,
  // dejaban silencios generales de decenas de segundos. En cada repetición sin
  // motivo, una pista con un bloque mudo ahí (antes que una pista callada toda
  // la sección, que conserva su papel de orquestación) lo rellena. El bloque se
  // bisecciona (invariante 1) y solo se rellenan las mitades sin cobertura; en
  // ellas no suena nada, así que siempre hay motivo libre (invariante 2)
  function ensureCoverage(trackBlocks, totalRepeats, motifCount, slotUsage) {
    const fillGap = (start, size, prev, next) => {
      let uncovered = 0;
      for (let i = start; i < start + size; i++) if (slotUsage[i].size === 0) uncovered++;
      if (uncovered === 0) return [{ motifIndex: null, repeats: size }];
      if (uncovered === size) return fillSpan(start, size, prev, motifCount, slotUsage, next);
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

  // opts: { numTracks, motifs, formParts, cellLength, scale, key, repeatsByLetter? }
  // repeatsByLetter (de planDuration) fija las repeticiones de cada letra; sin
  // él se sortean entre SECTION_REPEAT_CHOICES
  function compose(opts) {
    const { numTracks, motifs, formParts, cellLength, scale, key, repeatsByLetter } = opts;

    // Cada letra de la forma comparte spec: "A" suena igual cada vez que aparece
    const specByLetter = {};
    const sections = formParts.map(letter => {
      if (!specByLetter[letter]) {
        specByLetter[letter] = buildSectionSpec(numTracks, motifs.length, repeatsByLetter && repeatsByLetter[letter]);
      }
      const spec = specByLetter[letter];
      return { label: letter, totalRepeats: spec.totalRepeats, trackBlocks: spec.trackBlocks, recap: false };
    });

    // Recapitulación: en una sección al azar (no la primera), una pista vuelve a la
    // célula original (o a una variación) durante toda la sección; las demás siguen
    // sus bloques normales pero callan donde coincidirían con el motivo recapitulado
    if (sections.length > 1) {
      const recapIdx = 1 + Math.floor(Math.random() * (sections.length - 1));
      const recapMotif = Math.random() < 0.5 || motifs.length === 1
        ? 0
        : 1 + Math.floor(Math.random() * (motifs.length - 1));
      const base = sections[recapIdx];
      // sorteada entre las pistas con material (no siempre la primera)
      const candidates = [];
      base.trackBlocks.forEach((blocks, t) => { if (blocks !== null) candidates.push(t); });
      const recapTrack = Generator.pickRandom(candidates);
      sections[recapIdx] = {
        label: base.label,
        totalRepeats: base.totalRepeats,
        trackBlocks: base.trackBlocks.map((blocks, t) => {
          if (t === recapTrack) return [{ motifIndex: recapMotif, repeats: base.totalRepeats }];
          if (blocks === null) return null;
          return blocks.map(b => (b.motifIndex === recapMotif ? { ...b, motifIndex: null } : b));
        }),
        recap: true,
        recapTrack
      };
    }

    const totalSteps = sections.reduce((sum, s) => sum + cellLength * s.totalRepeats, 0);
    const grid = Array.from({ length: numTracks }, () => new Array(totalSteps).fill(null));
    const stepEvents = Array.from({ length: totalSteps }, () => []);
    const blockMarkers = [];

    // Plan tonal: la pieza sigue un arco compuesto de antemano sobre el ciclo
    // de quintas, en vez de un paseo al azar. Se sortea un sentido por pieza
    // (bemoles más probable en escalas menores) y una lejanía máxima (peak,
    // acotada por MAX_FIFTH_STEPS y por el número de secciones); la tonalidad
    // se aleja una quinta por sección hasta el clímax, se sostiene y regresa,
    // terminando siempre en la tonalidad base. Las modulaciones solo caen en
    // fronteras de sección — nunca en medio de un bloque — y cada nota guarda
    // el keyOffset de su sección, lo que hace retune-safe la modulación. Sigue
    // siendo suave: las alturas se conservan y solo se alteran las notas ajenas
    // a la tonalidad del tramo (ver degreeToMidiInKey)
    const numSections = sections.length;
    const peakCap = Math.min(MAX_FIFTH_STEPS, Math.floor((numSections - 1) / 2));
    const peak = peakCap > 0 ? 1 + Math.floor(Math.random() * peakCap) : 0;
    const flatBias = scale === 'minor' || scale === 'dorian' ? 0.7 : 0.3;
    const dir = Math.random() < flatBias ? -1 : 1;
    sections.forEach((section, i) => {
      section.fifthOffset = dir * Math.min(i, numSections - 1 - i, peak);
      section.keyOffset = ((section.fifthOffset * 7) % 12 + 12) % 12;
    });
    let pos = 0;
    for (const section of sections) {
      const sectionSteps = cellLength * section.totalRepeats;
      for (let t = 0; t < numTracks; t++) {
        const blocks = section.trackBlocks[t];
        if (blocks === null) continue;
        let blockPos = pos;
        for (const block of blocks) {
          const blockSteps = cellLength * block.repeats;
          if (block.motifIndex !== null) {
            const motif = motifs[block.motifIndex];
            for (let s = 0; s < blockSteps; s++) {
              const step = motif[s % motif.length];
              if (!step.note) continue;
              const midi = Generator.degreeToMidiInKey(step.degree, scale, key, section.keyOffset);
              grid[t][blockPos + s] = {
                midi,
                degree: step.degree,
                keyOffset: section.keyOffset,
                velocity: step.velocity,
                sustain: step.sustain,
                motifIndex: block.motifIndex
              };
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
      section.startStep = pos;
      section.lengthSteps = sectionSteps;
      pos += sectionSteps;
    }

    // Humanización: retoca notas, dinámica y articulación trabajando en grados;
    // debe ir antes de las duraciones porque añade/quita notas y cambia huecos
    Humanizer.humanize({ grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key });

    // Energía: si demasiadas pistas atacan a la vez, las menos salientes ceden
    // notas (menos y más largas). Va tras humanizar, para medir la textura
    // real, y antes del contrapunto, que así vigila la textura ya aclarada
    Energy.balance({ grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key });

    // Contrapunto: consonancia vertical entre pistas (mueve grados ±1, apaga o
    // acorta notas). Va tras humanizar, para vigilar también las notas que la
    // humanización añade, y antes de las duraciones, porque ajusta sustains
    Counterpoint.enforce({ grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key });

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

    piece = { sections, totalSteps, grid, stepEvents, blockMarkers, numTracks, cellLength, scale, key };
    // Una pieza nueva invalida cualquier pausa pendiente de la anterior
    currentStep = 0;
    return piece;
  }

  function getPiece() {
    return piece;
  }

  // Re-mapea los grados de la pieza actual a otra tonalidad/escala sin regenerarla;
  // funciona también en plena reproducción. Conserva la modulación por secciones
  // aplicando el keyOffset guardado en cada nota. stepEvents apunta a las mismas
  // celdas, así que basta con el grid
  function retune(scale, key) {
    if (!piece) return;
    piece.scale = scale;
    piece.key = key;
    for (const row of piece.grid) {
      for (const cell of row) {
        if (cell) cell.midi = Generator.degreeToMidiInKey(cell.degree, scale, key, cell.keyOffset);
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
    MidiEngine.startClock(currentStep);
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

    Tone.Transport.start();
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
