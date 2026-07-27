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

  function getScaleNotes(scaleName, tonality, octaveShift, cycleOffset) {
    const intervals = SCALES[scaleName] || SCALES.major;
    const root = tonality + cycleOffset;
    return intervals.map(interval => {
      const pitch = root + interval + octaveShift * 12;
      return Tone.Frequency(pitch, 'midi').toNote();
    });
  }

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function generateMotherCell(length) {
    const actualLength = length || pickRandom(CELL_LENGTHS);
    const cell = [];
    for (let i = 0; i < actualLength; i++) {
      cell.push({
        note: Math.random() < 0.4,
        pitch: 0,
        velocity: 0.5 + Math.random() * 0.5
      });
    }
    return cell;
  }

  function applyCycleOffset(cell, cycleOffset) {
    return cell.map(step => ({
      ...step,
      pitch: cycleOffset
    }));
  }

  function generateModifierMask(length) {
    return Array.from({ length }, () => Math.random() < 0.3 ? 1 : 0);
  }

  function generateVariation(motherCell, mask, octaveShift, pitchShift) {
    return motherCell.map((step, i) => {
      if (!mask[i]) return step;
      return {
        note: step.note,
        pitch: step.pitch + pitchShift + octaveShift,
        velocity: Math.max(0.1, Math.min(1, step.velocity + (Math.random() - 0.5) * 0.3))
      };
    });
  }

  function generateMotifs(motherCell, count) {
    count = count || (2 + Math.floor(Math.random() * 3));
    const motifs = [motherCell];
    for (let m = 1; m < count; m++) {
      const mask = generateModifierMask(motherCell.length);
      const octaveShift = Math.floor(Math.random() * 3) - 1;
      const pitchShift = Math.floor(Math.random() * 5) - 2;
      motifs.push(generateVariation(motherCell, mask, octaveShift, pitchShift));
    }
    return motifs;
  }

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

  function generateForm(formChoice) {
    if (formChoice && formChoice !== 'random' && FORMS.includes(formChoice)) {
      return formChoice;
    }
    return pickRandom(FORMS);
  }

  function parseForm(formStr) {
    return formStr.split('-');
  }

  function generateSection(length, cellLength) {
    const repeats = Math.pow(2, Math.floor(Math.random() * 4) + 1);
    const totalSteps = cellLength * repeats;
    const section = [];
    for (let r = 0; r < repeats; r++) {
      for (let i = 0; i < cellLength; i++) {
        section.push({ ...length });
      }
    }
    return section;
  }

  return {
    SCALES,
    CELL_LENGTHS,
    FORMS,
    getScaleNotes,
    generateMotherCell,
    applyCycleOffset,
    generateModifierMask,
    generateVariation,
    generateMotifs,
    generateForm,
    parseForm
  };
})();