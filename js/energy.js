const Energy = (() => {
  // Intensidad del pase (0 = desactivado, 1 = normal). Determinista: sin azar,
  // las decisiones salen solo del contenido de la rejilla y de la posición en
  // la pieza, así que es depurable e idempotente (re-ejecutarlo no quita más)
  const INTENSITY = 1;

  // Umbral por debajo del cual una nota no cuenta como energía ni se toca
  // (coincide con GHOST_VELOCITY del contrapunto: fantasmas y ecos son textura)
  const AUDIBLE = 0.18;

  // Presupuesto de ataques por paso entre todas las pistas: suelo en los
  // extremos de la pieza y techo en el clímax. La curva es un arco que culmina
  // hacia el 65% de la forma — el pase no solo evita la saturación, también da
  // dirección dramática (dos secciones con la misma letra pueden recibir
  // presupuestos distintos según dónde caigan, y eso es deliberado)
  const DENSITY_FLOOR = 0.9;
  const DENSITY_PEAK = 1.8;
  const CLIMAX = 0.65;

  // Pistas que quedan siempre intactas como primer plano (las más salientes)
  function foregroundCount(numTracks) {
    return Math.max(1, Math.ceil(numTracks / 3));
  }

  // Mapa pista×paso -> marcador de bloque (igual que en el humanizador; el
  // pase no mueve bloques, así que sigue válido mientras muta)
  function buildBlockMap(ctx) {
    const map = Array.from({ length: ctx.numTracks }, () => new Array(ctx.totalSteps).fill(null));
    for (const marker of ctx.blockMarkers) {
      for (let s = marker.startStep; s < marker.startStep + marker.lengthSteps; s++) {
        map[marker.trackIndex][s] = marker;
      }
    }
    return map;
  }

  // Última nota ocupada de cada bloque: cierra la frase y no se retira. Se
  // calcula una vez; como esas notas nunca se borran, sigue siendo la última
  function buildLastOfBlock(ctx) {
    const last = Array.from({ length: ctx.numTracks }, () => new Array(ctx.totalSteps).fill(false));
    for (const marker of ctx.blockMarkers) {
      const row = ctx.grid[marker.trackIndex];
      for (let s = marker.startStep + marker.lengthSteps - 1; s >= marker.startStep; s--) {
        if (row[s]) {
          last[marker.trackIndex][s] = true;
          break;
        }
      }
    }
    return last;
  }

  function sectionAt(ctx, step) {
    return ctx.sections.find(sec => step >= sec.startStep && step < sec.startStep + sec.lengthSteps);
  }

  // Retira la nota y deja resonando la anterior de la pista hacia el hueco
  // nuevo: la duración final es sustain × hueco, así que quitar notas ya
  // alarga la precedente; subir su sustain convierte la línea en colchón
  function removeNote(ctx, t, s, stats) {
    ctx.grid[t][s] = null;
    stats.removed++;
    for (let p = s - 1; p >= 0; p--) {
      const prev = ctx.grid[t][p];
      if (prev) {
        if (prev.sustain < 0.9) {
          prev.sustain = 0.9;
          stats.lengthened++;
        }
        break;
      }
    }
  }

  // ctx: { grid, blockMarkers, sections, numTracks, totalSteps, cellLength, scale, key }
  // Repasa la pieza por ventanas de una repetición de célula (alineadas con las
  // secciones) vigilando la energía global: si los ataques audibles de todas
  // las pistas exceden el presupuesto de la ventana, las pistas menos salientes
  // pasan a fondo y ceden notas — menos notas y más largas. Protecciones:
  //   - el primer plano (pistas más salientes por velocity y agudeza) no se toca
  //   - la pista de recapitulación queda intacta en su sección
  //   - tiempos fuertes (s % 4 === 0), la primera pasada de cada bloque (el
  //     humanizador la mantiene limpia) y la última nota de cada bloque
  // Se retiran primero las notas más débiles, en ronda entre pistas de fondo.
  // Corre tras humanizar y ANTES del contrapunto (que vigila la textura ya
  // aclarada) y de las duraciones. Solo borra celdas y escribe sustain; nunca
  // toca grados ni midi, así que retune sigue funcionando en vivo
  function balance(ctx) {
    const stats = { windows: 0, overloaded: 0, removed: 0, lengthened: 0 };
    if (INTENSITY === 0) return stats;
    const blockMap = buildBlockMap(ctx);
    const lastOfBlock = buildLastOfBlock(ctx);
    const numWindows = Math.floor(ctx.totalSteps / ctx.cellLength);

    for (let w = 0; w < numWindows; w++) {
      const start = w * ctx.cellLength;
      const end = start + ctx.cellLength;
      stats.windows++;

      // Energía y saliencia por pista en la ventana
      const tracks = [];
      let total = 0;
      for (let t = 0; t < ctx.numTracks; t++) {
        const attacks = [];
        let velSum = 0;
        let midiSum = 0;
        for (let s = start; s < end; s++) {
          const cell = ctx.grid[t][s];
          if (cell && cell.velocity > AUDIBLE) {
            attacks.push(s);
            velSum += cell.velocity;
            midiSum += cell.midi;
          }
        }
        if (!attacks.length) continue;
        // La melodía percibida suele ser la línea más fuerte y más aguda
        const salience = 0.6 * (velSum / attacks.length) + 0.4 * (midiSum / attacks.length) / 127;
        tracks.push({ t, attacks, salience });
        total += attacks.length;
      }

      const f = (start + ctx.cellLength / 2) / ctx.totalSteps;
      const curve = f < CLIMAX ? f / CLIMAX : (1 - f) / (1 - CLIMAX);
      const budget = Math.round(ctx.cellLength * (DENSITY_FLOOR + (DENSITY_PEAK - DENSITY_FLOOR) * curve));
      if (total <= budget) continue;
      stats.overloaded++;

      tracks.sort((a, b) => a.salience - b.salience || a.t - b.t);
      const background = tracks.slice(0, Math.max(0, tracks.length - foregroundCount(ctx.numTracks)));
      const section = sectionAt(ctx, start);

      // Candidatas a caer por pista de fondo, las más débiles primero
      for (const tr of background) {
        tr.candidates = tr.attacks.filter(s => {
          if (section && section.recap && tr.t === section.recapTrack) return false;
          if (s % 4 === 0) return false;
          if (lastOfBlock[tr.t][s]) return false;
          const marker = blockMap[tr.t][s];
          if (marker && s - marker.startStep < ctx.cellLength) return false;
          return true;
        });
        tr.candidates.sort((a, b) =>
          ctx.grid[tr.t][a].velocity - ctx.grid[tr.t][b].velocity || a - b);
      }

      // Ronda entre pistas de fondo hasta cumplir presupuesto o agotar
      // candidatas: reparte la poda en vez de vaciar una sola línea
      let progress = true;
      while (total > budget && progress) {
        progress = false;
        for (const tr of background) {
          if (total <= budget) break;
          if (!tr.candidates.length) continue;
          removeNote(ctx, tr.t, tr.candidates.shift(), stats);
          total--;
          progress = true;
        }
      }
    }
    return stats;
  }

  return { balance };
})();
