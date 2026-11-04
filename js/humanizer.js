const Humanizer = (() => {
  // Intensidad global de la humanización (0 = partitura literal, 1 = normal)
  const INTENSITY = 1;

  // Toda nota que se añade o altera recibe su altura con Harmony.setPitch:
  // grado, alteración del acorde vigente (cell.alter) y midi derivado de
  // ambos con la región y el registro de la nota (keyOffset, mode, octave) —
  // retune-safe. Se coloca en la rejilla antes de afinarla: la alteración
  // mira la nota siguiente de su pista
  function newNote(ctx, row, s, anchor, degree, velocity, sustain) {
    const cell = { midi: 0, degree, keyOffset: anchor.keyOffset, velocity, sustain, motifIndex: anchor.motifIndex };
    if (anchor.mode) cell.mode = anchor.mode;
    if (anchor.octave) cell.octave = anchor.octave;
    row[s] = cell;
    Harmony.setPitch(ctx, s, cell, degree);
    return cell;
  }

  // Las repeticiones de un bloque se van "gastando": a partir de la segunda,
  // alguna nota cae, se vuelve fantasma o gana un mordente (nota vecina breve
  // justo antes). La primera pasada siempre suena limpia; la recapitulación
  // literal no se toca para no diluir el retorno de la célula
  function mutateRepetitions(ctx) {
    for (const marker of ctx.blockMarkers) {
      const section = Generator.sectionAt(ctx, marker.startStep);
      if (section && section.recap && marker.lengthSteps === section.lengthSteps) continue;
      const row = ctx.grid[marker.trackIndex];
      const reps = marker.lengthSteps / ctx.cellLength;
      for (let r = 1; r < reps; r++) {
        const chance = Math.min(0.25, 0.08 * r) * INTENSITY;
        const start = marker.startStep + r * ctx.cellLength;
        for (let s = start; s < start + ctx.cellLength; s++) {
          const cell = row[s];
          if (!cell || Math.random() >= chance) continue;
          const roll = Math.random();
          if (roll < 0.35) {
            row[s] = null;
          } else if (roll < 0.7) {
            cell.velocity = Math.max(0.05, cell.velocity * 0.35);
          } else if (s > marker.startStep && !row[s - 1]) {
            // Vecina por arriba o por abajo, la que quede en [-7, 7]
            let dir = Math.random() < 0.5 ? -1 : 1;
            if (Math.abs(cell.degree + dir) > 7) dir = -dir;
            const degree = cell.degree + dir;
            newNote(ctx, row, s - 1, cell, degree, Math.max(0.05, cell.velocity * 0.5), 0.3);
          }
        }
      }
    }
  }

  // Saltos amplios entre dos notas del mismo bloque con hueco intermedio se
  // suavizan con una nota de paso a mitad de camino; conserva el motifIndex
  // del bloque para no romper la exclusividad de motivo entre pistas
  function addPassingTones(ctx, blockMap) {
    for (let t = 0; t < ctx.numTracks; t++) {
      const row = ctx.grid[t];
      let prev = -1;
      for (let s = 0; s < ctx.totalSteps; s++) {
        if (!row[s]) continue;
        if (prev >= 0) {
          const a = row[prev];
          const b = row[s];
          const gap = s - prev;
          const jump = b.degree - a.degree;
          if (gap >= 2 && Math.abs(jump) >= 5 &&
              blockMap[t][prev] === blockMap[t][s] &&
              Math.random() < 0.6 * INTENSITY) {
            const degree = a.degree + Math.round(jump / 2);
            const at = prev + (gap >> 1);
            newNote(ctx, row, at, a, degree, Math.max(0.05, Math.min(a.velocity, b.velocity) * 0.7), 0.6);
          }
        }
        prev = s;
      }
    }
  }

  // La articulación responde al gesto melódico: legato en grados conjuntos,
  // corte tras un salto aislado, resonancia hacia los silencios largos, y la
  // última nota de cada bloque (y de la pista) queda sostenida para cerrar la
  // frase. Un salto que llega de otro salto no corta: es textura pendular
  // (acorde quebrado, pedal, ostinato ancho) y se toca ligada
  function shapeArticulation(ctx, blockMap) {
    for (let t = 0; t < ctx.numTracks; t++) {
      const row = ctx.grid[t];
      let prev = -1;
      let prevJump = 0;
      for (let s = 0; s < ctx.totalSteps; s++) {
        if (!row[s]) continue;
        if (prev >= 0) {
          const a = row[prev];
          const jump = Math.abs(row[s].degree - a.degree);
          if (blockMap[t][prev] !== blockMap[t][s]) {
            a.sustain = 1;
          } else {
            if (jump <= 1) a.sustain = Math.max(a.sustain, 0.9);
            else if (jump >= 5 && prevJump < 3) a.sustain = Math.min(a.sustain, 0.45);
            // ante un silencio largo la nota suele quedarse resonando en vez
            // de cortarse en seco
            if (s - prev >= 4 && jump < 5 && Math.random() < 0.6 * INTENSITY) {
              a.sustain = Math.max(a.sustain, 0.75 + Math.random() * 0.25);
            }
          }
          prevJump = jump;
        }
        prev = s;
      }
      if (prev >= 0) row[prev].sustain = 1;
    }
  }

  // Dinámica en tres escalas: el nivel del plan formal (carácter de la letra
  // × perfil de intensidad de la pieza, que culmina en el mismo clímax que
  // Energy y el plan tonal, × rampa de la retransición: FormPlan.levelAt),
  // un arco por frase (crece hacia su 60 % y cede hacia la cadencia) y un eco
  // sutil en las repeticiones impares de cada bloque para que la métrica
  // respire. Sin frases (pases sueltos), el arco es el del bloque
  function shapeDynamics(ctx) {
    for (const marker of ctx.blockMarkers) {
      const row = ctx.grid[marker.trackIndex];
      for (let s = marker.startStep; s < marker.startStep + marker.lengthSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const section = Generator.sectionAt(ctx, s);
        const span = FormPlan.phraseAt(section, s) || marker;
        const shape = FormPlan.phraseArc((s - span.startStep) / span.lengthSteps);
        const rep = Math.floor((s - marker.startStep) / ctx.cellLength);
        const echo = rep % 2 === 1 ? 0.95 : 1;
        const level = 1 + (FormPlan.levelAt(ctx.form, section, s) - 1) * INTENSITY;
        cell.velocity = Math.max(0.05, Math.min(1, cell.velocity * level * (0.92 + 0.16 * shape * INTENSITY) * echo));
      }
    }
  }

  // Antes de cada frontera de sección algunas pistas "toman aire": la última
  // nota de la sección se acorta y, de vez en cuando, calla del todo. En los
  // finales de frase dentro de una sección (FormPlan) respiran menos y la
  // pista que recapitula no, para que su retorno siga literal
  function breatheBefore(ctx, start, end, shorten, drop, skipTrack) {
    for (let t = 0; t < ctx.numTracks; t++) {
      if (t === skipTrack) continue;
      const row = ctx.grid[t];
      let last = -1;
      for (let s = start; s < end; s++) {
        if (row[s]) last = s;
      }
      if (last < 0) continue;
      const roll = Math.random();
      if (roll < shorten * INTENSITY) row[last].sustain = 0.25;
      else if (roll < (shorten + drop) * INTENSITY) row[last] = null;
    }
  }

  function addBreaths(ctx) {
    ctx.sections.forEach((sec, i) => {
      const phrases = sec.phrases || [];
      for (let j = 0; j < phrases.length - 1; j++) {
        const p = phrases[j];
        breatheBefore(ctx, p.startStep, p.startStep + p.lengthSteps, 0.25, 0.05, sec.recap ? sec.recapTrack : -1);
      }
      if (i < ctx.sections.length - 1) breatheBefore(ctx, sec.startStep, sec.startStep + sec.lengthSteps, 0.3, 0.1, -1);
    });
  }

  function nearestDegree(degree, pool, size) {
    let best = degree;
    let bestDist = Infinity;
    for (const d of pool) {
      for (let k = -2; k <= 2; k++) {
        const c = d + k * size;
        if (c < -7 || c > 7) continue;
        const dist = Math.abs(c - degree);
        if (dist < bestDist) {
          best = c;
          bestDist = dist;
        }
      }
    }
    return best;
  }

  // Final de la pieza: diminuendo sobre las últimas células y, en la última,
  // la nota final de cada pista se posa en el acorde de cierre del plan
  // armónico — la I de la cadencia perfecta; sin plan (cromática), la tríada
  // de tónica — (la que ataca más tarde, en la tónica misma) y queda ligada y
  // marcada `final` para que el transporte la deje sonar en la coda
  // (Composer.ENDING_TAIL_STEPS)
  function shapeEnding(ctx) {
    const { grid, totalSteps, cellLength } = ctx;
    const window = Math.min(totalSteps, Math.max(cellLength, Math.floor(totalSteps / 8)), cellLength * 2);
    const from = totalSteps - window;
    for (const row of grid) {
      for (let s = from; s < totalSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const p = (s - from) / window;
        cell.velocity = Math.max(0.05, cell.velocity * (1 - 0.45 * p * p));
      }
    }

    const lastCellStart = Math.max(0, totalSteps - cellLength);
    const finals = [];
    grid.forEach((row, t) => {
      for (let s = totalSteps - 1; s >= lastCellStart; s--) {
        if (row[s]) {
          finals.push({ t, s, cell: row[s] });
          return;
        }
      }
    });
    if (!finals.length) return;
    const triad = Harmony.finalChord(ctx);
    const latest = finals.reduce((a, b) => (b.s > a.s ? b : a));
    for (const f of finals) {
      const pool = f === latest ? [triad.root] : triad.degrees;
      Harmony.setPitch(ctx, f.s, f.cell, nearestDegree(f.cell.degree, pool, triad.size));
      f.cell.sustain = 1;
      f.cell.velocity = Math.max(f.cell.velocity, 0.3);
      f.cell.final = true;
    }
  }

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key, modulation, harmony, form }
  // Debe correr tras colocar los motivos y ANTES de calcular duraciones (añade
  // y quita notas, así que los huecos cambian). Solo escribe grados y deja que
  // midi se derive de ellos, para que retune siga funcionando en vivo
  function humanize(ctx) {
    const blockMap = Generator.buildBlockMap(ctx);
    mutateRepetitions(ctx);
    addPassingTones(ctx, blockMap);
    shapeArticulation(ctx, blockMap);
    shapeDynamics(ctx);
    addBreaths(ctx);
    shapeEnding(ctx);
  }

  return { humanize };
})();
