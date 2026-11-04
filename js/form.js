const FormPlan = (() => {
  // Plan formal de la pieza, calculado al inicio de Composer.compose, antes de
  // colocar una sola nota: carácter de cada letra, frases de cada sección,
  // clímax, vuelta de A con su retransición y un único perfil de intensidad
  // del que derivan el presupuesto de Energy, la dinámica del humanizador y el
  // arco tonal. Usa azar (por pieza y por letra), pero los pases que lo leen
  // (Energy, Harmony, Counterpoint) siguen siendo deterministas: el plan ya
  // está fijado cuando corren

  // Carácter de cada letra. La primera letra es la exposición; las demás
  // toman un arquetipo que contrasta con ella en al menos dos de: registro
  // (octavas), densidad (pistas, silencios de bloque, presupuesto de
  // Energy), nivel dinámico y preferencia de motivos. Los arquetipos intensos
  // (dense, nivel > 1) se reservan para la letra del clímax
  const ARCHETYPES = {
    exposition: { name: 'exposición', registers: [0], density: 'normal', level: 1, intense: false },
    lyrical: { name: 'lírico', registers: [1], density: 'sparse', level: 0.86, intense: false },
    dark: { name: 'sombrío', registers: [-1], density: 'sparse', level: 0.9, intense: false },
    agitated: { name: 'agitado', registers: [0, -1], density: 'dense', level: 1.15, intense: true },
    brilliant: { name: 'brillante', registers: [1], density: 'dense', level: 1.1, intense: true }
  };

  // Densidad: pistas que tocan la sección (orquestación), probabilidad de
  // que un bloque calle y factor del presupuesto de ataques de Energy
  const DENSITIES = {
    sparse: { tracks: n => Math.max(1, Math.floor(n / 2)), blockSilence: 0.3, budget: 0.75 },
    normal: { tracks: n => Math.max(1, n - Math.ceil(n / 4)), blockSilence: 0.15, budget: 1 },
    dense: { tracks: n => n, blockSilence: 0.05, budget: 1.2 }
  };

  // Preferencia de motivos (peso en el sorteo de fillSpan): la exposición
  // presenta la madre; las demás letras la dejan en segundo plano y prefieren
  // un par de variaciones propias
  const MOTHER_WEIGHT_EXPOSITION = 4;
  const MOTHER_WEIGHT_CONTRAST = 0.25;
  const FAVORITE_WEIGHT = 3;
  const FAVORITES_PER_LETTER = 2;

  // Clímax: posición objetivo (fracción de la pieza) sorteada en este rango;
  // dentro de su sección queda entre el 30 % y el 90 %
  const CLIMAX_RANGE = [0.6, 0.7];

  // Frases: largo objetivo en pasos (4 compases), doble en el carácter
  // lírico; como mucho MAX_PHRASES frases por sección (las secciones muy
  // largas usan frases más largas). Siempre potencias de 2 ≥ cellLength
  const PHRASE_STEPS = 64;
  const MAX_PHRASES = 8;
  // Cadencias internas: antecedente en semicadencia, consecuente en
  // perfecta o, a veces, rota (V–vi)
  const DECEPTIVE_CHANCE = 0.3;

  // Arco local de cada frase (crescendo hasta este punto y cede después) y
  // nivel dinámico global en función de la intensidad: DYN_FLOOR en los
  // extremos de la pieza, DYN_FLOOR + DYN_RANGE en el clímax
  const PHRASE_ARC_PEAK = 0.6;
  const DYN_FLOOR = 0.85;
  const DYN_RANGE = 0.3;
  // Rampa de la retransición: crescendo hacia la vuelta o diminuendo
  const RETRANS_RAMP = { crescendo: [0.9, 1.12], diminuendo: [1.05, 0.82] };

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Vuelta final de A: última aparición de la primera letra precedida de otra
  // letra (A-B-A → 2, A-B-C-A-B → 3); -1 si la forma no la tiene (A-A-B-B)
  function returnIndex(formParts) {
    let r = -1;
    for (let i = 1; i < formParts.length; i++) {
      if (formParts[i] === formParts[0] && formParts[i - 1] !== formParts[0]) r = i;
    }
    return r;
  }

  // Orquestación de una letra: k pistas. La exposición las sortea; las demás
  // prefieren las que callaban en la exposición (otro color) y completan al
  // azar
  function pickTracks(numTracks, k, exposition) {
    const order = shuffle([...Array(numTracks).keys()]);
    if (exposition) order.sort((a, b) => exposition.includes(a) - exposition.includes(b));
    return order.slice(0, k).sort((a, b) => a - b);
  }

  // registerDir: sentido de registro de la pieza (+1 o -1). Las letras
  // cuyo arquetipo prefiere el otro sentido se quedan en el registro de la
  // exposición, para que dos secciones nunca disten dos octavas
  function makeCharacter(letter, archetypeId, numTracks, motifCount, exposition, takenFavorites, registerDir) {
    const arch = ARCHETYPES[archetypeId];
    const density = DENSITIES[arch.density];
    const weights = new Array(motifCount).fill(1);
    if (!exposition) {
      weights[0] = MOTHER_WEIGHT_EXPOSITION;
    } else {
      weights[0] = MOTHER_WEIGHT_CONTRAST;
      // favoritas distintas de las de otras letras mientras queden
      const pool = shuffle([...Array(motifCount).keys()].slice(1));
      pool.sort((a, b) => takenFavorites.has(a) - takenFavorites.has(b));
      for (const m of pool.slice(0, FAVORITES_PER_LETTER)) {
        weights[m] = FAVORITE_WEIGHT;
        takenFavorites.add(m);
      }
    }
    return {
      letter,
      archetype: archetypeId,
      name: arch.name,
      register: Generator.pickRandom(arch.registers.map(r => (r === 0 || r === registerDir ? r : 0))),
      density: arch.density,
      blockSilence: density.blockSilence,
      budget: density.budget,
      level: arch.level,
      tracks: pickTracks(numTracks, density.tracks(numTracks), exposition && exposition.tracks),
      motifWeights: weights
    };
  }

  // Sección del clímax: entre la segunda y la anterior al final del arco
  // tonal (end: vuelta de A o última sección), de otra letra que la
  // exposición si se puede; la que contiene la posición objetivo o, si no
  // está entre las candidatas, la de centro más cercano
  function pickClimax(sections, end, target) {
    const total = sections[sections.length - 1].startStep + sections[sections.length - 1].lengthSteps;
    const first = sections[0].label;
    let pool = [];
    for (let i = 1; i < end; i++) pool.push(i);
    if (pool.some(i => sections[i].label !== first)) pool = pool.filter(i => sections[i].label !== first);
    if (!pool.length) {
      pool = sections.map((_, i) => i).filter(i => sections[i].label !== first);
      if (!pool.length) pool = [0];
    }
    const at = target * total;
    const containing = pool.find(i => at >= sections[i].startStep && at < sections[i].startStep + sections[i].lengthSteps);
    if (containing !== undefined) return containing;
    const mid = i => sections[i].startStep + sections[i].lengthSteps / 2;
    return pool.reduce((a, b) => (Math.abs(mid(b) - at) < Math.abs(mid(a) - at) ? b : a));
  }

  // Frases de una sección (potencias de 2 alineadas con las repeticiones de
  // célula); la cadencia de la última la decide Harmony según lo que sigue
  function buildPhrases(section, phraseSteps, cadences) {
    const count = section.lengthSteps / phraseSteps;
    return Array.from({ length: count }, (_, j) => ({
      startStep: section.startStep + j * phraseSteps,
      lengthSteps: phraseSteps,
      cadence: j === count - 1 ? null : cadences[j]
    }));
  }

  function phraseLength(section, cellLength, character) {
    let len = Math.max(cellLength, PHRASE_STEPS * (character.archetype === 'lyrical' ? 2 : 1));
    while (section.lengthSteps / len > MAX_PHRASES) len *= 2;
    return Math.min(len, section.lengthSteps);
  }

  // sections: [{ label, totalRepeats, startStep, lengthSteps }] (posiciones ya
  // fijadas); opts: { cellLength, numTracks, motifCount }
  // Anota en cada sección `character` (compartido por letra, invariante 7),
  // `phrases`, `intensity` (media del perfil), `climax` (bool) y, en la que
  // precede a la vuelta, `retransition`. Devuelve el plan:
  //   { characters, returnIndex, recapIndex, tonalEnd, climaxSection,
  //     climax (fracción), climaxStep, retransition, totalSteps }
  // recapIndex: la vuelta de A o, si la forma no la tiene, la última sección.
  // tonalEnd: desde ahí la pieza está en la tonalidad base (planTonality)
  function plan(sections, opts) {
    const { cellLength, numTracks, motifCount } = opts;
    const S = sections.length;
    const last = sections[S - 1];
    const totalSteps = last.startStep + last.lengthSteps;
    const formParts = sections.map(s => s.label);
    const ret = returnIndex(formParts);
    const recapIndex = S > 1 ? (ret > 0 ? ret : S - 1) : -1;
    const tonalEnd = recapIndex > 0 ? recapIndex : S - 1;

    const target = CLIMAX_RANGE[0] + Math.random() * (CLIMAX_RANGE[1] - CLIMAX_RANGE[0]);
    const climaxSection = pickClimax(sections, tonalEnd, target);

    // Caracteres: la letra del clímax toma un arquetipo intenso (si no es la
    // exposición); las demás, primero los tranquilos y sin repetir mientras
    // queden. Si otra letra acaba también con uno intenso, el de nivel más
    // alto es para la del clímax, para que el clímax dinámico no se desplace
    const letters = [...new Set(formParts)];
    const climaxLetter = sections[climaxSection].label;
    const ids = Object.keys(ARCHETYPES).filter(id => id !== 'exposition');
    const intense = shuffle(ids.filter(id => ARCHETYPES[id].intense));
    const archetypeOf = { [letters[0]]: 'exposition' };
    if (climaxLetter !== letters[0]) archetypeOf[climaxLetter] = intense.shift();
    let rest = shuffle(ids.filter(id => !ARCHETYPES[id].intense)).concat(intense);
    for (const letter of letters.slice(1)) {
      if (archetypeOf[letter]) continue;
      if (!rest.length) rest = shuffle(ids.filter(id => !ARCHETYPES[id].intense));
      archetypeOf[letter] = rest.shift();
    }
    if (climaxLetter !== letters[0]) {
      for (const letter of letters.slice(1)) {
        const id = archetypeOf[letter];
        if (letter !== climaxLetter && ARCHETYPES[id].level > ARCHETYPES[archetypeOf[climaxLetter]].level) {
          archetypeOf[letter] = archetypeOf[climaxLetter];
          archetypeOf[climaxLetter] = id;
        }
      }
    }
    const characters = {};
    const takenFavorites = new Set();
    const registerDir = Math.random() < 0.5 ? 1 : -1;
    characters[letters[0]] = makeCharacter(letters[0], 'exposition', numTracks, motifCount, null, takenFavorites, registerDir);
    for (const letter of letters.slice(1)) {
      characters[letter] = makeCharacter(letter, archetypeOf[letter], numTracks, motifCount, characters[letters[0]], takenFavorites, registerDir);
    }

    // Frases: largo y patrón de cadencias internas por letra
    const phrasePlan = {};
    for (const letter of letters) {
      const section = sections.find(s => s.label === letter);
      const steps = phraseLength(section, cellLength, characters[letter]);
      const count = section.lengthSteps / steps;
      const cadences = Array.from({ length: Math.max(0, count - 1) }, (_, j) =>
        (j % 2 === 0 ? 'half' : Math.random() < DECEPTIVE_CHANCE ? 'deceptive' : 'authentic'));
      phrasePlan[letter] = { steps, cadences };
    }

    // Retransición: la última frase de la sección que precede a la
    // recapitulación (o su mitad si es de una sola frase) prolonga la
    // dominante de la tonalidad a la que vuelve
    let retransition = null;
    sections.forEach(section => {
      section.character = characters[section.label];
      const pp = phrasePlan[section.label];
      section.phrases = buildPhrases(section, pp.steps, pp.cadences);
      section.climax = false;
      delete section.retransition;
    });
    if (recapIndex > 0) {
      const prev = sections[recapIndex - 1];
      const lastPhrase = prev.phrases[prev.phrases.length - 1];
      const length = prev.phrases.length > 1 ? lastPhrase.lengthSteps : prev.lengthSteps / 2;
      retransition = { section: recapIndex - 1, startStep: prev.startStep + prev.lengthSteps - length, lengthSteps: length, shape: null };
    }

    // Punto del clímax dentro de su sección. Si esa sección es la de la
    // retransición, la mitad de las veces el clímax llega al final de la
    // retransición (crescendo sobre la dominante hasta la vuelta) y si no,
    // antes de ella (la retransición se apaga sobre la dominante)
    const cs = sections[climaxSection];
    let lo = cs.startStep + 0.3 * cs.lengthSteps;
    let hi = cs.startStep + 0.9 * cs.lengthSteps;
    if (retransition && retransition.section === climaxSection) {
      if (Math.random() < 0.5) lo = hi = cs.startStep + 0.95 * cs.lengthSteps;
      else hi = Math.max(cs.startStep + 0.25 * cs.lengthSteps, retransition.startStep);
      lo = Math.min(lo, hi);
    }
    const climaxStep = Math.round(Math.min(hi, Math.max(lo, target * totalSteps)));
    cs.climax = true;
    const form = {
      characters, returnIndex: ret, recapIndex, tonalEnd, climaxSection,
      climax: climaxStep / totalSteps, climaxStep, retransition, totalSteps
    };
    if (retransition) {
      retransition.shape = climaxStep >= retransition.startStep + retransition.lengthSteps / 2 ? 'crescendo' : 'diminuendo';
      sections[retransition.section].retransition = retransition;
    }
    for (const section of sections) {
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += intensityAt(form, section.startStep + (k + 0.5) * section.lengthSteps / 8);
      section.intensity = sum / 8;
    }
    return form;
  }

  // Perfil de intensidad de la pieza en [0, 1]: arco lineal desde 0 al
  // principio hasta 1 en el clímax y de vuelta a 0 al final. Sin plan (pases
  // llamados sueltos) culmina al 65 %
  function intensityAt(form, step, totalSteps) {
    const total = form ? form.totalSteps : totalSteps;
    const climax = form ? form.climax : 0.65;
    const f = Math.min(1, Math.max(0, step / total));
    return f < climax ? f / climax : (1 - f) / (1 - climax || 1);
  }

  // Factor del presupuesto de Energy en el paso s: el carácter de la sección
  function budgetAt(section) {
    return section && section.character ? section.character.budget : 1;
  }

  // Nivel dinámico de una nota en el paso s de `section`: carácter de la
  // letra × perfil de intensidad × rampa de la retransición
  function levelAt(form, section, s) {
    if (!form) return 1;
    let level = (section && section.character ? section.character.level : 1) *
      (DYN_FLOOR + DYN_RANGE * intensityAt(form, s));
    const rt = section && section.retransition;
    if (rt && s >= rt.startStep && s < rt.startStep + rt.lengthSteps) {
      const [a, b] = RETRANS_RAMP[rt.shape];
      level *= a + (b - a) * (s - rt.startStep) / rt.lengthSteps;
    }
    return level;
  }

  // Arco local de una frase: 0 en sus extremos, 1 en PHRASE_ARC_PEAK
  function phraseArc(t01) {
    return t01 < PHRASE_ARC_PEAK ? t01 / PHRASE_ARC_PEAK : (1 - t01) / (1 - PHRASE_ARC_PEAK);
  }

  // Frase que contiene el paso s en la sección (o null)
  function phraseAt(section, s) {
    if (!section || !section.phrases) return null;
    return section.phrases.find(p => s >= p.startStep && s < p.startStep + p.lengthSteps) || null;
  }

  return { plan, returnIndex, intensityAt, budgetAt, levelAt, phraseArc, phraseAt, ARCHETYPES, DENSITIES };
})();
