const Visualizer = (() => {
  let canvas = null;
  let ctx = null;
  let offscreen = null;
  let offCtx = null;
  let piece = null;
  let cursorStep = -1;
  // Tamaño CSS del lienzo y factor físico/CSS efectivo (dpr acotado)
  let cssWidth = 0;
  let cssHeight = 0;
  let pixelScale = 1;

  let cellWidth = 12;
  let trackHeight = 44;
  const headerWidth = 50;
  const topBar = 24;
  let noteHeight = 6;

  // Paleta del lienzo, a juego con los tokens de css/style.css
  const BG = '#0b0b0d';
  const LINE = '#1c1c20';
  const LABEL = '#8f8d87';
  const FAINT = '#5f5e5a';
  const RECAP = 'rgba(255, 181, 71, 0.95)';
  const MONO = '"JetBrains Mono", ui-monospace, Consolas, monospace';

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
        for (const note of cell.voices || [cell]) {
          if (note.midi < min) min = note.midi;
          if (note.midi > max) max = note.midi;
        }
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

    cssWidth = width;
    cssHeight = height;
    pixelScale = effectivePixelScale(width, height);
    const physWidth = Math.ceil(width * pixelScale);
    const physHeight = Math.ceil(height * pixelScale);

    canvas.width = physWidth;
    canvas.height = physHeight;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);

    offscreen = document.createElement('canvas');
    offscreen.width = physWidth;
    offscreen.height = physHeight;
    offCtx = offscreen.getContext('2d');
    offCtx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);

    drawPiece(offCtx, width, height);
    blit();
  }

  // Los navegadores no pintan (o fallan en silencio) lienzos por encima de
  // ~16384 px de lado o de ~16 Mpx de área (Safari/iOS es el más estricto);
  // en piezas largas se sacrifica nitidez antes que dejar el lienzo en blanco
  const MAX_CANVAS_SIDE = 16384;
  const MAX_CANVAS_AREA = 16 * 1024 * 1024;

  function effectivePixelScale(width, height) {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(
      dpr,
      MAX_CANVAS_SIDE / width,
      MAX_CANVAS_SIDE / height,
      Math.sqrt(MAX_CANVAS_AREA / (width * height))
    );
  }

  function drawPiece(g, width, height) {
    g.fillStyle = BG;
    g.fillRect(0, 0, width, height);

    const range = midiRange(piece.grid);

    // Fondo y etiqueta de cada sección
    piece.sections.forEach((section, i) => {
      const sx = headerWidth + section.startStep * cellWidth;
      const sw = section.lengthSteps * cellWidth;
      g.fillStyle = section.recap
        ? 'rgba(255, 181, 71, 0.045)'
        : (i % 2 === 0 ? 'rgba(255, 255, 255, 0.028)' : 'rgba(255, 255, 255, 0.008)');
      g.fillRect(sx, topBar, sw, piece.numTracks * trackHeight);

      g.fillStyle = section.recap ? RECAP : LABEL;
      g.font = `500 10px ${MONO}`;
      g.textAlign = 'left';
      const label = section.label
        + (section.totalRepeats > 1 ? ' ×' + section.totalRepeats : '')
        + (section.recap ? '  recap' : '');
      g.fillText(label, sx + 8, 16);

      g.strokeStyle = 'rgba(255, 255, 255, 0.10)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sx + 0.5, topBar);
      g.lineTo(sx + 0.5, height);
      g.stroke();
    });

    for (let t = 0; t < piece.numTracks; t++) {
      const y = topBar + t * trackHeight;

      g.strokeStyle = LINE;
      g.lineWidth = 1;
      g.strokeRect(headerWidth, y, piece.totalSteps * cellWidth, trackHeight);

      const row = piece.grid[t];
      for (let s = 0; s < piece.totalSteps; s++) {
        if (!row[s]) continue;
        // pista de acordes (Pad): todas sus voces atacadas; las ligadas ya
        // las dibuja la voz que sostienen
        const notes = row[s].voices ? row[s].voices.filter(v => !v.tied) : [row[s]];
        for (const cell of notes) {
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
      }

      g.fillStyle = FAINT;
      g.font = `10px ${MONO}`;
      g.textAlign = 'right';
      g.fillText(String(t + 1).padStart(2, '0') + (t === piece.padTrack ? '≋' : ''), headerWidth - 10, y + trackHeight / 2 + 3);
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

    g.strokeStyle = '#26262b';
    g.lineWidth = 1;
    g.strokeRect(headerWidth + 0.5, topBar + 0.5, piece.totalSteps * cellWidth - 1, piece.numTracks * trackHeight - 1);
  }

  function blit() {
    if (!ctx || !offscreen) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(offscreen, 0, 0);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
    drawCursor();
  }

  function drawCursor() {
    if (cursorStep < 0) return;
    const x = headerWidth + cursorStep * cellWidth;
    ctx.fillStyle = 'rgba(255, 90, 78, 0.18)';
    ctx.fillRect(x, topBar, cellWidth, cssHeight - topBar);
    ctx.fillStyle = '#ff5a4e';
    ctx.fillRect(x, topBar, 2, cssHeight - topBar);
  }

  // Repinta desde el offscreen solo la franja que ensució el cursor en ese
  // paso, en px físicos y con 1 px de margen por el antialias de escalas no
  // enteras
  function restoreColumn(step) {
    const x = headerWidth + step * cellWidth;
    const x0 = Math.max(0, Math.floor(x * pixelScale) - 1);
    const x1 = Math.min(canvas.width, Math.ceil((x + Math.max(cellWidth, 2)) * pixelScale) + 1);
    const y0 = Math.max(0, Math.floor(topBar * pixelScale) - 1);
    const y1 = canvas.height;
    if (x1 <= x0 || y1 <= y0) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
    ctx.drawImage(offscreen, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
    ctx.setTransform(pixelScale, 0, 0, pixelScale, 0, 0);
  }

  function setCursor(step) {
    if (!ctx || !offscreen) return;
    if (cursorStep >= 0) restoreColumn(cursorStep);
    cursorStep = step;
    drawCursor();
    scrollToCursor();
  }

  function clearCursor() {
    if (ctx && offscreen && cursorStep >= 0) restoreColumn(cursorStep);
    cursorStep = -1;
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

  // MOTIF_COLORS y midiRange se comparten con la vista 3D para que ambas pinten igual
  return { init, renderPiece, setCursor, clearCursor, MOTIF_COLORS, midiRange };
})();
