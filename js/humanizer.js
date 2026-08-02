const Humanizer = (() => {
  // Intensidad global de la humanización (0 = partitura literal, 1 = normal)
  const INTENSITY = 1;

  function midiFor(ctx, degree, keyOffset) {
    return Generator.degreeToMidiInKey(degree, ctx.scale, ctx.key, keyOffset);
  }

  // Mapa pista×paso -> marcador de bloque, para saber a qué bloque pertenece
  // cada nota; los pases no mueven bloques, así que sigue válido tras mutar
  function buildBlockMap(ctx) {
    const map = Array.from({ length: ctx.numTracks }, () => new Array(ctx.totalSteps).fill(null));
    for (const marker of ctx.blockMarkers) {
      for (let s = marker.startStep; s < marker.startStep + marker.lengthSteps; s++) {
        map[marker.trackIndex][s] = marker;
      }
    }
    return map;
  }

  function sectionAt(ctx, step) {
    return ctx.sections.find(sec => step >= sec.startStep && step < sec.startStep + sec.lengthSteps);
  }

  // Las repeticiones de un bloque se van "gastando": a partir de la segunda,
  // alguna nota cae, se vuelve fantasma o gana un mordente (nota vecina breve
  // justo antes). La primera pasada siempre suena limpia; la recapitulación
  // literal no se toca para no diluir el retorno de la célula
  function mutateRepetitions(ctx) {
    for (const marker of ctx.blockMarkers) {
      const section = sectionAt(ctx, marker.startStep);
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
            const degree = cell.degree + (Math.random() < 0.5 ? -1 : 1);
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

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key }
  // Debe correr tras colocar los motivos y ANTES de calcular duraciones (añade
  // y quita notas, así que los huecos cambian). Solo escribe grados y deja que
  // midi se derive de ellos, para que retune siga funcionando en vivo
  function humanize(ctx) {
    const blockMap = buildBlockMap(ctx);
    mutateRepetitions(ctx);
    addPassingTones(ctx, blockMap);
    shapeArticulation(ctx, blockMap);
    shapeDynamics(ctx);
    addBreaths(ctx);
  }

  return { humanize };
})();
