const Energy = (() => {
  // Intensidad del pase (0 = desactivado, 1 = normal). Determinista: sin azar,
  // las decisiones salen solo del contenido de la rejilla y de la posición en
  // la pieza, así que es depurable e idempotente (re-ejecutarlo no quita más)
  const INTENSITY = 1;

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
    const blockMap = Generator.buildBlockMap(ctx);
    const lastOfBlock = buildLastOfBlock(ctx);
    const numWindows = Math.floor(ctx.totalSteps / ctx.cellLength);

    for (let w = 0; w < numWindows; w++) {
      const start = w * ctx.cellLength;
      const end = start + ctx.cellLength;
      stats.windows++;

      const section = Generator.sectionAt(ctx, start);
      // Notas que el pase nunca retira (anclas)
      const isProtected = (t, s) => {
        if (section && section.recap && t === section.recapTrack) return true;
        if (s % 4 === 0) return true;
        if (lastOfBlock[t][s]) return true;
        const marker = blockMap[t][s];
        return !!marker && s - marker.startStep < ctx.cellLength;
      };

      // Energía y saliencia por pista en la ventana. La saliencia se mide solo
      // sobre las anclas: si contara las notas retirables, quitar las más
      // débiles subiría la media de la pista, una segunda pasada podría
      // reordenar fondo y primer plano y el pase dejaría de ser idempotente.
      // Una pista sin anclas en la ventana (nada en el pulso) es fondo
      const tracks = [];
      let total = 0;
      for (let t = 0; t < ctx.numTracks; t++) {
        const attacks = [];
        let anchors = 0;
        let velSum = 0;
        let midiSum = 0;
        for (let s = start; s < end; s++) {
          const cell = ctx.grid[t][s];
          if (cell && cell.velocity > Generator.GHOST_VELOCITY) {
            attacks.push(s);
            if (isProtected(t, s)) {
              anchors++;
              velSum += cell.velocity;
              midiSum += cell.midi;
            }
          }
        }
        if (!attacks.length) continue;
        // La melodía percibida suele ser la línea más fuerte y más aguda
        const salience = anchors ? 0.6 * (velSum / anchors) + 0.4 * (midiSum / anchors) / 127 : 0;
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

      // Candidatas a caer por pista de fondo, las más débiles primero
      for (const tr of background) {
        tr.candidates = tr.attacks.filter(s => !isProtected(tr.t, s));
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
