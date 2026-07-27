const Composer = (() => {
  let piece = null;
  let isPlaying = false;
  let repeatEventId = null;
  let currentStep = 0;

  const STEP = '16n';
  // Repeticiones totales de célula por sección (potencias de 2)
  const SECTION_REPEAT_CHOICES = [2, 4];

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
        recap: true
      };
    }

    const totalSteps = sections.reduce((sum, s) => sum + cellLength * s.totalRepeats, 0);
    const grid = Array.from({ length: numTracks }, () => new Array(totalSteps).fill(null));
    const stepEvents = Array.from({ length: totalSteps }, () => []);
    const blockMarkers = [];

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
              const midi = Generator.degreeToMidi(step.degree, scale, key, fifthSteps);
              grid[t][blockPos + s] = {
                midi,
                degree: step.degree,
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

    // Duraciones: cada nota sostiene una fracción (sustain) del hueco hasta la
    // siguiente nota de su pista — legato como máximo, nunca superposición
    const MAX_SUSTAIN_STEPS = 8;
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
          velocity: cell.velocity,
          durationSteps
        });
      }
    }

    piece = { sections, totalSteps, grid, stepEvents, blockMarkers, numTracks, cellLength, scale, key, fifthSteps };
    return piece;
  }

  function getPiece() {
    return piece;
  }

  // Re-mapea los grados de la pieza actual a otra tonalidad/escala sin regenerarla;
  // funciona también en plena reproducción
  function retune(scale, key) {
    if (!piece) return;
    piece.scale = scale;
    piece.key = key;
    for (const row of piece.grid) {
      for (const cell of row) {
        if (cell) cell.midi = Generator.degreeToMidi(cell.degree, scale, key, piece.fifthSteps);
      }
    }
    for (const events of piece.stepEvents) {
      for (const ev of events) {
        ev.midi = Generator.degreeToMidi(ev.degree, scale, key, piece.fifthSteps);
      }
    }
  }

  function play(onStep, onComplete) {
    if (isPlaying || !piece || piece.totalSteps === 0) return;
    isPlaying = true;
    currentStep = 0;

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
        AudioEngine.playNote(ev.trackIndex, ev.midi, time, duration, ev.velocity);
      }
      Tone.Draw.schedule(() => {
        if (isPlaying && onStep) onStep(step);
      }, time);
    }, STEP);

    Tone.Transport.start();
  }

  function stop() {
    if (!isPlaying) return;
    isPlaying = false;
    Tone.Transport.stop();
    if (repeatEventId !== null) {
      Tone.Transport.clear(repeatEventId);
      repeatEventId = null;
    }
    Tone.Transport.cancel();
    Tone.Transport.position = 0;
    currentStep = 0;
  }

  function getIsPlaying() {
    return isPlaying;
  }

  return { compose, retune, play, stop, getPiece, getIsPlaying };
})();
