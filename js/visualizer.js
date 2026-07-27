const Visualizer = (() => {
  let canvas = null;
  let ctx = null;
  let cellWidth = 12;
  let cellHeight = 20;
  let trackHeight = 40;
  let headerWidth = 50;
  let cursorStep = -1;
  let highlightedCells = new Set();
  let sectionMarkers = [];
  let motherCellLength = 0;
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');
  }

  function render(tracks, motherCellLengthArg, motifs, sectionOrder) {
    motherCellLength = motherCellLengthArg || 16;
    if (!canvas || !ctx) return;

    const numTracks = tracks.length;
    const totalSteps = motherCellLength;
    const width = headerWidth + totalSteps * cellWidth;
    const height = numTracks * trackHeight + 24;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, width, height);

    if (sectionMarkers.length > 0) {
      ctx.fillStyle = 'rgba(108, 99, 255, 0.08)';
      for (const marker of sectionMarkers) {
        const sx = headerWidth + marker.start * cellWidth;
        const sw = marker.length * cellWidth;
        ctx.fillRect(sx, 24, sw, numTracks * trackHeight);
      }
      ctx.fillStyle = 'rgba(108, 99, 255, 0.5)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      for (const marker of sectionMarkers) {
        const sx = headerWidth + marker.start * cellWidth;
        const sw = marker.length * cellWidth;
        ctx.fillText(marker.label, sx + sw / 2, 18);
      }
    }

    for (let t = 0; t < numTracks; t++) {
      const y = 24 + t * trackHeight;
      ctx.fillStyle = t % 2 === 0 ? '#0d0d1a' : '#0a0a14';
      ctx.fillRect(headerWidth, y, totalSteps * cellWidth, trackHeight);

      ctx.strokeStyle = '#1a1a2e';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(headerWidth, y, totalSteps * cellWidth, trackHeight);

      for (let s = 0; s < totalSteps; s++) {
        const x = headerWidth + s * cellWidth;
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(x, y, cellWidth, trackHeight);

        const track = tracks[t];
        if (track && track.motifIndex !== null && track.motifIndex < motifs.length) {
          const motif = motifs[track.motifIndex];
          if (motif && s < motif.length && motif[s].note) {
            const semitone = motif[s].pitch;
            const octave = Math.floor(semitone / 12);
            const noteInOctave = semitone % 12;
            const noteName = NOTE_NAMES[noteInOctave] + octave;
            const brightness = motif[s].velocity || 0.5;
            const r = Math.floor(106 * brightness);
            const g = Math.floor(99 * brightness);
            const b = Math.floor(255 * brightness);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x + 1, y + 2, cellWidth - 2, trackHeight - 4);

            if (brightness > 0.7) {
              ctx.fillStyle = '#fff';
              ctx.font = '8px monospace';
              ctx.fillText(noteName, x + 1, y + trackHeight / 2 + 3);
            }
          }
        }
      }

      ctx.fillStyle = '#6c63ff';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`T${t + 1}`, headerWidth - 4, y + trackHeight / 2 + 3);
    }

    ctx.strokeStyle = '#6c63ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(headerWidth, 24, totalSteps * cellWidth, numTracks * trackHeight);

    drawCursor();
  }

  function drawCursor() {
    if (!ctx || cursorStep < 0) return;
    const x = headerWidth + cursorStep * cellWidth;
    ctx.fillStyle = 'rgba(255, 80, 80, 0.3)';
    ctx.fillRect(x, 24, cellWidth, canvas.height - 24);
    ctx.fillStyle = '#ff3333';
    ctx.fillRect(x, 24, 2, canvas.height - 24);
  }

  function setCursor(step) {
    cursorStep = step;
  }

  function clearCursor() {
    cursorStep = -1;
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function setSectionMarkers(markers) {
    sectionMarkers = markers;
  }

  function scrollToCursor() {
    if (!canvas) return;
    const container = document.getElementById('grid-container');
    if (!container) return;
    const cursorX = headerWidth + cursorStep * cellWidth;
    const containerWidth = container.clientWidth;
    if (cursorX > container.scrollLeft + containerWidth - 100) {
      container.scrollLeft = cursorX - containerWidth + 150;
    }
  }

  return { init, render, setCursor, clearCursor, setSectionMarkers, scrollToCursor };
})();