const Counterpoint = (() => {
  // Intensidad del pase (0 = desactivado, 1 = normal). A diferencia del
  // humanizador es determinista: sin azar, para que las secciones con la misma
  // letra reciban las mismas correcciones y la recapitulación siga literal
  const INTENSITY = 1;

  // Debe coincidir con el cálculo de duraciones del compositor
  const MAX_SUSTAIN_STEPS = 16;

  // Velocity a la que se apaga una nota disonante que no pudo resolverse
  const GHOST_VELOCITY = 0.18;

  function midiFor(ctx, degree, keyOffset) {
    return Generator.degreeToMidiInKey(degree, ctx.scale, ctx.key, keyOffset);
  }

  // Disonancia dura entre dos notas simultáneas. En escalas de >= 6 grados la
  // distancia de grados mod n clasifica segundas (1) y séptimas (n-1) — regla
  // estable frente a retune entre escalas del mismo largo; el tritono se mira
  // en semitonos. En pentatónica no hay clases de grado disonantes y se mira
  // todo en semitonos
  function isDissonant(a, b, scaleLen) {
    const si = Math.abs(a.midi - b.midi) % 12;
    if (si === 6) return true;
    if (scaleLen >= 6) {
      const dd = Math.abs(a.degree - b.degree) % scaleLen;
      return dd === 1 || dd === scaleLen - 1;
    }
    return si === 1 || si === 2 || si === 10 || si === 11;
  }

  // Nota de paso tolerada en tiempo débil: llega por grado conjunto desde una
  // nota reciente de su propia pista
  function isPassing(ctx, notePositions, lastIdx, a, s) {
    const pos = notePositions[a.t];
    const i = lastIdx[a.t];
    if (i <= 0) return false;
    const prevPos = pos[i - 1];
    if (s - prevPos > 2) return false;
    const prev = ctx.grid[a.t][prevPos];
    return Math.abs(a.cell.degree - prev.degree) <= 1;
  }

  // Acorta una nota sostenida para que su duración termine justo cuando
  // empieza el paso s (mismo redondeo que usa el compositor)
  function cutHeld(h, s, stats) {
    const newSustain = (s - h.start - 0.5) / Math.min(h.gap, MAX_SUSTAIN_STEPS);
    if (newSustain < h.cell.sustain) {
      h.cell.sustain = Math.max(0.05, newSustain);
      stats.cut++;
    }
  }

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key }
  // Recorre la pieza paso a paso vigilando las verticalidades entre pistas:
  //   1. Ataques disonantes entre sí: en tiempo débil se toleran si son nota de
  //      paso; si no, la nota de menor peso se mueve ±1 grado a la consonancia
  //      más cercana (preferencia descendente) o, si no hay, se vuelve fantasma.
  //   2. Unísonos exactos entre ataques se abren a la octava libre (36..96);
  //      salvo las notas de paso toleradas, cuya octava no se toca (su grado
  //      conjunto es lo que las justifica y el pase perdería idempotencia).
  //   3. Nota sostenida que choca con un ataque: se acorta el sustain de la
  //      sostenida (menos invasivo que cambiarle la altura ya sonada).
  //   4. En tiempo fuerte, dos sostenidas disonantes entre sí: se corta la que
  //      empezó más tarde.
  // Corre tras humanizar y ANTES de calcular duraciones. Nunca añade, quita ni
  // desplaza notas (los huecos no cambian); solo escribe degree/sustain/velocity
  // y deriva midi de los grados, para que retune siga funcionando en vivo
  function enforce(ctx) {
    const stats = { unisons: 0, moved: 0, ghosted: 0, cut: 0, notes: 0 };
    if (INTENSITY === 0) return stats;
    const scaleLen = (Generator.SCALES[ctx.scale] || Generator.SCALES.major).length;

    // Posiciones de nota por pista (estables: el pase no añade ni quita notas)
    const notePositions = ctx.grid.map(row => {
      const pos = [];
      for (let s = 0; s < ctx.totalSteps; s++) {
        if (row[s]) pos.push(s);
      }
      stats.notes += pos.length;
      return pos;
    });
    const lastIdx = new Array(ctx.numTracks).fill(-1);

    for (let s = 0; s < ctx.totalSteps; s++) {
      const strong = s % 4 === 0;

      const attacks = [];
      const held = [];
      for (let t = 0; t < ctx.numTracks; t++) {
        const pos = notePositions[t];
        while (lastIdx[t] + 1 < pos.length && pos[lastIdx[t] + 1] <= s) lastIdx[t]++;
        const i = lastIdx[t];
        if (i < 0) continue;
        const start = pos[i];
        const cell = ctx.grid[t][start];
        // Las notas casi inaudibles (fantasmas, ecos) no participan: ni fuerzan
        // correcciones ni las reciben — también hace el pase idempotente
        if (cell.velocity <= GHOST_VELOCITY) continue;
        if (start === s) {
          attacks.push({ t, cell });
        } else {
          const gap = (i + 1 < pos.length ? pos[i + 1] : ctx.totalSteps) - start;
          const dur = Math.max(1, Math.round(cell.sustain * Math.min(gap, MAX_SUSTAIN_STEPS)));
          if (start + dur > s) held.push({ t, cell, start, gap });
        }
      }
      if (attacks.length + held.length < 2) continue;

      // 1. Ataques contra ataques, de mayor a menor peso; los fantasmas no
      // entran en `accepted` para no encadenar correcciones contra notas casi
      // inaudibles
      const sorted = attacks.slice().sort((a, b) => b.cell.velocity - a.cell.velocity || a.t - b.t);
      const accepted = [];
      // Disonancias toleradas por ser nota de paso: el grado conjunto con la
      // nota anterior es lo que las justifica, así que no pueden cambiar de
      // octava en el pase de unísonos (perderían esa relación y el pase
      // dejaría de ser idempotente)
      const passing = new Set();
      for (const a of sorted) {
        const cell = a.cell;
        const clash = accepted.some(o => isDissonant(cell, o.cell, scaleLen));
        if (!clash || (!strong && isPassing(ctx, notePositions, lastIdx, a, s))) {
          if (clash) passing.add(cell);
          accepted.push(a);
          continue;
        }
        let fixed = false;
        for (const delta of [-1, 1]) {
          const degree = cell.degree + delta;
          const midi = midiFor(ctx, degree, cell.keyOffset);
          const cand = { degree, midi };
          if (accepted.every(o => !isDissonant(cand, o.cell, scaleLen) && o.cell.midi !== midi)) {
            cell.degree = degree;
            cell.midi = midi;
            stats.moved++;
            fixed = true;
            break;
          }
        }
        if (fixed) accepted.push(a);
        else {
          cell.velocity = Math.min(cell.velocity, GHOST_VELOCITY);
          stats.ghosted++;
        }
      }

      // 2. Unísonos exactos entre ataques audibles -> octava libre más cercana.
      // Corre DESPUÉS de resolver los ataques porque una corrección de grado
      // puede caer en el midi de otra pista; el desplazamiento de octava nunca
      // rompe consonancia (la clasificación trabaja mod octava)
      const taken = new Set();
      for (const a of attacks) {
        const cell = a.cell;
        if (cell.velocity <= GHOST_VELOCITY) continue;
        if (taken.has(cell.midi) && !passing.has(cell)) {
          const up = midiFor(ctx, cell.degree + scaleLen, cell.keyOffset);
          const down = midiFor(ctx, cell.degree - scaleLen, cell.keyOffset);
          if (!taken.has(up) && up <= 96) {
            cell.degree += scaleLen;
            cell.midi = up;
            stats.unisons++;
          } else if (!taken.has(down) && down >= 36) {
            cell.degree -= scaleLen;
            cell.midi = down;
            stats.unisons++;
          }
        }
        taken.add(cell.midi);
      }

      // 3. Sostenidas que chocan con un ataque -> se acortan
      for (const h of held) {
        const mustCut = accepted.some(o =>
          isDissonant(h.cell, o.cell, scaleLen) &&
          (strong || !isPassing(ctx, notePositions, lastIdx, o, s)));
        if (mustCut) cutHeld(h, s, stats);
      }

      // 4. En tiempo fuerte, sostenidas disonantes entre sí -> se corta la más
      // reciente (ordenadas por inicio, cada una contra las anteriores vivas)
      if (strong && held.length > 1) {
        held.sort((a, b) => a.start - b.start || a.t - b.t);
        const alive = [];
        for (const h of held) {
          if (alive.some(o => isDissonant(h.cell, o.cell, scaleLen))) cutHeld(h, s, stats);
          else alive.push(h);
        }
      }
    }
    return stats;
  }

  return { enforce, isDissonant };
})();
