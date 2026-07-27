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

  // Pasos de desplazamiento en el ciclo de quintas (SPEC: potencias de 2 entre 8 y 32)
  const FIFTH_STEPS = [8, 16, 32];

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

  // Fracción del hueco hasta la siguiente nota que la nota sostiene (1 = legato)
  const SUSTAIN_CHOICES = [0.3, 0.6, 1];

  // Cada paso: { note: on/off, degree: grado de escala (entero, octava por división),
  //              velocity: 0..1, sustain: fracción de duración }.
  // El grado se convierte a MIDI recién en degreeToMidi().
  function generateMotherCell(length) {
    const actualLength = length || pickRandom(CELL_LENGTHS);
    const cell = [];
    for (let i = 0; i < actualLength; i++) {
      cell.push({
        note: Math.random() < 0.4,
        degree: Math.floor(Math.random() * 15) - 7,
        velocity: 0.5 + Math.random() * 0.5,
        sustain: pickRandom(SUSTAIN_CHOICES)
      });
    }
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

  // La máscara afecta todas las propiedades del paso donde vale 1 (SPEC)
  function applyMask(cell, mask) {
    return cell.map((step, i) => {
      if (!mask[i]) return step;
      const flipNote = Math.random() < 0.3;
      return {
        note: flipNote ? !step.note : step.note,
        degree: step.degree + Math.floor(Math.random() * 5) - 2,
        velocity: Math.max(0.1, Math.min(1, step.velocity + (Math.random() - 0.5) * 0.3)),
        sustain: Math.random() < 0.5 ? pickRandom(SUSTAIN_CHOICES) : step.sustain
      };
    });
  }

  function generateVariation(motherCell) {
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
    return applyMask(cell, generateModifierMask(cell.length));
  }

  // motifs[0] es siempre la célula madre, seguida de 2 a 4 variaciones (SPEC)
  function generateMotifs(motherCell, variationCount) {
    const variations = variationCount || (2 + Math.floor(Math.random() * 3));
    const motifs = [motherCell];
    for (let m = 0; m < variations; m++) {
      motifs.push(generateVariation(motherCell));
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

  // Pasos de desplazamiento en el ciclo de quintas (SPEC: 8, 16 o 32)
  function randomFifthSteps() {
    return pickRandom(FIFTH_STEPS);
  }

  // El desplazamiento por quintas se aplica en grados de la escala, no en semitonos:
  // así mueve el centro/registro pero conserva las alturas de la tonalidad elegida
  function degreeToMidi(degree, scaleName, key, fifthSteps, baseOctave) {
    const intervals = SCALES[scaleName] || SCALES.major;
    const n = intervals.length;
    const degreesPerFifth = Math.round(n * 7 / 12);
    const shift = fifthSteps ? (fifthSteps * degreesPerFifth) % n : 0;
    const d = degree + shift;
    const octave = Math.floor(d / n);
    const idx = ((d % n) + n) % n;
    const base = 12 * ((baseOctave === undefined ? 4 : baseOctave) + 1);
    return base + key + intervals[idx] + octave * 12;
  }

  return {
    SCALES,
    CELL_LENGTHS,
    FORMS,
    pickRandom,
    generateMotherCell,
    generateModifierMask,
    generateVariation,
    generateMotifs,
    generateForm,
    parseForm,
    randomFifthSteps,
    degreeToMidi
  };
})();
