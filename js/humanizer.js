const Humanizer = (() => {
  // Intensidad global de la humanización (0 = partitura literal, 1 = normal)
  const INTENSITY = 1;

  function midiFor(ctx, degree, keyOffset) {
    return Generator.degreeToMidiInKey(degree, ctx.scale, ctx.key, keyOffset);
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
            row[s - 1] = {
              midi: midiFor(ctx, degree, cell.keyOffset),
              degree,
              keyOffset: cell.keyOffset,
              velocity: Math.max(0.05, cell.velocity * 0.5),
              sustain: 0.3,
              motifIndex: cell.motifIndex
            };
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
            row[prev + (gap >> 1)] = {
              midi: midiFor(ctx, degree, a.keyOffset),
              degree,
              keyOffset: a.keyOffset,
              velocity: Math.max(0.05, Math.min(a.velocity, b.velocity) * 0.7),
              sustain: 0.6,
              motifIndex: a.motifIndex
            };
          }
        }
        prev = s;
      }
    }
  }

  // La articulación responde al gesto melódico: legato en grados conjuntos,
  // corte tras un salto, resonancia hacia los silencios largos, y la última
  // nota de cada bloque (y de la pista) queda sostenida para cerrar la frase
  function shapeArticulation(ctx, blockMap) {
    for (let t = 0; t < ctx.numTracks; t++) {
      const row = ctx.grid[t];
      let prev = -1;
      for (let s = 0; s < ctx.totalSteps; s++) {
        if (!row[s]) continue;
        if (prev >= 0) {
          const a = row[prev];
          if (blockMap[t][prev] !== blockMap[t][s]) {
            a.sustain = 1;
          } else {
            const jump = Math.abs(row[s].degree - a.degree);
            if (jump <= 1) a.sustain = Math.max(a.sustain, 0.9);
            else if (jump >= 5) a.sustain = Math.min(a.sustain, 0.45);
            // ante un silencio largo la nota suele quedarse resonando en vez
            // de cortarse en seco
            if (s - prev >= 4 && jump < 5 && Math.random() < 0.6 * INTENSITY) {
              a.sustain = Math.max(a.sustain, 0.75 + Math.random() * 0.25);
            }
          }
        }
        prev = s;
      }
      if (prev >= 0) row[prev].sustain = 1;
    }
  }

  // Arco de intensidad por bloque (crece hacia el 60% y cede al final) y un
  // eco sutil en las repeticiones impares para que la métrica respire
  function shapeDynamics(ctx) {
    for (const marker of ctx.blockMarkers) {
      const row = ctx.grid[marker.trackIndex];
      for (let s = marker.startStep; s < marker.startStep + marker.lengthSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const t01 = (s - marker.startStep) / marker.lengthSteps;
        const shape = t01 < 0.6 ? t01 / 0.6 : (1 - t01) / 0.4;
        const rep = Math.floor((s - marker.startStep) / ctx.cellLength);
        const echo = rep % 2 === 1 ? 0.95 : 1;
        cell.velocity = Math.max(0.05, Math.min(1, cell.velocity * (0.9 + 0.2 * shape * INTENSITY) * echo));
      }
    }
  }

  // Antes de cada frontera de sección algunas pistas "toman aire": la última
  // nota de la sección se acorta y, de vez en cuando, calla del todo
  function addBreaths(ctx) {
    for (let i = 0; i < ctx.sections.length - 1; i++) {
      const sec = ctx.sections[i];
      const end = sec.startStep + sec.lengthSteps;
      for (let t = 0; t < ctx.numTracks; t++) {
        const row = ctx.grid[t];
        let last = -1;
        for (let s = sec.startStep; s < end; s++) {
          if (row[s]) last = s;
        }
        if (last < 0) continue;
        const roll = Math.random();
        if (roll < 0.3 * INTENSITY) row[last].sustain = 0.25;
        else if (roll < 0.4 * INTENSITY) row[last] = null;
      }
    }
  }

  // Grados de la tríada de tónica en la escala: el índice cuyo intervalo queda
  // más cerca de la tercera (3-4 semitonos) y de la quinta (7). Sirve para
  // pentatónicas y cromática, donde los grados 2 y 4 no son tercera y quinta
  function tonicTriad(scale) {
    const intervals = Generator.SCALES[scale] || Generator.SCALES.major;
    const nearest = target => {
      let best = 0;
      intervals.forEach((iv, idx) => {
        if (Math.abs(iv - target) < Math.abs(intervals[best] - target)) best = idx;
      });
      return best;
    };
    return { size: intervals.length, degrees: [0, nearest(3.5), nearest(7)] };
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
  // la nota final de cada pista se posa en la tríada de tónica (la que ataca
  // más tarde, en la tónica misma) y queda ligada y marcada `final` para que
  // el transporte la deje sonar en la coda (Composer.ENDING_TAIL_STEPS)
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
    const triad = tonicTriad(ctx.scale);
    const latest = finals.reduce((a, b) => (b.s > a.s ? b : a));
    for (const f of finals) {
      const pool = f === latest ? [0] : triad.degrees;
      f.cell.degree = nearestDegree(f.cell.degree, pool, triad.size);
      f.cell.midi = midiFor(ctx, f.cell.degree, f.cell.keyOffset);
      f.cell.sustain = 1;
      f.cell.velocity = Math.max(f.cell.velocity, 0.3);
      f.cell.final = true;
    }
  }

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key }
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
