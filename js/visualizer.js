const Visualizer = (() => {
  let canvas = null;
  let ctx = null;
  let offscreen = null;
  let offCtx = null;
  let piece = null;
  let cursorStep = -1;

  let cellWidth = 12;
  let trackHeight = 44;
  const headerWidth = 50;
  const topBar = 24;
  let noteHeight = 6;

  // Color por motivo: [0] célula madre, resto variaciones
  const MOTIF_COLORS = [
    [106, 99, 255],
    [78, 205, 196],
    [255, 159, 67],
    [255, 107, 157],
    [123, 237, 159],
    [255, 214, 102],
    [92, 200, 255],
    [255, 99, 99],
    [200, 150, 255]
  ];

  function init(canvasId) {
    canvas = document.getElementById(canvasId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');
  }

  function containerWidth() {
    const container = document.getElementById('grid-container');
    return container ? container.clientWidth : 800;
  }

  function containerHeight() {
    const container = document.getElementById('grid-container');
    return container ? container.clientHeight : 400;
  }

  // Las pistas se reparten el alto disponible (mínimo usable con scroll);
  // el panel lateral se alinea leyendo la variable CSS --track-height.
  // Si la pieza desborda a lo ancho se reserva el alto de la barra de scroll
  function computeTrackHeight(numTracks, needsHScroll) {
    const avail = containerHeight() - topBar - (needsHScroll ? 17 : 0);
    return Math.max(44, Math.floor(avail / numTracks));
  }

  // Ajusta el ancho de celda para que la pieza llene la ventana;
  // si la pieza es muy larga, ancho mínimo y scroll horizontal
  function computeCellWidth(totalSteps) {
    const avail = containerWidth() - headerWidth;
    const fit = Math.floor(avail / totalSteps);
    return Math.max(3, Math.min(20, fit));
  }

  function midiRange(grid) {
    let min = Infinity;
    let max = -Infinity;
    for (const row of grid) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.midi < min) min = cell.midi;
        if (cell.midi > max) max = cell.midi;
      }
    }
    if (min === Infinity) { min = 60; max = 72; }
    if (min === max) max = min + 1;
    return { min, max };
  }

  function renderPiece(p) {
    piece = p;
    cursorStep = -1;
    if (!canvas || !ctx || !piece) return;

    cellWidth = computeCellWidth(piece.totalSteps);
    const width = Math.max(containerWidth(), headerWidth + piece.totalSteps * cellWidth);
    trackHeight = computeTrackHeight(piece.numTracks, width > containerWidth());
    noteHeight = Math.max(6, Math.min(14, Math.round(trackHeight / 7)));
    document.documentElement.style.setProperty('--track-height', trackHeight + 'px');
    const height = topBar + piece.numTracks * trackHeight;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;
    offCtx = offscreen.getContext('2d');

    drawPiece(offCtx, width, height);
    blit();
  }

  function drawPiece(g, width, height) {
    g.fillStyle = '#0a0a14';
    g.fillRect(0, 0, width, height);

    const range = midiRange(piece.grid);

    // Fondo y etiqueta de cada sección
    piece.sections.forEach((section, i) => {
      const sx = headerWidth + section.startStep * cellWidth;
      const sw = section.lengthSteps * cellWidth;
      g.fillStyle = i % 2 === 0 ? 'rgba(108, 99, 255, 0.10)' : 'rgba(108, 99, 255, 0.04)';
      g.fillRect(sx, topBar, sw, piece.numTracks * trackHeight);

      g.fillStyle = section.recap ? 'rgba(255, 170, 80, 0.9)' : 'rgba(108, 99, 255, 0.7)';
      g.font = '10px monospace';
      g.textAlign = 'center';
      const label = section.label
        + (section.totalRepeats > 1 ? ' x' + section.totalRepeats : '')
        + (section.recap ? ' (R)' : '');
      g.fillText(label, sx + sw / 2, 16);

      g.strokeStyle = 'rgba(108, 99, 255, 0.35)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sx + 0.5, topBar);
      g.lineTo(sx + 0.5, height);
      g.stroke();
    });

    for (let t = 0; t < piece.numTracks; t++) {
      const y = topBar + t * trackHeight;

      g.strokeStyle = '#1a1a2e';
      g.lineWidth = 0.5;
      g.strokeRect(headerWidth, y, piece.totalSteps * cellWidth, trackHeight);

      const row = piece.grid[t];
      for (let s = 0; s < piece.totalSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const x = headerWidth + s * cellWidth;
        const norm = (cell.midi - range.min) / (range.max - range.min);
        const ny = y + (trackHeight - noteHeight - 2) * (1 - norm) + 1;
        const brightness = 0.4 + 0.6 * cell.velocity;
        const color = MOTIF_COLORS[(cell.motifIndex || 0) % MOTIF_COLORS.length];
        const r = Math.floor(color[0] * brightness);
        const gg = Math.floor(color[1] * brightness);
        const b = Math.floor(color[2] * brightness);
        g.fillStyle = `rgb(${r},${gg},${b})`;
        const noteWidth = Math.max((cell.durationSteps || 1) * cellWidth - 1, 2);
        g.fillRect(x, ny, noteWidth, noteHeight);
      }

      g.fillStyle = '#6c63ff';
      g.font = '10px monospace';
      g.textAlign = 'right';
      g.fillText('T' + (t + 1), headerWidth - 6, y + trackHeight / 2 + 3);
    }

    // Límite izquierdo de cada bloque dentro de su pista
    if (piece.blockMarkers) {
      g.lineWidth = 1;
      for (const block of piece.blockMarkers) {
        const bx = headerWidth + block.startStep * cellWidth;
        const by = topBar + block.trackIndex * trackHeight;
        const color = MOTIF_COLORS[block.motifIndex % MOTIF_COLORS.length];
        g.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.45)`;
        g.beginPath();
        g.moveTo(bx + 0.5, by);
        g.lineTo(bx + 0.5, by + trackHeight);
        g.stroke();
      }
    }

    g.strokeStyle = '#6c63ff';
    g.lineWidth = 1.5;
    g.strokeRect(headerWidth, topBar, piece.totalSteps * cellWidth, piece.numTracks * trackHeight);
  }

  function blit() {
    if (!ctx || !offscreen) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0);
    if (cursorStep >= 0) {
      const x = headerWidth + cursorStep * cellWidth;
      ctx.fillStyle = 'rgba(255, 80, 80, 0.25)';
      ctx.fillRect(x, topBar, cellWidth, canvas.height - topBar);
      ctx.fillStyle = '#ff3333';
      ctx.fillRect(x, topBar, 2, canvas.height - topBar);
    }
  }

  function setCursor(step) {
    cursorStep = step;
    blit();
    scrollToCursor();
  }

  function clearCursor() {
    cursorStep = -1;
    blit();
  }

  function scrollToCursor() {
    const container = document.getElementById('grid-container');
    if (!container || cursorStep < 0) return;
    const cursorX = headerWidth + cursorStep * cellWidth;
    const viewWidth = container.clientWidth;
    if (cursorX > container.scrollLeft + viewWidth - 100 || cursorX < container.scrollLeft) {
      container.scrollLeft = Math.max(0, cursorX - 150);
    }
  }

  // MOTIF_COLORS se comparte con la vista 3D para que ambas pinten igual
  return { init, renderPiece, setCursor, clearCursor, MOTIF_COLORS };
})();
