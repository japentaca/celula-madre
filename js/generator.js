const Generator = (() => {
  const SCALES = {
    major: [0, 2, 4, 5, 7, 9, 11],
    minor: [0, 2, 3, 5, 7, 8, 10],
    pentatonic: [0, 2, 4, 7, 9],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
  };

  const CELL_LENGTHS = [16, 32, 64];

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
    },

    // Infinito: la serie infinita de Per Nørgård — a(2k) = −a(k), a(2k+1) =
    // a(k)+1 —, autosimilar por construcción binaria: cada índice par invierte
    // y cada impar sube un grado, así que la línea camina por grados conjuntos
    // y de pronto salta en espejo de sí misma; se sortea la rama (índice de
    // arranque 2^j·m), el espejo y una lectura cada tres (otra textura)
    infinito(n) {
      const start = pickRandom([0, 0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]);
      const stride = pickRandom([1, 1, 1, 3]);
      const mirror = Math.random() < 0.5 ? 1 : -1;
      const last = start + (n - 1) * stride;
      const series = new Array(last + 1);
      series[0] = 0;
      for (let i = 1; i <= last; i++) {
        series[i] = i % 2 ? series[(i - 1) / 2] + 1 : -series[i / 2];
      }
      const out = [];
      for (let i = 0; i < n; i++) out.push(mirror * series[start + i * stride]);
      return out;
    },

    // Arpegio: acorde quebrado — el primer contorno que piensa en armonía y no
    // en línea. Sortea una pequeña progresión de fundamentales (I–IV–V–I,
    // I–vi–IV–V, descensos por terceras…), cada acorde dura un tramo múltiplo
    // de 4 pasos, y recorre sus notas (fundamental, 3ª, 5ª, a veces 7ª,
    // doblajes de octava) con un patrón fijo por célula — ascendente,
    // descendente, Alberti, quebrado, ida y vuelta — con cambios de inversión
    // ocasionales; cada acorde entra por la inversión que menos salta desde la
    // última nota (conducción de voces). Devuelve grados enteros con un ámbito
    // de ~9-12, cerca del que impone la normalización, para que las terceras
    // sigan siendo terceras al redondear
    arpegio(n) {
      const prog = pickRandom([
        [0, 3, 4, 0], [0, 5, 3, 4], [0, -2, -3, -1], [0, 2, 4, 0],
        [0, 0, 3, 4], [0, 3, 0, 4], [0, -3, 3, 0], [0, 5, 1, 4]
      ]).slice();
      if (Math.random() < 0.5) prog[prog.length - 1] = 0;
      let chords = n <= 16 && Math.random() < 0.5 ? prog.slice(0, 2) : prog;
      if (n >= 64 && Math.random() < 0.5) chords = chords.concat(chords);
      const k = chords.length;
      const dur = new Array(k).fill(n / k);
      if (n / k >= 8 && Math.random() < 0.5) {
        const i = Math.floor(Math.random() * (k - 1));
        const shift = Math.random() < 0.5 ? 4 : -4;
        dur[i] += shift;
        dur[i + 1] -= shift;
      }

      const seventh = Math.random() < 0.3;
      const L = Math.random() < 0.6 ? 4 : 3;                 // notas del dibujo: tríada o hasta la octava/7ª
      const pattern = pickRandom(['up', 'down', 'alberti', 'broken', 'updown']);
      let figure;
      if (pattern === 'up') figure = Array.from({ length: L }, (_, j) => j);
      else if (pattern === 'down') figure = Array.from({ length: L }, (_, j) => L - 1 - j);
      else if (pattern === 'alberti') figure = L === 3 ? [0, 2, 1, 2] : [0, 3, 1, 3, 0, 3, 2, 3];
      else if (pattern === 'updown') figure = Array.from({ length: 2 * L - 2 }, (_, j) => j < L ? j : 2 * L - 2 - j);
      else {                                                   // quebrado: sube dos, baja una, rebota en los bordes
        figure = [];
        let p = 0;
        let d = 1;
        for (let j = 0; j < 4 * L; j++) {
          figure.push(p);
          const step = j % 3 === 2 ? -d : d;
          if (p + step < 0 || p + step > L - 1) d = -d;
          p += j % 3 === 2 ? -d : d;
        }
      }
      const period = figure.length;
      const LO = -5;
      const HI = 7;
      const chordTones = [0, 2, 4].concat(seventh ? [6] : []);

      const out = [];
      let last = null;
      for (let c = 0; c < k; c++) {
        const tones = [];
        for (let oct = -3; oct <= 3; oct++) {
          for (const t of chordTones) {
            const v = chords[c] + t + 7 * oct;
            if (v >= LO && v <= HI) tones.push(v);
          }
        }
        tones.sort((a, b) => a - b);
        const maxS = tones.length - L;
        let s = Math.floor(Math.random() * (maxS + 1));
        if (last !== null && Math.random() < 0.8) {           // conducción de voces: la inversión más cercana
          let best = Infinity;
          for (let i = 0; i <= maxS; i++) {
            const gap = Math.abs(tones[i + figure[0]] - last);
            if (gap < best) { best = gap; s = i; }
          }
        }
        for (let j = 0; j < dur[c]; j++) {
          if (j && j % period === 0 && Math.random() < 0.2) {  // cambio de inversión ocasional
            s = Math.max(0, Math.min(maxS, s + (Math.random() < 0.5 ? -1 : 1)));
          }
          last = tones[s + figure[j % period]];
          out.push(last);
        }
      }

      // Si el dibujo se quedó en un registro estrecho, un tramo entero se
      // desplaza una octava — el que deje el ámbito más cerca de 11, el que
      // impone la normalización, para que esta no estire ni encoja las terceras
      if (Math.max(...out) - Math.min(...out) < 9) {
        let best = { err: Infinity, start: 0, len: 0, shift: 0 };
        for (let c = 0, pos = 0; c < k; pos += dur[c], c++) {
          for (const shift of [-7, 7]) {
            const trial = out.map((v, i) => i >= pos && i < pos + dur[c] ? v + shift : v);
            const err = Math.abs(Math.max(...trial) - Math.min(...trial) - 11);
            if (err < best.err) best = { err, start: pos, len: dur[c], shift };
          }
        }
        for (let i = best.start; i < best.start + best.len; i++) out[i] += best.shift;
      }
      return out;
    },

    // Escalera: la secuencia barroca (progresión melódica) — un motivo corto de
    // 3-5 notas, casi todo grados conjuntos, se transporta exacto por un
    // intervalo fijo (segunda o tercera, más a menudo hacia abajo) tres o
    // cuatro peldaños, a veces perdiendo su última nota en cada peldaño
    // (liquidación); al acabar rompe con un breve gesto de cierre y un salto de
    // recolocación — al registro de partida, y la escalera se repite, o al
    // opuesto, y se invierte — y arranca otra, acaso con otro motivo. Sin
    // ruido: la gracia es la exactitud del transporte. El registro se acota a
    // ~11 grados, el ámbito que impone la normalización, para que los peldaños
    // no se deformen al redondear
    escalera(n) {
      const LO = -5.5;
      const HI = 5.5;
      const MOTIFS = [
        [0, 1, 2], [0, 2, 1], [0, -1, -2], [0, -2, -1], [0, -1, 1], [0, 1, -1],
        [0, -1, -2, 0], [0, 1, 0, -1], [0, 2, 1, 3], [0, -2, -1, -3], [0, 1, 2, 0],
        [0, 3, 2, 1], [0, 2, 1, 0, -1], [0, -1, 0, 1, 2], [0, 1, 2, 3, 1]
      ];
      const randomMotif = () => {
        let m;
        do {
          m = [0];
          const len = 3 + Math.floor(Math.random() * 3);
          for (let j = 1; j < len; j++) {
            m.push(m[j - 1] + (Math.random() < 0.1 ? pickRandom([-3, 3]) : pickRandom([-2, -1, 1, 2])));
          }
        } while (Math.max(...m) - Math.min(...m) > 4);
        return m;
      };
      const pickMotif = () => Math.random() < 0.7 ? pickRandom(MOTIFS) : randomMotif();
      const pickInterval = () => Math.random() < 0.1
        ? pickRandom([-3, 3])
        : pickRandom([-1, -1, -1, -2, -2, 1, 1, 2]);
      // Nivel de arranque que deja la escalera entera (motivo + transporte
      // acumulado) dentro del registro; null si no cabe
      const range = (motif, iv, steps) => {
        const reach = iv * (steps - 1);
        const lo = LO - Math.min(...motif) - Math.min(0, reach);
        const hi = HI - Math.max(...motif) - Math.max(0, reach);
        return lo <= hi ? [lo, hi] : null;
      };

      const out = [];
      let motif = pickMotif();
      let iv = pickInterval();
      let level = null;
      let last = 0;
      let min = Infinity;
      let max = -Infinity;
      while (out.length < n) {
        let steps = Math.random() < 0.5 ? 3 : 4;
        let r = range(motif, iv, steps);
        if (!r) r = range(motif, iv, steps = 3);
        if (!r) r = range(motif, iv = Math.sign(iv), steps);
        if (level === null) {
          // La primera arranca casi siempre desde el borde del que se aleja
          level = Math.random() < 0.7 ? (iv < 0 ? r[1] : r[0]) : r[0] + Math.random() * (r[1] - r[0]);
        } else if (max - min < 9) {
          // Mientras la curva no ocupe el registro, el salto de recolocación va
          // al borde que falte: una escalera estrecha que luego se estira al
          // normalizar perdería la exactitud de los peldaños
          const reach = iv * (steps - 1);
          const top = HI - Math.max(...motif) - Math.max(0, reach);
          const bottom = LO - Math.min(...motif) - Math.min(0, reach);
          level = HI - max > min - LO ? Math.max(r[0], Math.min(r[1], top)) : Math.max(r[0], Math.min(r[1], bottom));
        } else if (level < r[0] || level > r[1]) {
          // No cabe desde aquí: antes que aplastarla, invierte la dirección; si
          // tampoco, reubica el nivel en el borde más cercano
          const flipped = range(motif, -iv, steps);
          if (flipped && level >= flipped[0] && level <= flipped[1]) iv = -iv;
          else level = Math.max(r[0], Math.min(r[1], level));
        }
        const start = level;
        const liquidate = motif.length >= 4 && Math.random() < 0.3;
        for (let k = 0; k < steps && out.length < n; k++) {
          const rung = liquidate ? motif.slice(0, Math.max(2, motif.length - k)) : motif;
          for (const d of rung) {
            last = level + k * iv + d;
            out.push(last);
            if (last < min) min = last;
            if (last > max) max = last;
            if (out.length >= n) break;
          }
        }
        // Rompimiento: gesto de cierre que prolonga el movimiento un grado y, a
        // veces, rebota; luego salto de recolocación
        if (Math.random() < 0.6) {
          out.push(Math.max(LO, Math.min(HI, last + Math.sign(iv))));
          if (Math.random() < 0.4) out.push(last);
        }
        if (Math.random() < 0.4) motif = pickMotif();
        if (Math.random() < 0.4) {
          level = start + pickRandom([-1, 0, 0, 1]);             // al registro de partida: la escalera se repite
        } else {
          iv = -iv;                                              // al opuesto: la escalera se invierte
          level = last - iv * (steps - 1) * 0.5 + (Math.random() - 0.5) * 2;
        }
        if (Math.random() < 0.3) iv = pickInterval();
      }
      return out.slice(0, n);
    },

    // Autómata: autómata celular elemental (Wolfram) sobre una fila cíclica de
    // bits, una generación por paso, y la altura se lee de la fila — centro de
    // masa, bits vivos, borde izquierdo, ventana central o paseo guiado por el
    // bit del centro. Caos determinista: regla, semilla y lectura fijan la
    // línea entera; solo un suavizado leve la vuelve cantable
    autómata(n) {
      const RULES = [30, 54, 90, 110, 126, 150, 184];
      const MODES = ['mass', 'mass', 'count', 'count', 'edge', 'window', 'walk'];
      const W = pickRandom([16, 24, 32]);
      const half = W >> 1;
      const seed = () => {
        const row = new Array(W).fill(0);
        if (Math.random() < 0.5) {
          row[half] = 1;                                         // semilla única: triángulos y estructuras
        } else {
          const density = 0.15 + Math.random() * 0.15;
          for (let i = 0; i < W; i++) row[i] = Math.random() < density ? 1 : 0;
          if (!row.includes(1)) row[half] = 1;
        }
        return row;
      };
      const run = (rule, mode) => {
        let row = seed();
        const warm = Math.random() < 0.5 ? 0 : Math.floor(Math.random() * half);
        // Peso de la lectura anterior: el conteo y la ventana saltan más y
        // piden más suavizado; las demás lecturas a veces van crudas
        const smooth = mode === 'window' ? 0.6 + Math.random() * 0.2
          : mode === 'count' ? 0.5 + Math.random() * 0.25
          : Math.random() < 0.8 ? 0.35 + Math.random() * 0.3 : 0;
        const out = [];
        let v = null;
        let mass = half;
        let walk = 0;
        for (let g = 0; g < n + warm; g++) {
          let alive = row.reduce((s, b) => s + b, 0);
          if (alive === 0 || alive === W) {                      // la regla murió o se saturó: reinyecta
            row[Math.floor(Math.random() * W)] ^= 1;
            alive = alive === 0 ? 1 : W - 1;
          }
          if (g >= warm) {
            let r;
            if (mode === 'mass') {
              // Centro de masa circular, desenrollado para que no salte en la costura
              let x = 0;
              let y = 0;
              row.forEach((b, i) => {
                if (b) {
                  x += Math.cos(i / W * 2 * Math.PI);
                  y += Math.sin(i / W * 2 * Math.PI);
                }
              });
              if (Math.hypot(x, y) > 0.5) {                      // fila uniforme: sin centro, se queda donde estaba
                let d = Math.atan2(y, x) / (2 * Math.PI) * W - mass;
                d -= W * Math.round(d / W);
                mass += d;
              }
              r = mass;
            } else if (mode === 'count') {
              r = alive;
            } else if (mode === 'edge') {
              r = row.indexOf(1);
            } else if (mode === 'window') {
              // Tres bits centrales leídos en código Gray, que cambia menos entre vecinos
              const b2 = row[half - 1];
              const b1 = row[half] ^ b2;
              const b0 = row[half + 1] ^ row[half];
              r = b2 * 4 + b1 * 2 + b0;
            } else {
              walk += row[half] ? 1 : -1;
              if (walk > 8) walk = 16 - walk;
              if (walk < -8) walk = -16 - walk;
              r = walk;
            }
            v = v === null ? r : v * smooth + r * (1 - smooth);
            out.push(v);
          }
          row = row.map((_, i) =>
            (rule >> ((row[(i + W - 1) % W] << 2) | (row[i] << 1) | row[(i + 1) % W])) & 1);
        }
        return out;
      };
      // Algunas parejas regla+lectura degeneran (el centro de masa de la 90
      // simétrica es constante, la 54 cae en un ostinato de dos o tres valores
      // que la normalización estiraría a saltos): se re-sortea hasta que la
      // curva ocupe al menos seis franjas de su propio ámbito
      let out;
      for (let t = 0; t < 12; t++) {
        out = run(pickRandom(RULES), pickRandom(MODES));
        const min = Math.min(...out);
        const span = Math.max(...out) - min;
        if (span > 0 && new Set(out.map(v => Math.round((v - min) / span * 11))).size >= 6) break;
      }
      return out;
    },

    // Bordón: melodía compuesta — polifonía implícita en una sola línea, como
    // las suites para cello solo o el bajo de una zanfona —: una nota pedal
    // fija vuelve cada 2, 3 o 4 pasos (o irregular, nunca dos seguidas) mientras
    // la otra voz pasea por encima (o por debajo: pedal invertido) con
    // continuidad propia — retoma donde se quedó, grados conjuntos, atraída por
    // un centro que dibuja un arco —, a una tercera como poco del pedal; a veces
    // el pedal cambia una vez a mitad (tónica → dominante) o es doble (tónica y
    // quinta alternadas). El pedal no lleva ruido: debe ser la misma altura
    bordón(n) {
      const inverted = Math.random() < 0.35;                   // pedal agudo: se calcula grave y se refleja
      const double = Math.random() < 0.12;
      const shiftAt = !double && Math.random() < 0.3 ? n / 2 : n;
      const shift = pickRandom([-3, 4]);                        // dominante grave o aguda
      const PATTERNS = [2, 2, 3, 4, 0];                         // 0 = irregular
      let pattern = pickRandom(PATTERNS);
      const phase = Math.random() < 0.5 ? 0 : 1;               // empieza por el pedal o por la voz
      // Centro de la voz: arco con clímax desplazado, o rampa que sube o baja
      const lo = 3 + Math.random() * 2;
      const hi = 8.5 + Math.random() * 2;
      const shape = pickRandom(['arc', 'arc', 'up', 'down']);
      const peak = 0.5 + Math.random() * 0.25;
      const target = i => {
        const t = i / (n - 1);
        const s = shape === 'up' ? t : shape === 'down' ? 1 - t
          : t < peak ? Math.sin(t / peak * Math.PI / 2) : Math.cos((t - peak) / (1 - peak) * Math.PI / 2);
        return lo + (hi - lo) * s;
      };
      const out = [];
      let pedal = 0;
      let voice = target(0) + (double ? 4 : 0);
      let wasPedal = false;
      let fifth = false;
      for (let i = 0; i < n; i++) {
        if (i === shiftAt) pedal = shift;
        if (i === n / 2 && Math.random() < 0.25) pattern = pickRandom(PATTERNS.filter(p => p !== pattern));
        const isPedal = pattern ? (i + phase) % pattern === pattern - 1 : !wasPedal && Math.random() < 0.4;
        wasPedal = isPedal;
        if (isPedal) {
          fifth = double && !fifth;
          out.push(fifth ? 4 : pedal);
          continue;
        }
        // La voz vive sobre el pedal más alto en juego: a una tercera como poco
        // y sin alejarse más de una octava y pico, para que el ámbito crudo se
        // quede cerca del que impone la normalización
        const top = Math.max(pedal, double ? 4 : 0);
        const want = target(i) + top;
        const pull = want - voice;
        let step = pickRandom([-2, -1, -1, -1, 0, 1, 1, 1, 2]);
        if (Math.abs(pull) > 1.5 && Math.random() < 0.6) step = Math.sign(pull) * pickRandom([1, 1, 1, 2]);
        voice = Math.max(top + 2, Math.min(top + 11, voice + step));
        out.push(voice + (Math.random() - 0.5) * 0.3);
      }
      return inverted ? out.map(v => -v) : out;
    },

    // Rebote: una pelota que cae y rebota — parábolas cada vez más cortas y más
    // bajas, lentas en el ápice y rápidas junto al suelo — hasta posarse y
    // rodar: asimétrico y cadencial, la célula aterriza. Lanzada desde lo alto
    // o desde el suelo; a veces invertida (rebota contra un techo y el reposo
    // queda arriba), con el suelo en pendiente o con dos pelotas sumadas. Si se
    // posa con más de un 30% de célula por delante, segundo lanzamiento con
    // menos energía (hasta dos), si no rueda con una deriva leve
    rebote(n) {
      const H = 8;                                              // altura del primer ápice (escala cruda)
      const inverted = Math.random() < 0.35;
      const sloped = Math.random() < 0.12;
      const twoBalls = Math.random() < 0.12;
      // Trayectoria analítica por tramos: cada bote es una parábola de vuelo
      // 2s/g; el primero dura `first` de la célula y culmina en H
      const ball = (first, e, fromTop, delay) => {
        const T = n * first;
        const g = 8 * H / (T * T);
        const v0 = 4 * H / T;
        const out = new Array(n).fill(0);
        let t0 = fromTop ? delay - T / 2 : delay;               // desde lo alto: a mitad de parábola
        let s = v0;
        let throws = 0;
        let rollFrom = -1;
        const rollAmp = H * (0.06 + Math.random() * 0.06);
        const rollPeriod = 4 + Math.random() * 4;
        const drift = (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.3) * H / n;
        for (let i = delay; i < n; i++) {
          while (rollFrom < 0 && i - t0 >= 2 * s / g) {
            t0 += 2 * s / g;
            s *= e * (0.95 + Math.random() * 0.1);              // cada bote pierde algo distinto
            if (s >= 0.1 * v0) continue;
            if (n - t0 > 0.3 * n && throws < 2 && Math.random() < 0.6) {
              throws++;
              t0 += 1 + Math.floor(Math.random() * 3);          // breve reposo antes de relanzar
              s = v0 * (0.45 + Math.random() * 0.3);
            } else {
              rollFrom = t0;
            }
          }
          if (rollFrom >= 0) {
            const r = i - rollFrom;
            out[i] = rollAmp * Math.sin(r / rollPeriod * Math.PI * 2) + drift * r;
            continue;
          }
          const tau = i - t0;
          out[i] = tau < 0 ? 0 : Math.max(0, s * tau - g * tau * tau / 2);
        }
        return out;
      };
      const main = ball(0.25 + Math.random() * 0.2, 0.6 + Math.random() * 0.25, Math.random() < 0.5, 0);
      let out = main;
      if (twoBalls) {
        const delay = Math.floor(n * (0.1 + Math.random() * 0.25));
        const amp = 0.4 + Math.random() * 0.3;
        const other = ball(0.2 + Math.random() * 0.2, 0.6 + Math.random() * 0.25, false, delay);
        out = main.map((v, i) => v + amp * other[i]);
      }
      const slope = sloped ? (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.25) * H / n : 0;
      out = out.map((v, i) => v + slope * i + (Math.random() - 0.5) * 0.35);
      return inverted ? out.map(v => -v) : out;
    },

    // Bifurcación: el mapa logístico x ← r·x·(1−x) con r barriendo la célula
    // por el diagrama de bifurcación — punto fijo, periodo 2, 4, 8 y caos, con
    // la ventana de periodo 3 de paso —: un ostinato de dos notas que se
    // desdobla en cuatro, en ocho y se deshace, o al revés; el único caos
    // determinista con historia del repertorio. Se sortea el sentido (hacia el
    // caos, hacia el orden, o ida y vuelta en células largas) y el tramo de r
    // recorrido; el barrido se demora en las zonas estrechas de los
    // desdoblamientos y de la ventana de periodo 3, y en el caos la altura
    // lleva memoria del paso anterior para que sea continuidad y no ruido; en
    // lo periódico es exacta (repetición literal). Nunca llega a r = 4, donde
    // el mapa puede caer en 0 y quedarse
    bifurcación(n) {
      const [rLo, rHi] = pickRandom([[2.9, 3.99], [3.0, 3.85], [3.2, 3.6], [3.3, 3.99], [3.5, 3.99], [3.45, 3.9]]);
      const mode = n >= 64 && Math.random() < 0.3 ? 'arc' : Math.random() < 0.55 ? 'up' : 'down';
      // Barrido no lineal: densidad de tiempo por tramo de r — poca en el punto
      // fijo, mucha donde el diagrama cambia deprisa —; r(t) es la inversa de
      // su acumulada
      const SLOW = [[2.8, 3.25, 0.5], [3.4, 3.6, 4], [3.82, 3.86, 3]];
      const M = 256;
      const cdf = [0];
      for (let j = 0; j < M; j++) {
        const r = rLo + (j + 0.5) / M * (rHi - rLo);
        cdf.push(cdf[j] + SLOW.reduce((w, [a, b, k]) => r >= a && r <= b ? w * k : w, 1));
      }
      const rOf = t => {
        const target = t * cdf[M];
        let j = 1;
        while (j < M && cdf[j] < target) j++;
        const f = (target - cdf[j - 1]) / (cdf[j] - cdf[j - 1]);
        return rLo + (j - 1 + f) / M * (rHi - rLo);
      };
      const tau = i => {
        const t = i / (n - 1);
        return mode === 'up' ? t : mode === 'down' ? 1 - t : 1 - Math.abs(2 * t - 1);
      };
      // Transitorio descartado: arranca ya sobre el atractor; después r cambia
      // tan despacio que el sistema lo sigue sin transitorios visibles
      let x = 0.2 + Math.random() * 0.6;
      const r0 = rOf(tau(0));
      for (let k = 20 + Math.floor(Math.random() * 31); k > 0; k--) x = r0 * x * (1 - x);
      const drift = Math.random() < 0.5 ? (Math.random() - 0.5) * 0.5 / n : 0;
      // Las dos ramas del periodo 2 distan un tercio del ámbito del mapa: tal
      // cual, el ostinato sale a saltos de séptima que lo dejan todo picado.
      // Se estrecha el vaivén alrededor del punto medio de cada pareja hasta
      // un tercer/cuarta, y el apretón se suelta al entrar en el caos
      const squeeze = 0.4 + Math.random() * 0.2;
      const out = [];
      let v = x;
      let xPrev = x;
      for (let i = 0; i < n; i++) {
        const r = rOf(tau(i));
        x = r * x * (1 - x);
        const chaos = Math.max(0, Math.min(1, (r - 3.57) / 0.3));
        const mid = (x + xPrev) / 2;
        const y = mid + (squeeze + (1 - squeeze) * chaos) * (x - mid);
        xPrev = x;
        const memory = 0.65 * chaos;
        v = memory * v + (1 - memory) * y;
        out.push(v + drift * i);
      }
      return out;
    },

    // Período: la frase clásica, antecedente y consecuente. La pregunta
    // arranca con una cabeza de 3-4 notas, sube hacia su clímax y queda
    // abierta en un grado inestable (5º, 2º, dominante grave…) al que llega
    // por grado conjunto; la respuesta imita la cabeza — literal, en secuencia
    // o invertida; en el período contrastante otra cabeza con el mismo dibujo —,
    // parte igual o más alto (intensificación) y cierra en la tónica por grados
    // desde arriba (2-1-0), desde abajo con sensible tras hundirse bajo la
    // tónica, o con salto de dominante, y la sostiene en sus últimas
    // posiciones: el único contorno que modela la dirección del final de
    // frase. Cada frase va en 8 casillas de L/8 pasos (cabeza mantenida,
    // desarrollo interpolado por grados con ruido leve, cierre exacto), así
    // que toda frontera cae en el pulso. En células de 32+ se encadenan
    // períodos de 8+8, 16+16 o 32+32 — repetidos literalmente o compuestos de
    // nuevo — y oraciones 8+8+16 (pregunta repetida, literal o en secuencia, y
    // respuesta alargada). Cada período visita el registro grave por algún
    // medio (hundimiento, semicadencia o dominante graves, cabeza desde la
    // dominante grave) y al final la tónica se deja en el centro exacto del
    // ámbito crudo, repartiendo el estirón entre ambos lados, para que la
    // normalización la deje junto al 0
    período(n) {
      const weighted = (items) => {
        let total = 0;
        for (const it of items) total += it[1];
        let r = Math.random() * total;
        for (const it of items) {
          r -= it[1];
          if (r <= 0) return it[0];
        }
        return items[items.length - 1][0];
      };
      // Cabeza: 3-4 grados, conjuntos salvo un salto característico opcional
      const makeHead = (len, low) => {
        const head = [low ? -3 : weighted([[0, 3], [2, 2], [4, 1.5], [1, 0.5]])];
        const leapAt = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * (len - 1)) : -1;
        let dir = Math.random() < 0.6 ? 1 : -1;
        for (let j = 1; j < len; j++) {
          const size = j === leapAt ? 2 + Math.floor(Math.random() * 3) : 1;
          let next = head[j - 1] + dir * size;
          if (next > 6 || next < -4) next = head[j - 1] - dir * size;
          head.push(next);
          if (Math.random() < 0.3) dir = -dir;
        }
        return head;
      };
      // Frase de L pasos en 8 casillas de u = L/8: cabeza mantenida, casillas
      // clave fijas (clímax, hundimiento, pre-cadencia), las libres
      // interpoladas con un vaivén de ±1, aproximación y cierre exactos
      // (La casilla mide u pasos; una frase larga a la velocidad de su pregunta,
      // como la respuesta de la oración, tiene más casillas y más desarrollo)
      const phrase = (L, u, head, climaxAt, climax, pre, approach, close) => {
        const S = L / u;
        const hl = head.length;
        const hold = S > 8 ? 2 : 1;                                   // casillas de reposo final
        const s = new Array(S).fill(null);
        head.forEach((v, j) => { s[j] = v; });
        s[climaxAt] = climax;
        if (pre !== null) s[S - 2 - hold] = pre;
        s[S - 1 - hold] = approach;
        for (let k = S - hold; k < S; k++) s[k] = close;
        for (let k = hl; k < S - 1 - hold; k++) {
          if (s[k] !== null) continue;
          let b = k + 1;
          while (s[b] === null) b++;
          s[k] = s[k - 1] + (s[b] - s[k - 1]) / (b - k + 1) + (Math.random() < 0.4 ? pickRandom([-1, 1]) : 0);
        }
        const out = [];
        for (let k = 0; k < S; k++) {
          for (let j = 0; j < u; j++) {
            if (k < hl || k === S - 1 - hold) out.push(s[k]);
            else if (k >= S - hold) out.push(u > 3 && j === 0 ? s[k - 1] : s[k]);   // reposo de 1-3 posiciones
            else out.push(s[k] + (s[k + 1] - s[k]) * j / u + (Math.random() - 0.5) * 0.3);
          }
        }
        return out;
      };
      const question = (L, low) => {
        const head = makeHead(3 + Math.floor(Math.random() * 2), low === 'head');
        // Clímax contenido si el registro grave no viene de un hundimiento, para
        // no desequilibrar el ámbito alrededor de la tónica
        const climax = Math.max(Math.max(...head) + 1, 3 + Math.floor(Math.random() * (low === 'dip' ? 3 : 2)));
        const open = low === 'open' ? -3 : weighted([[4, 3], [1, 3], [-3, 1.5], [2, 1], [6, 0.5]]);
        const approach = climax > open ? open + 1 : open - 1;
        let at = head.length === 3 && Math.random() < 0.5 ? 3 : 4;
        if (Math.abs(climax - approach) <= 2 && Math.random() < 0.5) at = 5;
        const u = L / 8;
        return { curve: phrase(L, u, head, at, climax, null, approach, open), u, head, climax, open };
      };
      const answer = (L, q, parallel, low) => {
        let head;
        if (!parallel) head = makeHead(q.head.length);
        else {
          const mode = weighted([['literal', 7.5], ['sequence', 1.75], ['inverted', 0.75]]);
          if (mode === 'literal') head = q.head.slice();
          else if (mode === 'sequence') head = q.head.map(v => v + pickRandom([-2, -1, 1, 2]));
          else head = q.head.map(v => 2 * q.head[0] - v);
        }
        const intensify = Math.random() < 0.5;
        const climax = Math.max(Math.max(...head), intensify
          ? q.climax + 1 + (low === 'dip' ? Math.floor(Math.random() * 2) : 0)
          : q.climax - Math.floor(Math.random() * 2));
        const type = low === 'dip' ? 'below' : low === 'dominant' ? 'dominant-low'
          : weighted([['above', 4], ['below', 3], ['dominant', 1.5], ['dominant-low', 1.5]]);
        let approach;
        let pre;
        if (type === 'above') { approach = 1; pre = 2; }
        else if (type === 'below') { approach = -1; pre = -Math.round(q.climax * (0.6 + Math.random() * 0.4)); }
        else if (type === 'dominant') { approach = 4; pre = 5; }
        else { approach = -3; pre = -2; }
        return phrase(L, q.u, head, head.length, climax, pre, approach, 0);
      };
      const period = (size) => {
        const low = weighted([['dip', 4], ['open', 2.5], ['dominant', 2], ['head', 1.5]]);
        const q = question(size / 2, low);
        return q.curve.concat(answer(size / 2, q, Math.random() < 0.8, low));
      };
      // Oración: pregunta, pregunta repetida (literal o en secuencia) y
      // respuesta del doble de largo
      const sentence = (size) => {
        const low = weighted([['dip', 4], ['open', 2.5], ['dominant', 2], ['head', 1.5]]);
        const q = question(size / 4, low);
        let again = q.curve;
        if (Math.random() < 0.5) {
          const t = q.open + 2 > 6 ? -1 : pickRandom([1, 2]);
          again = q.curve.map(v => v + t);
        }
        return q.curve.concat(again, answer(size / 2, q, Math.random() < 0.8, low));
      };

      const N = Math.max(16, n);
      const made = {};
      let out = [];
      for (let rem = N; rem > 0;) {
        const opts = [[[16, 'p'], rem >= 32 ? 1 : 10]];
        if (rem >= 32) opts.push([[32, 'p'], 4.5], [[32, 's'], 3]);
        if (rem >= 64) opts.push([[64, 'p'], 1.5], [[64, 's'], 1]);
        const [size, kind] = weighted(opts);
        const id = size + kind;
        if (!made[id] || Math.random() < 0.5) made[id] = kind === 'p' ? period(size) : sentence(size);
        out = out.concat(made[id]);
        rem -= size;
      }
      let M = 0.5;
      let m = -0.5;
      for (const v of out) {
        if (v > M) M = v;
        if (v < m) m = v;
      }
      const f = Math.sqrt(M / -m);
      return out.slice(0, n).map(v => v >= 0 ? v / f : v * f);
    },

    // Helecho: sistema L sobre intervalos. Un axioma de 2-4 intervalos se
    // reescribe con reglas sorteadas de un pool curado (cada símbolo expandido
    // reproduce su patrón, así que las mismas ramas vuelven a escalas
    // distintas) y la cadena se integra en alturas; cuando la línea toca el
    // borde la fronda se dobla (los intervalos se invierten) en vez de rebotar
    helecho(n) {
      // Intervalos en grados: + − (conjuntos), ^ v (terceras), . (repetida), J j (saltos)
      const RULES = {
        '+': ['+-+', '++v', '+.+', '^-'],
        '-': ['-+-', '--^', '-.-', 'v+'],
        '^': ['++', '^-.', '+.+'],
        'v': ['--', 'v+.', '-.-'],
        '.': ['+-', '-+', '.', '..'],
        'J': ['J--', '+J', 'J-.'],
        'j': ['j++', '-j', 'j+.']
      };
      const AXIOMS = ['++-', '^--', 'J---', '+.-', '+-', '++-v', 'j++', '+^-.', '-+^', '+J-', 'v+.+'];
      const grow = () => {
        const leap = pickRandom([3, 4]);
        const step = { '+': 1, '-': -1, '^': 2, 'v': -2, '.': 0, 'J': leap, 'j': -leap };
        const rule = {};
        const alt = {};
        for (const s in RULES) {
          rule[s] = pickRandom(RULES[s]);
          alt[s] = pickRandom(RULES[s]);
        }
        const stochastic = Math.random() < 0.3 ? 0.12 : 0;       // alguna rama se aparta de la regla
        let str = pickRandom(AXIOMS);
        for (let it = 0; it < 8 && str.length < n; it++) {
          let next = '';
          for (const s of str) {
            next += stochastic && Math.random() < stochastic ? alt[s] : rule[s];
            if (next.length >= 4 * n) break;
          }
          str = next;
        }
        while (str.length < n) str += str;                        // reglas que no crecen ('.' → '.')
        const seq = [...str.slice(0, n)];
        if (Math.random() < 0.15) seq.reverse();                  // retrógrado
        const bound = 7 + Math.random() * 1.5;
        let sign = Math.random() < 0.5 ? 1 : -1;                  // espejo
        const out = [];
        let v = (Math.random() - 0.5) * 4;
        for (let i = 0; i < n; i++) {
          out.push(v);
          let next = v + sign * step[seq[i]];
          if (next > bound || next < -bound) {
            sign = -sign;
            next = v + sign * step[seq[i]];
          }
          v = next;
        }
        return out;
      };
      // Reglas equilibradas (+ → + - +, - → - + -) dan una fronda casi plana
      // que la normalización estiraría: se re-sortea hasta un ámbito propio
      let best = null;
      let bestSpan = -1;
      for (let attempt = 0; attempt < 12; attempt++) {
        const out = grow();
        let lo = Infinity;
        let hi = -Infinity;
        for (const x of out) {
          if (x < lo) lo = x;
          if (x > hi) hi = x;
        }
        if (hi - lo >= 10) return out;
        if (hi - lo > bestSpan) {
          bestSpan = hi - lo;
          best = out;
        }
      }
      return best;
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
    // Una curva que ya viene en grados exactos (ámbito 9–14 dentro del rango)
    // se respeta tal cual: reescalarla o descentrarla rompería terceras,
    // transportes y la tónica final de los contornos que piensan en grados
    if (span >= 9 && span <= 14 && min >= -7.5 && max <= 7.5) {
      return raw.map(v => Math.max(-7, Math.min(7, Math.round(v))));
    }
    const targetSpan = 9 + Math.random() * 5;
    const center = (Math.random() - 0.5) * 3;
    return raw.map(v => {
      const d = Math.round(center + ((v - min) / span - 0.5) * targetSpan);
      return Math.max(-7, Math.min(7, d));
    });
  }

  // Valores rítmicos en pasos de semicorchea (16n, 8n, 8n·, 4n, 4n·, 2n) con
  // dos tablas de pesos — frase activa y frase en reposo — que se interpolan
  // con la onda de respiración: activa pesa lo corto, en reposo lo largo
  const NOTE_VALUES = [1, 2, 3, 4, 6, 8];
  const NOTE_VALUE_WEIGHTS_ACTIVE = [3.5, 3, 1.4, 0.7, 0.2, 0.1];
  const NOTE_VALUE_WEIGHTS_CALM = [0.5, 1.5, 1.5, 3, 2, 1.5];
  // Atracción del pulso: los valores que dejan el siguiente ataque en tiempo
  // (paso múltiplo de 4) pesan más, así tras una síncopa el ritmo tiende a
  // recolocarse y los tiempos fuertes — que energía y contrapunto protegen —
  // llevan material de verdad. Sin ella el ritmo flota casi como al azar
  const BEAT_PULL = 2.5;

  function pickNoteValue(breath, pos) {
    let total = 0;
    const weights = NOTE_VALUES.map((v, i) => {
      let w = NOTE_VALUE_WEIGHTS_ACTIVE[i] * breath + NOTE_VALUE_WEIGHTS_CALM[i] * (1 - breath);
      if ((pos + v) % 4 === 0) w *= BEAT_PULL;
      total += w;
      return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return NOTE_VALUES[i];
    }
    return NOTE_VALUES[NOTE_VALUES.length - 1];
  }

  // Densidad mínima de ataques por célula: el ritmo por valores largos y
  // silencios puede dejar una célula de 16 pasos con 1-2 notas, y una pista
  // que la repite durante una sección (más las notas que el humanizador gasta
  // en las repeticiones) queda casi muda. Madre y variaciones se re-sortean
  // hasta cumplirla (con tope de intentos)
  const MIN_CELL_NOTES = 3;
  const MIN_CELL_DENSITY = 0.15;
  const DENSITY_ATTEMPTS = 20;

  function hasEnoughNotes(cell) {
    let count = 0;
    for (const s of cell) if (s.note) count++;
    return count >= Math.max(MIN_CELL_NOTES, Math.ceil(cell.length * MIN_CELL_DENSITY));
  }

  // Sortea con make() hasta cumplir la densidad mínima; si se agotan los
  // intentos, la más densa de las probadas
  function withEnoughNotes(make) {
    let best = null;
    let bestCount = -1;
    for (let i = 0; i < DENSITY_ATTEMPTS; i++) {
      const cell = make();
      if (hasEnoughNotes(cell)) return cell;
      const count = cell.filter(s => s.note).length;
      if (count > bestCount) { best = cell; bestCount = count; }
    }
    return best;
  }

  // Cada paso: { note: on/off, degree: grado de escala (entero, octava por división),
  //              velocity: 0..1, sustain: fracción de duración }.
  // El grado se convierte a MIDI recién en degreeToMidi().
  // Las alturas siguen un contorno orgánico (al azar dentro de contourChoice,
  // ver resolveContourPool); la densidad y la dinámica respiran con una onda
  // lenta de fraseo.
  function generateMotherCell(length, contourChoice) {
    return withEnoughNotes(() => buildMotherCell(length, contourChoice));
  }

  function buildMotherCell(length, contourChoice) {
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
    // El ritmo avanza por valores de nota en vez de sortear cada paso: cada
    // ataque (o silencio) ocupa un valor rítmico entero, así los huecos varían
    // y la duración final (sustain × hueco) da notas tenidas, no solo
    // semicorcheas picadas
    const cell = [];
    let nextOnset = 0;
    for (let i = 0; i < actualLength; i++) {
      const breath = 0.5 + 0.5 * Math.sin(breathPhase + (i / actualLength) * Math.PI * 2 * breathCycles);
      const legato = 0.5 + 0.5 * Math.sin(legatoPhase + (i / actualLength) * Math.PI * 2 * legatoCycles);
      // Acento métrico leve: tiempo (paso múltiplo de 4) y, más, cabeza de compás
      const accent = i % 16 === 0 ? 0.1 : i % 4 === 0 ? 0.06 : 0;
      const velocity = 0.45 + 0.25 * breath + 0.1 * (degrees[i] / 7) + accent + (Math.random() - 0.5) * 0.2;
      let note = false;
      if (i >= nextOnset) {
        note = Math.random() < 0.65 + 0.32 * breath;
        nextOnset = i + pickNoteValue(breath, i);
      }
      cell.push({
        note,
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

  function clampDegree(d) {
    return Math.max(-7, Math.min(7, d));
  }

  // Transporte al azar en [-3, 3] sin 0, limitado a los desplazamientos que
  // dejan las notas que suenan dentro de [-7, 7]; si ninguno cabe, el de
  // menor desborde (el recorte final de generateVariation hace el resto)
  function pickTransposition(cell) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of cell) {
      if (!s.note) continue;
      if (s.degree < lo) lo = s.degree;
      if (s.degree > hi) hi = s.degree;
    }
    if (lo === Infinity) { lo = 0; hi = 0; }
    const offsets = [-3, -2, -1, 1, 2, 3];
    const fits = offsets.filter(o => lo + o >= -7 && hi + o <= 7);
    if (fits.length) return pickRandom(fits);
    const overflow = o => Math.max(0, -7 - (lo + o)) + Math.max(0, hi + o - 7);
    return offsets.reduce((best, o) => (overflow(o) < overflow(best) ? o : best));
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
      // rotación en tiempos enteros (múltiplo de 4, nunca 0) para no desplazar
      // el ritmo respecto al pulso
      c => rotate(c, 4 * (1 + Math.floor(Math.random() * (c.length / 4 - 1)))),
      c => transpose(c, pickTransposition(c)),
      c => subsequence(c)
    ];
    let cell = motherCell;
    const opCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < opCount; i++) {
      cell = pickRandom(ops)(cell);
    }
    if (Math.random() < 0.4) cell = recontour(cell, motherCell.contour, resolveContourPool(contourChoice));
    const contourName = cell.contour || motherCell.contour;
    // la máscara mueve grados ±2: recorte final para mantener [-7, 7]
    cell = applyMask(cell, generateModifierMask(cell.length))
      .map(s => (s.degree < -7 || s.degree > 7 ? { ...s, degree: clampDegree(s.degree) } : s));
    cell.contour = contourName;
    return cell;
  }

  // motifs[0] es siempre la célula madre, seguida de 2 a 4 variaciones
  function generateMotifs(motherCell, variationCount, contourChoice) {
    const variations = variationCount || (2 + Math.floor(Math.random() * 3));
    const motifs = [motherCell];
    for (let m = 0; m < variations; m++) {
      motifs.push(withEnoughNotes(() => generateVariation(motherCell, contourChoice)));
    }
    return motifs;
  }

  function generateForm(formChoice) {
    if (formChoice && formChoice !== 'random' && FORMS.includes(formChoice)) {
      return formChoice;
    }
    return pickRandom(FORMS);
  }

  // Escalas que entran en el sorteo "Aleatoria": la cromática queda fuera
  // (sin centro tonal, la modulación no la altera y el contrapunto la trata
  // aparte); sigue disponible eligiéndola a mano
  const RANDOM_SCALES = ['major', 'minor', 'pentatonic', 'dorian', 'mixolydian'];

  function resolveScale(choice) {
    return SCALES[choice] ? choice : pickRandom(RANDOM_SCALES);
  }

  // Tonalidad en semitonos 0-11; cualquier valor fuera de rango (p. ej.
  // "random") se sortea
  function resolveKey(choice) {
    const k = parseInt(choice, 10);
    return k >= 0 && k <= 11 ? k : Math.floor(Math.random() * 12);
  }

  function parseForm(formStr) {
    return formStr.split('-');
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

  const keyPitchClassCache = new Map();

  function keyPitchClasses(scaleName, key, keyOffset) {
    const cacheKey = scaleName + '|' + key + '|' + keyOffset;
    let pcs = keyPitchClassCache.get(cacheKey);
    if (!pcs) {
      const intervals = SCALES[scaleName] || SCALES.major;
      pcs = new Set(intervals.map(i => (key + keyOffset + i) % 12));
      keyPitchClassCache.set(cacheKey, pcs);
    }
    return pcs;
  }

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
    const pcs = keyPitchClasses(scaleName, key, keyOffset);
    const pc = m => ((m % 12) + 12) % 12;
    if (pcs.has(pc(midi))) return midi;
    const dir = FLAT_KEY_OFFSETS.has(keyOffset) ? -1 : 1;
    for (let d = 1; d <= 6; d++) {
      if (pcs.has(pc(midi + dir * d))) return midi + dir * d;
      if (pcs.has(pc(midi - dir * d))) return midi - dir * d;
    }
    return midi;
  }

  // --- Utilidades compartidas por los pases sobre la pieza compuesta ---
  // (humanizer, energy, counterpoint y composer cargan después de este módulo)

  // Umbral de nota fantasma: por debajo no cuenta como energía ni como
  // disonancia, el contrapunto apaga ahí lo que no resuelve y la compresión
  // de dinámica del compositor la deja intacta
  const GHOST_VELOCITY = 0.18;

  // Tope del hueco que una nota puede sostener (duración = sustain × hueco)
  const MAX_SUSTAIN_STEPS = 16;

  // Mapa pista×paso -> marcador de bloque; los pases no mueven bloques, así
  // que sigue válido mientras mutan la rejilla
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
    resolveScale,
    resolveKey,
    parseForm,
    degreeToMidi,
    degreeToMidiInKey,
    GHOST_VELOCITY,
    MAX_SUSTAIN_STEPS,
    buildBlockMap,
    sectionAt
  };
})();
