const Composer = (() => {
  let piece = null;
  let isPlaying = false;
  let repeatEventId = null;
  let currentStep = 0;

  const STEP = '16n';
  // Repeticiones totales de célula por sección (potencias de 2)
  const SECTION_REPEAT_CHOICES = [2, 4];
  // Límite del viaje por el ciclo de quintas: la tonalidad no se aleja más de
  // este número de quintas (en cualquiera de los dos sentidos) desde la base
  const MAX_FIFTH_STEPS = 4;

  // Compresión de dinámica al tocar (no altera la partitura): el rango audible
  // se estrecha hacia DYN_CENTER con razón DYN_RATIO (0.5 ≈ compresor 2:1)
  // para que las notas suaves no desaparezcan ni las fuertes golpeen. Las
  // notas fantasma (velocity <= 0.18: disonancias apagadas por el contrapunto,
  // ecos del humanizador) se dejan tal cual — su papel es ser casi inaudibles
  const DYN_CENTER = 0.65;
  const DYN_RATIO = 0.5;
  const GHOST_VELOCITY = 0.18;

  function shapeVelocity(v) {
    if (v <= GHOST_VELOCITY) return v;
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
  function fillSpan(slotStart, size, prev, motifCount, slotUsage) {
    const used = new Set();
    for (let i = 0; i < size; i++) {
      for (const m of slotUsage[slotStart + i]) used.add(m);
    }
    const candidates = [];
    for (let m = 0; m < motifCount; m++) {
      if (m !== prev && !used.has(m)) candidates.push(m);
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
      const right = fillSpan(slotStart + half, half, lastLeft === null ? -1 : lastLeft, motifCount, slotUsage);
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

  function buildSectionSpec(numTracks, motifCount) {
    const totalRepeats = SECTION_REPEAT_CHOICES[Math.floor(Math.random() * SECTION_REPEAT_CHOICES.length)];
    const slotUsage = Array.from({ length: totalRepeats }, () => new Set());
    const trackBlocks = [];
    for (let t = 0; t < numTracks; t++) {
      const trackSilent = Math.random() < 0.2;
      trackBlocks.push(trackSilent ? null : buildTrackBlocks(totalRepeats, motifCount, slotUsage));
    }
    if (trackBlocks.every(b => b === null)) {
      trackBlocks[Math.floor(Math.random() * numTracks)] = buildTrackBlocks(totalRepeats, motifCount, slotUsage);
    }
    return { totalRepeats, trackBlocks };
  }

  // opts: { numTracks, motifs, formParts, cellLength, scale, key, fifthSteps }
  function compose(opts) {
    const { numTracks, motifs, formParts, cellLength, scale, key, fifthSteps } = opts;

    // Cada letra de la forma comparte spec: "A" suena igual cada vez que aparece
    const specByLetter = {};
    const sections = formParts.map(letter => {
      if (!specByLetter[letter]) {
        specByLetter[letter] = buildSectionSpec(numTracks, motifs.length);
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
      const recapTrack = base.trackBlocks.findIndex(blocks => blocks !== null);
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

    // Modulación: cada fifthSteps repeticiones de célula acumuladas (siempre una
    // frontera de sección) el viaje por el ciclo de quintas da un paso aleatorio
    // de ±1 quinta (+7/-7 semitonos), hacia adelante o hacia atrás. El viaje se
    // limita a ±MAX_FIFTH_STEPS pasos desde la tonalidad base (ni se aleja
    // demasiado hacia las sostenidas ni hacia las bemoles), rebotando en el
    // borde. Es una modulación suave: las alturas se conservan y solo se alteran
    // las notas ajenas a la tonalidad nueva (ver degreeToMidiInKey)
    let pos = 0;
    let cumRepeats = 0;
    let fifthStep = 0;
    let prevCadence = 0;
    for (const section of sections) {
      const cadence = fifthSteps ? Math.floor(cumRepeats / fifthSteps) : 0;
      if (cadence > prevCadence) {
        fifthStep += Generator.pickRandom([-1, 1]);
        fifthStep = Math.max(-MAX_FIFTH_STEPS, Math.min(MAX_FIFTH_STEPS, fifthStep));
        prevCadence = cadence;
      }
      section.keyOffset = ((fifthStep * 7) % 12 + 12) % 12;
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
      cumRepeats += section.totalRepeats;
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
    const MAX_SUSTAIN_STEPS = 16;
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
        const durationSteps = Math.max(1, Math.round(cell.sustain * Math.min(gap, MAX_SUSTAIN_STEPS)));
        cell.durationSteps = durationSteps;
        stepEvents[s].push({
          trackIndex: t,
          midi: cell.midi,
          degree: cell.degree,
          keyOffset: cell.keyOffset,
          velocity: cell.velocity,
          durationSteps
        });
      }
    }

    piece = { sections, totalSteps, grid, stepEvents, blockMarkers, numTracks, cellLength, scale, key, fifthSteps };
    // Una pieza nueva invalida cualquier pausa pendiente de la anterior
    currentStep = 0;
    return piece;
  }

  function getPiece() {
    return piece;
  }

  // Re-mapea los grados de la pieza actual a otra tonalidad/escala sin regenerarla;
  // funciona también en plena reproducción. Conserva la modulación por secciones
  // aplicando el keyOffset guardado en cada nota
  function retune(scale, key) {
    if (!piece) return;
    piece.scale = scale;
    piece.key = key;
    for (const row of piece.grid) {
      for (const cell of row) {
        if (cell) cell.midi = Generator.degreeToMidiInKey(cell.degree, scale, key, cell.keyOffset);
      }
    }
    for (const events of piece.stepEvents) {
      for (const ev of events) {
        ev.midi = Generator.degreeToMidiInKey(ev.degree, scale, key, ev.keyOffset);
      }
    }
  }

  function play(onStep, onComplete) {
    if (isPlaying || !piece || piece.totalSteps === 0) return;
    isPlaying = true;
    // Reanuda desde donde se pausó; tras el final (o tras rebobinar) parte de 0
    if (currentStep >= piece.totalSteps) currentStep = 0;

    Tone.Transport.cancel();
    repeatEventId = Tone.Transport.scheduleRepeat(time => {
      const step = currentStep;
      if (step >= piece.totalSteps) {
        Tone.Draw.schedule(() => {
          if (!isPlaying) return;
          stop();
          if (onComplete) onComplete();
        }, time);
        return;
      }
      currentStep++;

      // Factor 0.95 para que sintes monofónicos no pisen el retrigger en legato
      const stepSeconds = Tone.Time(STEP).toSeconds();
      for (const ev of piece.stepEvents[step]) {
        const duration = ev.durationSteps * stepSeconds * 0.95;
        const velocity = shapeVelocity(ev.velocity);
        AudioEngine.playNote(ev.trackIndex, ev.midi, time, duration, velocity);
        MidiEngine.playNote(ev.trackIndex, ev.midi, time, duration, velocity);
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
  }

  function getCurrentStep() {
    return currentStep;
  }

  function getIsPlaying() {
    return isPlaying;
  }

  return { compose, retune, play, stop, getPiece, getIsPlaying, getCurrentStep, shapeVelocity };
})();
