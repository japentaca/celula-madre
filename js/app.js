const App = (() => {
  let state = {
    tracks: [],
    motifs: [],
    motherCellLength: 16,
    cellLength: 16,
    form: 'A-B-A',
    formParsed: [],
    sectionOrder: [],
    isPlaying: false,
    totalSteps: 0
  };

  function getUIState() {
    return {
      tempo: parseInt(document.getElementById('slider-tempo').value),
      numTracks: parseInt(document.getElementById('slider-tracks').value),
      duration: parseInt(document.getElementById('slider-duration').value),
      preset: document.getElementById('select-preset').value,
      scale: document.getElementById('select-scale').value,
      key: parseInt(document.getElementById('select-key').value),
      formChoice: document.getElementById('select-form').value,
      autogen: document.getElementById('checkbox-autogen').checked,
      autorestart: document.getElementById('checkbox-autorestart').checked
    };
  }

  function updateLabels() {
    const ui = getUIState();
    document.getElementById('val-tempo').textContent = ui.tempo;
    document.getElementById('val-tracks').textContent = ui.numTracks;
    document.getElementById('val-duration').textContent = ui.duration;
  }

  function setupUI() {
    const sliderTempo = document.getElementById('slider-tempo');
    const sliderTracks = document.getElementById('slider-tracks');
    const sliderDuration = document.getElementById('slider-duration');

    sliderTempo.addEventListener('input', () => {
      updateLabels();
      AudioEngine.setTempo(parseInt(sliderTempo.value));
    });

    sliderTracks.addEventListener('input', updateLabels);
    sliderDuration.addEventListener('input', updateLabels);

    document.getElementById('btn-generate').addEventListener('click', () => {
      generate();
    });

    document.getElementById('btn-play').addEventListener('click', () => {
      play();
    });

    document.getElementById('btn-stop').addEventListener('click', () => {
      stop();
    });

    document.getElementById('select-form').addEventListener('change', () => {
      updateLabels();
    });
  }

  function generate() {
    const ui = getUIState();
    AudioEngine.setTempo(ui.tempo);

    state.motherCellLength = ui.duration * 16;
    state.cellLength = state.motherCellLength;

    state.motherCellLength = Generator.CELL_LENGTHS.find(l => l <= state.motherCellLength) || 16;
    if (state.motherCellLength < ui.duration * 16) {
      const nextIdx = Generator.CELL_LENGTHS.indexOf(state.motherCellLength);
      if (nextIdx + 1 < Generator.CELL_LENGTHS.length && Generator.CELL_LENGTHS[nextIdx + 1] <= ui.duration * 16) {
        state.motherCellLength = Generator.CELL_LENGTHS[nextIdx + 1];
      }
    }

    const cycleOffset = Math.floor(Math.random() * 3) * 8;
    const scaleNotes = Generator.getScaleNotes(ui.scale, ui.key, 4, cycleOffset);

    const motherCell = Generator.generateMotherCell(state.motherCellLength);
    for (let i = 0; i < motherCell.length; i++) {
      motherCell[i].pitch = scaleNotes[Math.floor(Math.random() * scaleNotes.length)];
    }

    const motifCount = 2 + Math.floor(Math.random() * 3);
    state.motifs = Generator.generateMotifs(motherCell, motifCount);

    const formStr = Generator.generateForm(ui.formChoice);
    state.form = formStr;
    state.formParsed = Generator.parseForm(formStr);

    const numTracks = ui.numTracks;
    state.tracks = [];
    for (let t = 0; t < numTracks; t++) {
      const motifIdx = Math.floor(Math.random() * state.motifs.length);
      const silenced = Math.random() < 0.2;
      state.tracks.push({
        preset: silenced ? null : ui.preset,
        motifIndex: silenced ? null : motifIdx,
        silenced
      });
    }

    state.sectionOrder = state.formParsed;

    const totalSteps = state.motherCellLength * countRepeats(state.formParsed);
    state.totalSteps = totalSteps;

    const sectionMarkers = buildSectionMarkers(state.formParsed, state.motherCellLength);
    Visualizer.setSectionMarkers(sectionMarkers);

    renderGrid();
    Composer.compose(state.tracks, state.motifs, state.form, state.motherCellLength);
  }

  function countRepeats(formParts) {
    return formParts.length;
  }

  function buildSectionMarkers(formParts, cellLength) {
    const markers = [];
    let pos = 0;
    let sectionIndex = 0;
    for (const part of formParts) {
      let label = part;
      const existing = markers.find(m => m.label === label);
      if (!existing) {
        sectionIndex++;
        label = part;
      }
      markers.push({ start: pos, length: cellLength, label });
      pos += cellLength;
    }
    return markers;
  }

  function renderGrid() {
    const tracks = state.tracks;
    const motifs = state.motifs;
    Visualizer.init('grid-canvas');
    Visualizer.render(tracks, state.motherCellLength, motifs, state.sectionOrder);
  }

  async function play() {
    await AudioEngine.init();
    if (state.tracks.length === 0) {
      generate();
    }
    Visualizer.setCursor(0);
    Composer.play(
      (stepIndex) => {
        Visualizer.setCursor(stepIndex);
        Visualizer.scrollToCursor();
        renderGrid();
      },
      () => {
        Visualizer.clearCursor();
        renderGrid();
        if (getUIState().autorestart) {
          setTimeout(() => play(), 500);
        }
      }
    );
  }

  function stop() {
    Composer.stop();
    Visualizer.clearCursor();
    renderGrid();
  }

  function init() {
    setupUI();
    updateLabels();
    generate();
  }

  return { init, generate, play, stop };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});