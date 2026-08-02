const Generator = (() => {
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };

  const CELL_LENGTHS = [16, 32, 64, 128, 256];

  // Cada N unidades de tiempo (semicorcheas = pasos del grid) la pieza da un
  // paso en el ciclo de quintas; potencias de 2: valores bajos modulan a
  // menudo, altos casi nunca. Independiente del tamaño de célula y de las
  // repeticiones.
  const FIFTH_STEPS = [4, 8, 16, 32];

  const FORMS = [
    'A-B-A',
    'A-B-C-B-D-D-D-A',
    'A-A-B-B',
    'A-B-C-D',
    'A-B-A-C-A',
    'A-B-C-A-B',
    'A-A-B-B-C-C-A',
    'A-B-C-D-C-B-A'
  ];

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Sustain: fracción del hueco hasta la siguiente nota que la nota sostiene
  // (1 = legato pleno). Continuo en [0.25, 1]
  function clampSustain(v) {
    return Math.max(0.25, Math.min(1, v));
  }

  // --- Algoritmos de contorno melódico ---
  // Cada uno devuelve una curva continua (floats) de largo n; luego se normaliza
  // al ámbito de grados de la escala. Se elige uno al azar por pieza.

  const CONTOURS = {
    // Paseo aleatorio: grados conjuntos con saltos ocasionales, rebota en los bordes
    paseo(n) {
      const out = [];
      let v = (Math.random() - 0.5) * 6;
      for (let i = 0; i < n; i++) {
        out.push(v);
        const step = Math.random() < 0.08
          ? (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3)
          : (Math.random() - 0.5) * 2.4;
        v += step;
        if (v > 8) v = 16 - v;
        if (v < -8) v = -16 - v;
      }
      return out;
    },

    // Arco o valle: sube hasta un clímax desplazado y desciende (o al revés)
    arco(n) {
      const dir = Math.random() < 0.6 ? 1 : -1;
      const peakPos = 0.3 + Math.random() * 0.4;
      const curve = 0.6 + Math.random() * 0.8;
      return Array.from({ length: n }, (_, i) => {
        const t = i / Math.max(1, n - 1);
        const shape = t < peakPos ? t / peakPos : (1 - t) / (1 - peakPos);
        return dir * Math.pow(shape, curve) * 7 + (Math.random() - 0.5) * 1.5;
      });
    },

    // Onda: superposición de 2-3 senos con periodos y fases al azar
    onda(n) {
      const comps = Array.from({ length: 2 + Math.floor(Math.random() * 2) }, (_, k) => ({
        freq: (k + 1) * (0.5 + Math.random()),
        amp: 5 / (k + 1),
        phase: Math.random() * Math.PI * 2
      }));
      return Array.from({ length: n }, (_, i) => {
        const t = i / n;
        return comps.reduce((s, c) => s + c.amp * Math.sin(c.phase + t * Math.PI * 2 * c.freq), 0);
      });
    },

    // Gesto: salto amplio seguido de recuperación por grados conjuntos en sentido contrario
    gesto(n) {
      const out = [];
      let v = 0;
      let recovery = 0;
      for (let i = 0; i < n; i++) {
        out.push(v);
        if (recovery !== 0) {
          v += recovery * (0.7 + Math.random() * 0.8);
          if (Math.random() < 0.25) recovery = 0;
        } else if (Math.random() < 0.12) {
          const dir = Math.random() < 0.5 ? 1 : -1;
          v += dir * (4 + Math.random() * 4);
          recovery = -dir;
        } else {
          v += (Math.random() - 0.5) * 1.2;
        }
      }
      return out;
    },

    // Gravedad: paseo con atracción hacia un centro tonal que deriva lentamente
    gravedad(n) {
      let center = (Math.random() - 0.5) * 4;
      const drift = (Math.random() - 0.5) * (8 / n);
      const pull = 0.1 + Math.random() * 0.2;
      let v = center;
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(v);
        center += drift;
        v += (center - v) * pull + (Math.random() - 0.5) * 3;
      }
      return out;
    },

    // Fractal: desplazamiento de punto medio, perfil autosimilar tipo cordillera
    fractal(n) {
      const out = new Array(n + 1);
      out[0] = (Math.random() - 0.5) * 8;
      out[n] = (Math.random() - 0.5) * 8;
      const rough = 0.55 + Math.random() * 0.15;
      (function subdivide(lo, hi, disp) {
        if (hi - lo < 2) return;
        const mid = (lo + hi) >> 1;
        out[mid] = (out[lo] + out[hi]) / 2 + (Math.random() - 0.5) * 2 * disp;
        subdivide(lo, mid, disp * rough);
        subdivide(mid, hi, disp * rough);
      })(0, n, 5);
      return out.slice(0, n);
    },

    // Terrazas: mesetas sostenidas que cambian de nivel a intervalos irregulares
    terrazas(n) {
      const out = [];
      let level = Math.round((Math.random() - 0.5) * 8);
      let hold = 0;
      for (let i = 0; i < n; i++) {
        if (hold <= 0) {
          hold = 2 + Math.floor(Math.random() * Math.max(2, n / 8));
          level += pickRandom([-4, -3, -2, -1, 1, 2, 3, 4]);
        }
        out.push(level + (Math.random() - 0.5) * 0.6);
        hold--;
      }
      return out;
    },

    // Espiral: oscilación cuya amplitud se abre o se cierra a lo largo de la célula
    espiral(n) {
      const grow = Math.random() < 0.5;
      const cycles = 2 + Math.random() * 3;
      const phase = Math.random() * Math.PI * 2;
      return Array.from({ length: n }, (_, i) => {
        const t = i / n;
        const amp = 1 + 6 * (grow ? t : 1 - t);
        return amp * Math.sin(phase + t * Math.PI * 2 * cycles) + (Math.random() - 0.5);
      });
    },

    // Organismo: célula semilla que muta en cadena — cada frase transforma la
    // anterior (transportar, espejo, retro, estirar, comprimir, insistir) con
    // sorteo sesgado por una tensión que deriva; la semilla recapitula a veces
    organismo(n) {
      const seedLen = pickRandom([4, 6, 8, 12, 16].filter(l => l <= Math.max(4, n / 2)));
      const seed = [];
      let v = (Math.random() - 0.5) * 4;
      const jumpAt = 1 + Math.floor(Math.random() * Math.max(1, seedLen - 2));
      for (let i = 0; i < seedLen; i++) {
        seed.push(v);
        v += i === jumpAt
          ? (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3)
          : (Math.random() - 0.5) * 1.6;
      }

      const center = p => p.reduce((s, x) => s + x, 0) / p.length;
      const MUTATIONS = [
        { ok: () => true,          w: t => 1 + 2 * t,           op: p => p.map(x => x + 1 + Math.random() * 2) },
        { ok: () => true,          w: t => 1 + 2 * (1 - t),     op: p => p.map(x => x - 1 - Math.random() * 2) },
        { ok: () => true,          w: () => 0.9,                op: p => { const c = center(p); return p.map(x => 2 * c - x); } },
        { ok: () => true,          w: () => 0.6,                op: p => p.slice().reverse() },
        { ok: p => p.length <= 16, w: t => 0.3 + 1.4 * (1 - t), op: p => p.flatMap(x => [x, x]) },
        { ok: p => p.length >= 8,  w: t => 0.3 + 1.4 * t,       op: p => p.filter((_, i) => i % 2 === 0) },
        { ok: () => true,          w: () => 0.8,                op: p => p.map(x => x + (Math.random() - 0.5) * 0.8) }
      ];
      const mutate = (p, t) => {
        const pool = MUTATIONS.filter(m => m.ok(p));
        let r = Math.random() * pool.reduce((s, m) => s + m.w(t), 0);
        for (const m of pool) { r -= m.w(t); if (r <= 0) return m.op(p); }
        return pool[pool.length - 1].op(p);
      };

      let phrase = seed.slice();
      let tension = Math.random() * 0.6;
      let drift = Math.random() < 0.5 ? 1 : -1;
      const out = [];
      while (out.length < n) {
        out.push(...phrase);
        // la tensión deriva y rebota en los extremos: escalada y reposo alternan
        tension += drift * (0.08 + Math.random() * 0.15);
        if (tension >= 1) { tension = 1; drift = -1; }
        if (tension <= 0) { tension = 0; drift = 1; }
        if (Math.random() < 0.15) {
          // recapitulación: la semilla vuelve, a medio camino del registro actual
          const off = (center(phrase) - center(seed)) / 2;
          phrase = seed.map(x => x + off);
        } else {
          phrase = mutate(phrase, tension);
        }
        // rebote del registro en los bordes, como el paseo
        const c = center(phrase);
        if (c > 8) phrase = phrase.map(x => x - 2 * (c - 8));
        if (c < -8) phrase = phrase.map(x => x - 2 * (c + 8));
      }
      return out.slice(0, n);
    },

    // Diálogo: dos personajes se turnan la línea — el grave, calmo y de frases
    // largas; el agudo, inquieto y de réplicas breves. Cada réplica imita (o
    // espeja) lo último que dijo el otro llevado a su registro, y los registros
    // se acercan o se alejan según deriva el acuerdo
    diálogo(n) {
      const voices = [
        { center: -3.5 - Math.random() * 2, step: 0.9, len: 6 + Math.floor(Math.random() * 5) },
        { center: 3.5 + Math.random() * 2, step: 1.6, len: 3 + Math.floor(Math.random() * 3) }
      ];
      // remuestrea la frase al largo característico de quien responde
      const resample = (p, len) =>
        Array.from({ length: len }, (_, i) => p[Math.round((i * (p.length - 1)) / Math.max(1, len - 1))]);
      const mean = p => p.reduce((s, x) => s + x, 0) / p.length;

      let speaker = Math.random() < 0.5 ? 0 : 1;
      let last = null;
      let accord = (Math.random() - 0.5) * 2; // >0 acerca los registros, <0 los separa
      const out = [];
      while (out.length < n) {
        const v = voices[speaker];
        const len = Math.random() < 0.15 ? 2 : v.len; // interrupción ocasional
        let phrase;
        if (last && Math.random() < 0.65) {
          // réplica: imita (o espeja) la frase del otro en su propio registro
          const c = mean(last);
          const sign = Math.random() < 0.45 ? -1 : 1;
          const zoom = 0.6 + Math.random() * 0.7;
          phrase = resample(last, len).map(x => v.center + sign * (x - c) * zoom + (Math.random() - 0.5) * 0.5);
        } else {
          // afirmación propia: paseo corto con querencia a su registro
          phrase = [];
          let x = v.center + (Math.random() - 0.5) * 2;
          for (let i = 0; i < len; i++) {
            phrase.push(x);
            x += (Math.random() - 0.5) * 2 * v.step + (v.center - x) * 0.15;
          }
        }
        out.push(...phrase);
        last = phrase;
        if (Math.random() < 0.75) speaker = 1 - speaker; // a veces insiste el mismo
        // el acuerdo deriva y acerca o separa los registros, sin llegar a cruzarlos
        accord = Math.max(-1, Math.min(1, accord + (Math.random() - 0.5) * 0.5));
        const gap = voices[1].center - voices[0].center;
        const move = accord * 0.25;
        if (gap - 2 * move > 2 && gap - 2 * move < 13) {
          voices[0].center += move;
          voices[1].center -= move;
        }
      }
      return out.slice(0, n);
    },

    // Mareas: tres paseos suavizados a escalas de tiempo distintas — corriente
    // de fondo, oleaje medio y espuma rápida — sumados; la capa lenta modula la
    // energía de las rápidas: con marea alta crecen el oleaje y la espuma
    mareas(n) {
      const walk = () => {
        const a = [];
        let v = 0;
        for (let i = 0; i < n; i++) { a.push(v); v += Math.random() - 0.5; }
        return a;
      };
      const smooth = (a, win) => {
        if (win <= 1) return a;
        return a.map((_, i) => {
          let s = 0, c = 0;
          for (let j = Math.max(0, i - win); j <= Math.min(a.length - 1, i + win); j++) { s += a[j]; c++; }
          return s / c;
        });
      };
      const norm = (a, amp) => {
        const lo = Math.min(...a), hi = Math.max(...a);
        const span = (hi - lo) || 1;
        return a.map(x => ((x - lo) / span * 2 - 1) * amp);
      };

      const ampC = 4 + Math.random() * 2;
      const current = norm(smooth(walk(), Math.max(2, n >> 3)), ampC);
      const swell = norm(smooth(walk(), Math.max(1, n >> 5)), 2 + Math.random() * 1.5);
      const foam = norm(walk(), 0.7 + Math.random() * 0.6);
      const rising = Math.random() < 0.5 ? 1 : -1; // ¿energiza la pleamar o la bajamar?
      return current.map((c, i) => {
        const tide = 0.35 + 0.65 * (0.5 + rising * c / (2 * ampC));
        return c + swell[i] * tide + foam[i] * tide * tide;
      });
    },

    // Bandada: enjambre de boids en una dimensión — cohesión, separación y
    // alineación, con sustos que viran a todos de golpe como a los estorninos.
    // La línea es un pájaro cualquiera arrastrado por el centro de masa
    bandada(n) {
      const K = 5 + Math.floor(Math.random() * 4);
      const birds = Array.from({ length: K }, () => ({
        p: (Math.random() - 0.5) * 6,
        v: (Math.random() - 0.5) * 1.2
      }));
      const lead = birds[0];
      const out = [];
      for (let i = 0; i < n; i++) {
        out.push(lead.p);
        const center = birds.reduce((s, b) => s + b.p, 0) / K;
        const avgV = birds.reduce((s, b) => s + b.v, 0) / K;
        // susto: viraje colectivo súbito, todos reciben el mismo empujón
        const spook = Math.random() < 0.06 ? (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 1.5) : 0;
        for (const b of birds) {
          let a = (center - b.p) * 0.08        // cohesión
            + (avgV - b.v) * 0.3               // alineación
            - center * 0.02                    // querencia de la bandada al ámbito
            + (Math.random() - 0.5) * 0.3      // aleteo propio
            + spook;
          for (const o of birds) {
            // separación: apártate de quien vuele demasiado cerca
            if (o !== b && Math.abs(o.p - b.p) < 0.8) a += Math.sign(b.p - o.p) * 0.15;
          }
          if (Math.abs(b.p) > 9) a -= b.p * 0.05;
          b.v = Math.max(-2.2, Math.min(2.2, b.v + a));
          b.p += b.v;
        }
      }
      return out;
    },

    // Erosión: una silueta geométrica perfecta (rampa, pirámide, acantilado,
    // meseta) se desgasta — el material de las pendientes bruscas se derrumba
    // y gotas de lluvia excavan y sedimentan ladera abajo; queda la ruina
    // orgánica de la forma original
    erosión(n) {
      const kind = Math.floor(Math.random() * 4);
      const dir = Math.random() < 0.5 ? 1 : -1;
      const cut = n * (0.25 + Math.random() * 0.5);
      const lo = n * (0.15 + Math.random() * 0.2);
      const hi = n * (0.6 + Math.random() * 0.25);
      const h = [];
      for (let i = 0; i < n; i++) {
        let v;
        if (kind === 0) v = dir * ((i / Math.max(1, n - 1)) * 10 - 5);                  // rampa
        else if (kind === 1) v = dir * (10 * (1 - Math.abs(i - n / 2) / (n / 2)) - 5);  // pirámide
        else if (kind === 2) v = i < cut ? dir * 4.5 : -dir * 4.5;                      // acantilado
        else v = i > lo && i < hi ? dir * 4.5 : -dir * 2.5;                             // meseta
        h.push(v);
      }

      const passes = 1 + Math.floor(Math.random() * 4); // de desgaste leve a ruina profunda
      const talus = 1.2;
      for (let p = 0; p < passes; p++) {
        // derrumbe: las pendientes que superan el talud sueltan material al lado bajo
        for (let i = 0; i < n - 1; i++) {
          const d = h[i] - h[i + 1];
          if (Math.abs(d) > talus) {
            const move = (Math.abs(d) - talus) * 0.25 * Math.sign(d);
            h[i] -= move;
            h[i + 1] += move;
          }
        }
        // lluvia: cada gota excava donde cae, rueda cuesta abajo y sedimenta
        for (let g = Math.max(1, n >> 4); g > 0; g--) {
          let i = Math.floor(Math.random() * n);
          const sediment = 0.6 + Math.random() * 0.8;
          h[i] -= sediment;
          let steps = 2 + Math.floor(Math.random() * 5);
          while (steps-- > 0) {
            const nb = [];
            if (i > 0 && h[i - 1] < h[i]) nb.push(i - 1);
            if (i < n - 1 && h[i + 1] < h[i]) nb.push(i + 1);
            if (!nb.length) break;
            i = nb[Math.floor(Math.random() * nb.length)];
          }
          h[i] += sediment;
        }
      }
      return h;
    }
  };

  const CONTOUR_NAMES = Object.keys(CONTOURS);

  // Lista de contornos permitidos a partir de la elección del usuario: acepta
  // un nombre, una lista de nombres o nada; los inválidos se descartan y sin
  // ninguno válido se permite cualquiera
  function resolveContourPool(choice) {
    const list = Array.isArray(choice) ? choice : (choice ? [choice] : []);
    const valid = list.filter(n => CONTOURS[n]);
    return valid.length ? valid : CONTOUR_NAMES;
  }

  // Lleva la curva cruda a grados enteros dentro del ámbito de la pieza:
  // ámbito de 9-14 grados centrado cerca de la tónica, recortado a [-7, 7]
  function normalizeContour(raw) {
    let min = Infinity;
    let max = -Infinity;
    for (const v of raw) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const targetSpan = 9 + Math.random() * 5;
    const center = (Math.random() - 0.5) * 3;
    return raw.map(v => {
      const d = Math.round(center + ((v - min) / span - 0.5) * targetSpan);
      return Math.max(-7, Math.min(7, d));
    });
  }

  // Cada paso: { note: on/off, degree: grado de escala (entero, octava por división),
  //              velocity: 0..1, sustain: fracción de duración }.
  // El grado se convierte a MIDI recién en degreeToMidi().
  // Las alturas siguen un contorno orgánico (al azar dentro de contourChoice,
  // ver resolveContourPool); la densidad y la dinámica respiran con una onda
  // lenta de fraseo.
  function generateMotherCell(length, contourChoice) {
    const actualLength = length || pickRandom(CELL_LENGTHS);
    const name = pickRandom(resolveContourPool(contourChoice));
    const degrees = normalizeContour(CONTOURS[name](actualLength));

    const breathCycles = pickRandom([1, 2, 3]);
    const breathPhase = Math.random() * Math.PI * 2;
    // La articulación también respira: una onda lenta propia (desfasada de la
    // de fraseo) alterna tramos cantados y tramos picados, en vez de sortear
    // el sustain nota a nota — así el legato dibuja frases y no ruido
    const legatoCycles = pickRandom([1, 2, 3]);
    const legatoPhase = Math.random() * Math.PI * 2;
    const legatoBase = 0.2 + Math.random() * 0.3;
    const cell = [];
    for (let i = 0; i < actualLength; i++) {
      const breath = 0.5 + 0.5 * Math.sin(breathPhase + (i / actualLength) * Math.PI * 2 * breathCycles);
      const legato = 0.5 + 0.5 * Math.sin(legatoPhase + (i / actualLength) * Math.PI * 2 * legatoCycles);
      const velocity = 0.45 + 0.25 * breath + 0.1 * (degrees[i] / 7) + (Math.random() - 0.5) * 0.2;
      cell.push({
        note: Math.random() < 0.2 + 0.4 * breath,
        degree: degrees[i],
        velocity: Math.max(0.15, Math.min(1, velocity)),
        sustain: clampSustain(legatoBase + 0.7 * legato + (Math.random() - 0.5) * 0.2)
      });
    }
    cell.contour = name;
    return cell;
  }

  function generateModifierMask(length, density) {
    const d = density === undefined ? 0.3 : density;
    return Array.from({ length }, () => (Math.random() < d ? 1 : 0));
  }

  // --- Operaciones estructurales sobre células ---

  function invert(cell) {
    return cell.map(s => ({ ...s, degree: -s.degree }));
  }

  function reverse(cell) {
    return cell.slice().reverse();
  }

  function rotate(cell, offset) {
    const n = cell.length;
    const o = ((offset % n) + n) % n;
    return cell.slice(o).concat(cell.slice(0, o));
  }

  function transpose(cell, degrees) {
    return cell.map(s => ({ ...s, degree: s.degree + degrees }));
  }

  // Toma la mitad de la célula y la repite para conservar el largo original
  function subsequence(cell) {
    const half = cell.length / 2;
    const start = Math.random() < 0.5 ? 0 : half;
    const sub = cell.slice(start, start + half).map(s => ({ ...s }));
    return sub.concat(sub.map(s => ({ ...s })));
  }

  // La máscara afecta todas las propiedades del paso donde vale 1
  function applyMask(cell, mask) {
    return cell.map((step, i) => {
      if (!mask[i]) return step;
      const flipNote = Math.random() < 0.3;
      return {
        note: flipNote ? !step.note : step.note,
        degree: step.degree + Math.floor(Math.random() * 5) - 2,
        velocity: Math.max(0.1, Math.min(1, step.velocity + (Math.random() - 0.5) * 0.3)),
        // empuja el sustain sin resortearlo, para no romper la onda de legato
        sustain: Math.random() < 0.5 ? clampSustain(step.sustain + (Math.random() - 0.5) * 0.5) : step.sustain
      };
    });
  }

  // Redibuja las alturas de la célula con otro algoritmo de contorno (distinto
  // al de la madre); conserva ritmo, dinámica y sustain, así que la variación
  // sigue emparentada con la célula original
  function recontour(cell, avoidName, pool) {
    const candidates = (pool || CONTOUR_NAMES).filter(n => n !== avoidName);
    if (!candidates.length) return cell;
    const name = pickRandom(candidates);
    const degrees = normalizeContour(CONTOURS[name](cell.length));
    const out = cell.map((s, i) => ({ ...s, degree: degrees[i] }));
    out.contour = name;
    return out;
  }

  // contourChoice: contornos permitidos (ver resolveContourPool); las
  // variaciones solo se recontornean dentro de esa lista, así que con un único
  // contorno elegido nunca cambian de algoritmo
  function generateVariation(motherCell, contourChoice) {
    const ops = [
      c => invert(c),
      c => reverse(c),
      c => rotate(c, Math.floor(Math.random() * c.length)),
      c => transpose(c, Math.floor(Math.random() * 7) - 3),
      c => subsequence(c)
    ];
    let cell = motherCell;
    const opCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < opCount; i++) {
      cell = pickRandom(ops)(cell);
    }
    if (Math.random() < 0.4) cell = recontour(cell, motherCell.contour, resolveContourPool(contourChoice));
    const contourName = cell.contour || motherCell.contour;
    cell = applyMask(cell, generateModifierMask(cell.length));
    cell.contour = contourName;
    return cell;
  }

  // motifs[0] es siempre la célula madre, seguida de 2 a 4 variaciones
  function generateMotifs(motherCell, variationCount, contourChoice) {
    const variations = variationCount || (2 + Math.floor(Math.random() * 3));
    const motifs = [motherCell];
    for (let m = 0; m < variations; m++) {
      motifs.push(generateVariation(motherCell, contourChoice));
    }
    return motifs;
  }

  function generateForm(formChoice) {
    if (formChoice && formChoice !== 'random' && FORMS.includes(formChoice)) {
      return formChoice;
    }
    return pickRandom(FORMS);
  }

  function parseForm(formStr) {
    return formStr.split('-');
  }

  function randomFifthSteps() {
    return pickRandom(FIFTH_STEPS);
  }

  // key en semitonos (0-11); resuelve grado de escala -> MIDI en esa tonalidad,
  // sin considerar modulación (para eso está degreeToMidiInKey)
  function degreeToMidi(degree, scaleName, key, baseOctave) {
    const intervals = SCALES[scaleName] || SCALES.major;
    const n = intervals.length;
    const octave = Math.floor(degree / n);
    const idx = ((degree % n) + n) % n;
    const base = 12 * ((baseOctave === undefined ? 4 : baseOctave) + 1);
    return base + key + intervals[idx] + octave * 12;
  }

  // keyOffsets del lado bemol del viaje de quintas (w en [-4, -1]); como el
  // viaje está acotado a ±4, el keyOffset identifica el signo sin ambigüedad
  const FLAT_KEY_OFFSETS = new Set([3, 5, 8, 10]);

  // Modulación suave: la nota se calcula siempre en la tonalidad base y, si no
  // pertenece a la escala transportada keyOffset semitonos, se ajusta al
  // semitono más cercano siguiendo la armadura: hacia el lado de los sostenidos
  // las alteraciones suben (Fa -> Fa# de Do a Sol) y hacia el de los bemoles
  // bajan (Si -> Sib de Do a Fa) — así dos grados vecinos nunca colapsan en la
  // misma altura. Conserva el registro: modular no transpone la melodía, solo
  // altera las notas ajenas a la tonalidad nueva. La cromática nunca se altera
  function degreeToMidiInKey(degree, scaleName, key, keyOffset, baseOctave) {
    const midi = degreeToMidi(degree, scaleName, key, baseOctave);
    if (!keyOffset) return midi;
    const intervals = SCALES[scaleName] || SCALES.major;
    const pcs = new Set(intervals.map(i => (key + keyOffset + i) % 12));
    const pc = m => ((m % 12) + 12) % 12;
    if (pcs.has(pc(midi))) return midi;
    const dir = FLAT_KEY_OFFSETS.has(keyOffset) ? -1 : 1;
    for (let d = 1; d <= 6; d++) {
      if (pcs.has(pc(midi + dir * d))) return midi + dir * d;
      if (pcs.has(pc(midi - dir * d))) return midi - dir * d;
    }
    return midi;
  }

  return {
    SCALES,
    CELL_LENGTHS,
    FORMS,
    CONTOUR_NAMES,
    pickRandom,
    generateMotherCell,
    generateModifierMask,
    generateVariation,
    generateMotifs,
    generateForm,
    parseForm,
    randomFifthSteps,
    degreeToMidi,
    degreeToMidiInKey
  };
})();
