// Vistas 3D de la grilla con THREE.js, dos modos que comparten renderer,
// shader de notas (destello al sonar), bloom y seguimiento de cámara:
// - «city»: ciudad de notas — tiempo en X, pistas en profundidad Z, altura
//   tonal en Y, bloques emisivos instanciados.
// - «tunnel»: túnel helicoidal — el tiempo se enrolla en una hélice donde una
//   vuelta completa = una célula (las repeticiones quedan alineadas a lo largo
//   del eje y las variaciones se ven como cambios en el mismo ángulo); cada
//   pista es un anillo concéntrico y la cámara viaja por dentro.
// Implementa la misma interfaz que Visualizer (renderPiece/setCursor/
// clearCursor) más setMode/setActive; App conmuta con el selector «Vista».
//
// Es el único módulo ESM del proyecto: los addons de THREE (OrbitControls,
// postprocesado) solo se distribuyen como módulos, así que se carga con
// <script type="module"> + importmap y publica su global en window a mano.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.Visualizer3D = (() => {
  // --- Ciudad ---
  const STEP = 1;        // ancho de un paso en unidades de mundo
  const LANE = 3.2;      // separación entre pistas en Z
  const NOTE_DEPTH = 2.1;
  const PITCH_H = 13;    // recorrido vertical del rango de alturas

  // --- Túnel ---
  const ARC = 1.15;        // arco por paso en el anillo interior
  const TURN_PITCH = 10;   // avance axial por vuelta (una vuelta = una célula)
  const BAND = 2.6;        // separación radial entre pistas
  const PITCH_R = 1.5;     // recorrido radial de la altura dentro de su banda

  // --- Terreno ---
  const T_BAND = 7;        // ancho en Z de la cresta de cada pista
  const T_ROWS = 9;        // filas de vértices por banda

  // --- Constelación ---
  const S_LANE = 6;        // separación entre pistas en Z
  const S_H = 24;          // recorrido vertical del rango de alturas

  const FALLBACK_COLORS = [[106, 99, 255], [78, 205, 196], [255, 159, 67]];

  let container = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
  let composer = null;
  let clock = null;
  let resizeObserver = null;

  let mode = 'city';
  let piece = null;
  let cityGroup = null;
  let notesMesh = null;
  let shaderMats = [];        // materiales con uniforms uTime/uFogDensity vivos
  let terrainMat = null;      // material del terreno (frente de onda del cursor)
  let hitAttr = null;         // atributo iHit/aHit donde se estampan los disparos
  let cursorGroup = null;
  let spokeGroup = null;      // radio luminoso del cursor (túnel)
  let ringMesh = null;        // aro del cursor (túnel)
  let tun = null;             // parámetros del túnel de la pieza actual
  let hitIndex = new Map();   // paso -> índices de instancia que arrancan ahí

  let active = false;
  let rafId = null;
  const cursorCur = { x: 0, th: 0 };
  const cursorTarget = { x: 0, th: 0 };
  let cursorSnap = true;      // primer setCursor tras rebuild: sin animación
  let cursorStepLast = -1;
  let follow = true;
  let insideView = true;      // túnel: «Encuadrar» alterna interior/exterior
  let dimsKey = '';           // modo+dimensiones de la última pieza encuadrada

  function motifColors() {
    return (typeof Visualizer !== 'undefined' && Visualizer.MOTIF_COLORS) || FALLBACK_COLORS;
  }

  // ---- Shader de las notas: lambert falso + fresnel + destello al dispararse ----

  const NOTE_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    varying vec3 vColor;
    varying float vHit;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = iColor;
      vHit = iHit;
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const NOTE_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec3 vColor;
    varying float vHit;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(0.35, 0.85, 0.45));
      float diff = 0.4 + 0.6 * max(dot(n, lightDir), 0.0);
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.5);
      float dt = uTime - vHit;
      float flash = dt >= 0.0 ? exp(-dt * 4.5) : 0.0;
      vec3 col = vColor * (diff * 0.85 + fresnel * 0.7);
      col += (vColor * 1.6 + vec3(0.9)) * flash;
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ---- Shader del terreno: lambert + frente de onda luminoso en uCursorX ----

  const TERRAIN_VERTEX = /* glsl */`
    attribute vec3 aColor;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = aColor;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const TERRAIN_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uCursorX;
    uniform float uCursorOn;
    varying vec3 vColor;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(0.3, 0.8, 0.5));
      float diff = 0.35 + 0.65 * max(dot(n, lightDir), 0.0);
      vec3 col = vColor * diff;
      // luz rasante lenta que respira sobre las crestas
      col *= 1.0 + 0.06 * sin(uTime * 0.7 + vWorldPos.x * 0.25);
      // frente de onda del cursor: resplandor cálido que recorre el paisaje
      float g = uCursorOn * exp(-abs(vWorldPos.x - uCursorX) * 0.30);
      col += (vec3(1.0, 0.62, 0.35) * 0.5 + vColor * 1.4) * g;
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  // ---- Shaders de la constelación: estrellas con parpadeo y flare al sonar,
  // más una onda expansiva anular por disparo (Points aditivos) ----

  const STAR_VERTEX = /* glsl */`
    attribute vec3 aColor;
    attribute float aHit;
    attribute float aSize;
    attribute float aSeed;
    uniform float uTime;
    varying vec3 vColor;
    varying float vFlash;
    varying float vSeed;
    varying float vDist;
    void main() {
      vColor = aColor;
      vSeed = aSeed;
      float dt = uTime - aHit;
      vFlash = dt >= 0.0 ? exp(-dt * 3.5) : 0.0;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = length(mv.xyz);
      gl_PointSize = min((6.0 + aSize * 9.0) * (1.0 + 2.5 * vFlash) * (160.0 / vDist), 200.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const STAR_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform float uFogDensity;
    varying vec3 vColor;
    varying float vFlash;
    varying float vSeed;
    varying float vDist;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float core = exp(-d * d * 7.0);
      float halo = exp(-d * 3.0) * 0.35;
      float twinkle = 0.8 + 0.2 * sin(uTime * 2.2 + vSeed * 6.2832);
      vec3 col = vColor * (core + halo) * twinkle;
      col += (vec3(1.0) * core + vColor * halo * 2.0) * vFlash * 1.6;
      // en aditivo la niebla no se mezcla: atenúa
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
      gl_FragColor = vec4(col * (1.0 - clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  const RIPPLE_VERTEX = /* glsl */`
    attribute vec3 aColor;
    attribute float aHit;
    uniform float uTime;
    varying vec3 vColor;
    varying float vT;
    varying float vDist;
    void main() {
      vColor = aColor;
      float dt = uTime - aHit;
      float act = (dt >= 0.0 && dt < 1.3) ? 1.0 : 0.0;
      vT = clamp(dt / 1.3, 0.0, 1.0);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = length(mv.xyz);
      gl_PointSize = act * min((10.0 + dt * 70.0) * (160.0 / vDist), 300.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const RIPPLE_FRAGMENT = /* glsl */`
    uniform float uFogDensity;
    varying vec3 vColor;
    varying float vT;
    varying float vDist;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float ring = smoothstep(0.62, 0.86, d) * (1.0 - smoothstep(0.86, 1.0, d));
      float a = ring * (1.0 - vT) * (1.0 - vT) * 0.8;
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
      gl_FragColor = vec4(vColor * a * (1.0 - clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  function init(containerId) {
    if (renderer) return;
    container = document.getElementById(containerId);
    if (!container) return;

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0a14);
    scene.fog = new THREE.FogExp2(0x0a0a14, 0.004);

    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(30, 20, 40);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.8, 0.35, 0.5));
    composer.addPass(new OutputPass());

    clock = new THREE.Clock();

    buildOverlay();
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    if (piece) buildScene();
  }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'viz3d-overlay';

    const btnFrame = document.createElement('button');
    btnFrame.textContent = '⌂ Encuadrar';
    btnFrame.title = 'Ver la pieza entera; en el túnel alterna interior/exterior';
    btnFrame.addEventListener('click', () => {
      if (mode === 'tunnel') {
        insideView = !insideView;
        if (insideView) frameTunnelInside();
        else frameTunnelOutside();
      } else {
        frameFull();
      }
    });

    const btnFollow = document.createElement('button');
    btnFollow.textContent = '▶ Seguir';
    btnFollow.title = 'La cámara acompaña al cursor durante la reproducción';
    btnFollow.classList.toggle('active', follow);
    btnFollow.addEventListener('click', () => {
      follow = !follow;
      btnFollow.classList.toggle('active', follow);
    });

    overlay.appendChild(btnFrame);
    overlay.appendChild(btnFollow);
    container.appendChild(overlay);
  }

  function resize() {
    if (!renderer || !container) return;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
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

  function disposeGroup(group) {
    group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  function laneZ(trackIndex) {
    return -trackIndex * LANE;
  }

  function makeTextSprite(text, cssColor, worldHeight) {
    const fontSize = 40;
    const pad = 10;
    const canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    ctx.font = fontSize + 'px monospace';
    canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
    canvas.height = fontSize + pad * 2;
    ctx = canvas.getContext('2d');
    ctx.font = fontSize + 'px monospace';
    ctx.fillStyle = cssColor;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.scale.set(worldHeight * canvas.width / canvas.height, worldHeight, 1);
    return sprite;
  }

  function srgb(r, g, b) {
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }

  function sectionLabel(section) {
    return section.label
      + (section.totalRepeats > 1 ? ' x' + section.totalRepeats : '')
      + (section.recap ? ' (R)' : '');
  }

  // Recorre el grid creando el InstancedMesh de notas con sus atributos de
  // color y disparo, y llenando hitIndex; placeNote coloca el dummy según el modo
  function buildNotes(placeNote) {
    const range = midiRange(piece.grid);
    const colors = motifColors();
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;

    const noteMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: NOTE_VERTEX,
      fragmentShader: NOTE_FRAGMENT
    });
    shaderMats.push(noteMaterial);

    notesMesh = null;
    if (count === 0) return;

    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), noteMaterial, count);
    const iColor = new Float32Array(count * 3);
    const iHit = new Float32Array(count).fill(-1000);
    const dummy = new THREE.Object3D();
    let i = 0;
    for (let t = 0; t < piece.numTracks; t++) {
      const row = piece.grid[t];
      for (let s = 0; s < piece.totalSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const durationSteps = cell.durationSteps || 1;
        const norm = (cell.midi - range.min) / (range.max - range.min);
        dummy.rotation.set(0, 0, 0);
        placeNote(dummy, cell, t, s, durationSteps, norm);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);

        const color = colors[(cell.motifIndex || 0) % colors.length];
        const brightness = 0.45 + 0.55 * cell.velocity;
        const c = srgb(color[0], color[1], color[2]).multiplyScalar(brightness);
        iColor[i * 3] = c.r;
        iColor[i * 3 + 1] = c.g;
        iColor[i * 3 + 2] = c.b;

        if (!hitIndex.has(s)) hitIndex.set(s, []);
        hitIndex.get(s).push(i);
        i++;
      }
    }
    mesh.geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(iColor, 3));
    hitAttr = new THREE.InstancedBufferAttribute(iHit, 1);
    mesh.geometry.setAttribute('iHit', hitAttr);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.computeBoundingSphere) mesh.computeBoundingSphere();
    else mesh.frustumCulled = false;
    cityGroup.add(mesh);
    notesMesh = mesh;
  }

  function buildScene() {
    if (cityGroup) {
      scene.remove(cityGroup);
      disposeGroup(cityGroup);
    }
    cityGroup = new THREE.Group();
    scene.add(cityGroup);
    hitIndex = new Map();
    cursorStepLast = -1;
    cursorSnap = true;
    spokeGroup = null;
    ringMesh = null;
    tun = null;
    shaderMats = [];
    terrainMat = null;
    hitAttr = null;

    if (mode === 'tunnel') buildTunnel();
    else if (mode === 'terrain') buildTerrain();
    else if (mode === 'stars') buildStars();
    else buildCity();

    // El encuadre del usuario se respeta al regenerar o retonalizar; solo se
    // recoloca la cámara si cambian el modo o las dimensiones de la pieza
    const key = mode + ':' + piece.totalSteps + 'x' + piece.numTracks + 'x' + piece.cellLength;
    if (key !== dimsKey) {
      dimsKey = key;
      if (mode === 'tunnel') {
        insideView = true;
        frameTunnelInside();
      } else {
        // plano inicial cercano: las piezas suelen ser muy largas y el encuadre
        // total las reduce a una línea; «Seguir» recorre la ciudad entera
        const span = Math.min(piece.totalSteps * STEP, 110);
        frameSpan(span, span / 2);
      }
    }
  }

  // ---- Modo ciudad ----

  function buildCity() {
    const width = piece.totalSteps * STEP;
    const depth = (piece.numTracks - 1) * LANE + NOTE_DEPTH;
    const zFront = NOTE_DEPTH / 2 + 0.4;
    const zBack = laneZ(piece.numTracks - 1) - NOTE_DEPTH / 2 - 0.4;
    const colors = motifColors();

    // Suelo
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 30, depth + 26),
      new THREE.MeshBasicMaterial({ color: 0x0d0d18 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, -0.05, laneZ(piece.numTracks - 1) / 2);
    cityGroup.add(floor);

    // Losas de sección alternadas (ámbar si es recapitulación) y su etiqueta
    piece.sections.forEach((section, i) => {
      const sx = section.startStep * STEP;
      const sw = section.lengthSteps * STEP;
      const slabColor = section.recap ? srgb(255, 170, 80) : srgb(108, 99, 255);
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(sw, depth + 2),
        new THREE.MeshBasicMaterial({
          color: slabColor,
          transparent: true,
          opacity: section.recap ? 0.10 : (i % 2 === 0 ? 0.10 : 0.04),
          depthWrite: false
        })
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(sx + sw / 2, 0.01, laneZ(piece.numTracks - 1) / 2);
      cityGroup.add(slab);

      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffaa50' : '#8a83ff', 1.7);
      sprite.position.set(sx + sw / 2, PITCH_H + 3.2, zBack - 1.5);
      cityGroup.add(sprite);
    });

    // Rejilla del suelo: pulsos cada 4 pasos tenues, límites de sección marcados
    const linePos = [];
    const lineCol = [];
    const beatColor = srgb(24, 24, 44);
    const sectionColor = srgb(108, 99, 255).multiplyScalar(0.4);
    for (let s = 4; s < piece.totalSteps; s += 4) {
      const isSection = piece.sections.some(sec => sec.startStep === s);
      const c = isSection ? sectionColor : beatColor;
      linePos.push(s * STEP, 0.02, zFront, s * STEP, 0.02, zBack);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    // Carriles: una línea por borde de pista
    const laneColor = srgb(26, 26, 46);
    for (let t = 0; t <= piece.numTracks; t++) {
      const z = laneZ(t) + LANE / 2;
      linePos.push(0, 0.02, z, width, 0.02, z);
      lineCol.push(laneColor.r, laneColor.g, laneColor.b, laneColor.r, laneColor.g, laneColor.b);
    }
    // Arranque de cada bloque, en el color de su motivo (como en la vista 2D)
    if (piece.blockMarkers) {
      for (const block of piece.blockMarkers) {
        const color = colors[block.motifIndex % colors.length];
        const c = srgb(color[0], color[1], color[2]).multiplyScalar(0.45);
        const x = block.startStep * STEP;
        const z = laneZ(block.trackIndex);
        linePos.push(x, 0.03, z - NOTE_DEPTH / 2, x, 0.03, z + NOTE_DEPTH / 2);
        lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Etiquetas de pista
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite('T' + (t + 1), '#6c63ff', 1.3);
      sprite.position.set(-2.2, 1.1, laneZ(t));
      cityGroup.add(sprite);
    }

    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      dummy.position.set((s + durationSteps / 2) * STEP, 0.7 + norm * PITCH_H, laneZ(t));
      dummy.scale.set(Math.max(durationSteps * STEP - 0.16, 0.3), 0.5 + 0.45 * cell.velocity, NOTE_DEPTH);
    });

    // Cursor: lámina translúcida a lo alto y ancho de la ciudad + núcleo brillante
    cursorGroup = new THREE.Group();
    const cursorH = PITCH_H + 2.5;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(STEP, cursorH, depth + 1.5),
      new THREE.MeshBasicMaterial({
        color: 0xff3333, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, cursorH, depth + 1.5),
      new THREE.MeshBasicMaterial({
        color: 0xff6666, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(slab);
    cursorGroup.add(core);
    cursorGroup.position.set(0.5 * STEP, cursorH / 2, laneZ(piece.numTracks - 1) / 2);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo túnel ----

  // Ángulo y avance axial de un paso (continuos: la hélice no se reinicia)
  function tunnelTheta(step) {
    return 2 * Math.PI * step / piece.cellLength;
  }

  function tunnelX(step) {
    return TURN_PITCH * step / piece.cellLength;
  }

  function buildTunnel() {
    const L = piece.cellLength;
    const R0 = Math.max(6, ARC * L / (2 * Math.PI));
    const rOuter = R0 + (piece.numTracks - 1) * BAND + PITCH_R;
    const rMid = R0 + ((piece.numTracks - 1) * BAND + PITCH_R) / 2;
    const lenX = tunnelX(piece.totalSteps);
    tun = { L, R0, rOuter, rMid, lenX };

    // Aro y etiqueta al arranque de cada sección (ámbar si es recapitulación)
    const ringGeo = new THREE.TorusGeometry(rOuter + 0.6, 0.09, 8, 64);
    piece.sections.forEach(section => {
      const x = tunnelX(section.startStep);
      const color = section.recap ? 0xffaa50 : 0x6c63ff;
      const ring = new THREE.Mesh(
        ringGeo.clone(),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = x;
      cityGroup.add(ring);

      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffaa50' : '#8a83ff', 2.0);
      sprite.position.set(x + 0.8, -R0 * 0.35, 0);
      cityGroup.add(sprite);
    });
    ringGeo.dispose();

    // Etiquetas de pista en la boca del túnel, una por banda radial
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite('T' + (t + 1), '#6c63ff', 1.5);
      sprite.position.set(-1.6, R0 + t * BAND + PITCH_R / 2, 0);
      cityGroup.add(sprite);
    }

    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      const th = tunnelTheta(s + durationSteps / 2);
      // la altura recorre el interior de la banda de su pista: aguda hacia el eje
      const r = R0 + t * BAND + (1 - norm) * PITCH_R;
      const arcStep = 2 * Math.PI * r / L;
      dummy.position.set(tunnelX(s + durationSteps / 2), r * Math.cos(th), r * Math.sin(th));
      dummy.rotation.set(th, 0, 0);
      dummy.scale.set(1.3, 0.5 + 0.45 * cell.velocity, Math.max(durationSteps * arcStep - 0.15, 0.25));
    });

    // Cursor: radio luminoso que gira con la hélice + aro que avanza por el eje
    cursorGroup = new THREE.Group();
    spokeGroup = new THREE.Group();
    const radialSpan = (piece.numTracks - 1) * BAND + PITCH_R + 3;
    const arcMid = 2 * Math.PI * rMid / L;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, radialSpan, arcMid * 1.6),
      new THREE.MeshBasicMaterial({
        color: 0xff3333, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, radialSpan, 0.18),
      new THREE.MeshBasicMaterial({
        color: 0xff6666, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    spokeGroup.add(slab);
    spokeGroup.add(core);
    cursorGroup.add(spokeGroup);

    ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(rOuter + 0.3, 0.06, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff4444, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ringMesh.rotation.y = Math.PI / 2;
    cursorGroup.add(ringMesh);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo terreno ----

  // Hash determinista en [0,1): el mismo terreno en cada rebuild y retune
  function hash2(a, b) {
    const n = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  function buildTerrain() {
    const range = midiRange(piece.grid);
    const colors = motifColors();
    const W = piece.totalSteps;
    const depth = piece.numTracks * T_BAND;

    // Altura y color por pista y columna de vértices; el suavizado en X
    // convierte los escalones de las notas en colinas
    const H = [];
    const C = [];
    for (let t = 0; t < piece.numTracks; t++) {
      const raw = new Float32Array(W + 1);
      const colRow = new Array(W + 1);
      for (let ix = 0; ix <= W; ix++) {
        const cell = piece.grid[t][Math.min(ix, W - 1)];
        if (cell) {
          const norm = (cell.midi - range.min) / (range.max - range.min);
          raw[ix] = 1.6 + norm * 4.6 + cell.velocity * 1.6;
          const mc = colors[(cell.motifIndex || 0) % colors.length];
          colRow[ix] = srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.45 + 0.55 * cell.velocity);
        } else {
          // suelo base: los silencios son valles, no abismos, y el paisaje conecta
          raw[ix] = 0.5;
          colRow[ix] = srgb(26, 30, 52);
        }
      }
      for (let pass = 0; pass < 3; pass++) {
        const prev = raw.slice();
        for (let ix = 0; ix <= W; ix++) {
          raw[ix] = prev[Math.max(0, ix - 1)] * 0.22 + prev[ix] * 0.56 + prev[Math.min(W, ix + 1)] * 0.22;
        }
      }
      H.push(raw);
      C.push(colRow);
    }

    // Tinte por sección: bandas alternadas, mezcla ámbar en la recapitulación
    const amber = srgb(255, 170, 80);
    const tint = new Array(W + 1).fill(1);
    piece.sections.forEach((section, i) => {
      const end = Math.min(section.startStep + section.lengthSteps, W);
      for (let s = section.startStep; s < end; s++) {
        tint[s] = section.recap ? 'recap' : (i % 2 === 0 ? 1 : 0.86);
      }
    });
    tint[W] = tint[W - 1];

    const rowsZ = piece.numTracks * T_ROWS + 1;
    const vertsX = W + 1;
    const positions = new Float32Array(vertsX * rowsZ * 3);
    const aColor = new Float32Array(vertsX * rowsZ * 3);
    const tmp = new THREE.Color();
    let v = 0;
    for (let iz = 0; iz < rowsZ; iz++) {
      const t = Math.min(Math.floor(iz / T_ROWS), piece.numTracks - 1);
      const u = (iz - t * T_ROWS) / T_ROWS;
      const bell = Math.pow(Math.sin(u * Math.PI), 1.4);
      const z = -(iz / (rowsZ - 1)) * depth;
      for (let ix = 0; ix < vertsX; ix++) {
        positions[v * 3] = ix * STEP;
        positions[v * 3 + 1] = H[t][ix] * bell + (hash2(ix, iz) - 0.5) * 0.35;
        positions[v * 3 + 2] = z;
        tmp.copy(C[t][ix]).multiplyScalar(0.20 + 0.80 * bell);
        const tv = tint[ix];
        if (tv === 'recap') tmp.lerp(amber, 0.18);
        else tmp.multiplyScalar(tv);
        aColor[v * 3] = tmp.r;
        aColor[v * 3 + 1] = tmp.g;
        aColor[v * 3 + 2] = tmp.b;
        v++;
      }
    }
    const index = [];
    for (let iz = 0; iz < rowsZ - 1; iz++) {
      for (let ix = 0; ix < vertsX - 1; ix++) {
        const a = iz * vertsX + ix;
        const b = a + 1;
        const c = a + vertsX;
        const d = c + 1;
        index.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();

    terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density },
        uCursorX: { value: 0 },
        uCursorOn: { value: 0 }
      },
      vertexShader: TERRAIN_VERTEX,
      fragmentShader: TERRAIN_FRAGMENT,
      side: THREE.DoubleSide
    });
    shaderMats.push(terrainMat);
    cityGroup.add(new THREE.Mesh(geo, terrainMat));

    // Etiquetas de sección y de pista
    piece.sections.forEach(section => {
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffaa50' : '#8a83ff', 1.7);
      sprite.position.set((section.startStep + section.lengthSteps / 2) * STEP, 9.5, -depth - 2);
      cityGroup.add(sprite);
    });
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite('T' + (t + 1), '#6c63ff', 1.3);
      sprite.position.set(-2.2, 1.4, -(t + 0.5) * T_BAND);
      cityGroup.add(sprite);
    }

    // Cursor: haz cálido vertical; el resplandor del frente de onda que recorre
    // las crestas lo pinta el shader del terreno alrededor de uCursorX
    cursorGroup = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 11, depth + 4),
      new THREE.MeshBasicMaterial({
        color: 0xff8855, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(beam);
    cursorGroup.position.set(0.5, 5.5, -depth / 2);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo constelación ----

  function makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function buildStars() {
    const range = midiRange(piece.grid);
    const colors = motifColors();
    const centerZ = -(piece.numTracks - 1) * S_LANE / 2;
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;

    const positions = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 3);
    const aHit = new Float32Array(count).fill(-1000);
    const aSize = new Float32Array(count);
    const aSeed = new Float32Array(count);
    const linePos = [];
    const lineCol = [];

    let i = 0;
    for (let t = 0; t < piece.numTracks; t++) {
      const row = piece.grid[t];
      const blockStarts = new Set(
        (piece.blockMarkers || []).filter(b => b.trackIndex === t).map(b => b.startStep)
      );
      let prev = null;
      for (let s = 0; s < piece.totalSteps; s++) {
        if (blockStarts.has(s)) prev = null;   // la constelación se corta entre bloques
        const cell = row[s];
        if (!cell) continue;
        const durationSteps = cell.durationSteps || 1;
        const norm = (cell.midi - range.min) / (range.max - range.min);
        // jitter determinista: cielo estrellado en vez de retícula
        const x = (s + durationSteps / 2) * STEP;
        const y = 1 + norm * S_H + (hash2(s, t + 40) - 0.5) * 0.8;
        const z = -t * S_LANE + (hash2(s, t) - 0.5) * 2.2;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        const mc = colors[(cell.motifIndex || 0) % colors.length];
        const c = srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.5 + 0.5 * cell.velocity);
        aColor[i * 3] = c.r;
        aColor[i * 3 + 1] = c.g;
        aColor[i * 3 + 2] = c.b;
        aSize[i] = cell.velocity;
        aSeed[i] = hash2(s, t + 80);

        if (!hitIndex.has(s)) hitIndex.set(s, []);
        hitIndex.get(s).push(i);

        if (prev) {
          linePos.push(prev.x, prev.y, prev.z, x, y, z);
          lineCol.push(prev.c.r * 0.45, prev.c.g * 0.45, prev.c.b * 0.45, c.r * 0.45, c.g * 0.45, c.b * 0.45);
        }
        prev = { x, y, z, c };
        i++;
      }
    }

    // Estrellas y ondas comparten posición y atributo de disparo: un solo
    // estampado en setCursor enciende flare y onda expansiva a la vez
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(aColor, 3);
    hitAttr = new THREE.BufferAttribute(aHit, 1);

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', posAttr);
    starGeo.setAttribute('aColor', colAttr);
    starGeo.setAttribute('aHit', hitAttr);
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    shaderMats.push(starMat);
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    cityGroup.add(stars);

    const rippleGeo = new THREE.BufferGeometry();
    rippleGeo.setAttribute('position', posAttr);
    rippleGeo.setAttribute('aColor', colAttr);
    rippleGeo.setAttribute('aHit', hitAttr);
    const rippleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: RIPPLE_VERTEX,
      fragmentShader: RIPPLE_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    shaderMats.push(rippleMat);
    const ripples = new THREE.Points(rippleGeo, rippleMat);
    ripples.frustumCulled = false;
    cityGroup.add(ripples);

    // Constelaciones: los bloques de un mismo motivo, enlazados nota a nota
    if (linePos.length) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
      lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
      cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false
      })));
    }

    // Secciones como nebulosas difusas + etiqueta
    const glowTex = makeGlowTexture();
    piece.sections.forEach(section => {
      const cx = (section.startStep + section.lengthSteps / 2) * STEP;
      const neb = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.13,
        color: section.recap ? 0xffaa50 : 0x6c63ff
      }));
      neb.scale.set(section.lengthSteps * STEP * 0.9, S_H * 1.9, 1);
      neb.position.set(cx, S_H * 0.5, centerZ);
      cityGroup.add(neb);

      const label = makeTextSprite(sectionLabel(section), section.recap ? '#ffaa50' : '#8a83ff', 1.7);
      label.position.set(cx, S_H + 4, -(piece.numTracks - 1) * S_LANE - 4);
      cityGroup.add(label);
    });
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite('T' + (t + 1), '#6c63ff', 1.3);
      sprite.position.set(-3, 1.2, -t * S_LANE);
      cityGroup.add(sprite);
    }

    // Cursor: lámina translúcida como en la ciudad, a la altura del cielo
    cursorGroup = new THREE.Group();
    const depth = (piece.numTracks - 1) * S_LANE + 10;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(STEP, S_H + 8, depth),
      new THREE.MeshBasicMaterial({
        color: 0xff3333, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, S_H + 8, depth),
      new THREE.MeshBasicMaterial({
        color: 0xff6666, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(slab);
    cursorGroup.add(core);
    cursorGroup.position.set(0.5 * STEP, S_H / 2 + 1, centerZ);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Encuadres ----

  function frameSphere(center, radius, dirVec) {
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = 1.05 * radius / Math.sin(Math.min(vFov, hFov) / 2);

    camera.position.copy(center).addScaledVector(dirVec.clone().normalize(), dist);
    camera.near = Math.max(0.1, dist / 100);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();

    // Neblina proporcional a la distancia de cámara: un velo al fondo, no un muro
    setFogDensity(0.3 / dist);
  }

  function setFogDensity(density) {
    scene.fog.density = density;
    for (const m of shaderMats) {
      if (m.uniforms.uFogDensity) m.uniforms.uFogDensity.value = density;
    }
  }

  // Dimensiones transversales de los modos axiales (todos menos el túnel)
  function axialDims() {
    if (mode === 'terrain') {
      const depth = piece.numTracks * T_BAND;
      return { depth, midY: 2.5, centerZ: -depth / 2, vertical: 9 };
    }
    if (mode === 'stars') {
      const depth = (piece.numTracks - 1) * S_LANE + 10;
      return { depth, midY: S_H / 2, centerZ: -(piece.numTracks - 1) * S_LANE / 2, vertical: S_H };
    }
    return {
      depth: (piece.numTracks - 1) * LANE + NOTE_DEPTH,
      midY: PITCH_H * 0.45,
      centerZ: laneZ(piece.numTracks - 1) / 2,
      vertical: PITCH_H
    };
  }

  // Encuadra un tramo de `span` unidades centrado en centerX (modos axiales);
  // con span = ancho total equivale a ver la pieza completa
  function frameSpan(span, centerX) {
    if (!piece || !camera) return;
    const d = axialDims();
    const center = new THREE.Vector3(centerX, d.midY, d.centerZ);
    const radius = Math.sqrt((span / 2) ** 2 + (d.vertical / 2) ** 2 + (d.depth / 2) ** 2);
    frameSphere(center, radius, new THREE.Vector3(0.25, 0.42, 1));
    camera.far = Math.max(camera.far, piece.totalSteps * STEP * 3);
    camera.updateProjectionMatrix();
  }

  function frameFull() {
    if (!piece) return;
    const width = piece.totalSteps * STEP;
    frameSpan(width, width / 2);
  }

  // Interior del túnel: cámara en el eje mirando hacia el fondo; la neblina
  // deja ver unas pocas vueltas por delante
  function frameTunnelInside() {
    if (!piece || !camera || !tun) return;
    const x0 = cursorStepLast >= 0 ? tunnelX(cursorStepLast) : 0;
    camera.position.set(x0 - TURN_PITCH * 1.1, 1.2, 0);
    controls.target.set(x0 + TURN_PITCH * 0.8, 0, 0);
    camera.near = 0.1;
    camera.far = tun.lenX + tun.rOuter * 4 + 100;
    camera.updateProjectionMatrix();
    controls.update();
    setFogDensity(0.5 / (TURN_PITCH * 4));
  }

  // Exterior: la hélice completa vista como un muelle de notas
  function frameTunnelOutside() {
    if (!piece || !camera || !tun) return;
    const center = new THREE.Vector3(tun.lenX / 2, 0, 0);
    const radius = Math.sqrt((tun.lenX / 2) ** 2 + tun.rOuter ** 2);
    frameSphere(center, radius, new THREE.Vector3(0.35, 0.5, 1));
  }

  // ---- Interfaz común ----

  function setMode(m) {
    if (!['city', 'tunnel', 'terrain', 'stars'].includes(m)) return;
    if (m === mode) return;
    mode = m;
    if (piece && renderer) buildScene();
  }

  function renderPiece(p) {
    piece = p;
    if (!renderer) return;
    buildScene();
  }

  function setCursor(step) {
    if (!renderer || !cursorGroup) return;
    if (mode === 'tunnel') {
      cursorTarget.x = tunnelX(step + 0.5);
      cursorTarget.th = tunnelTheta(step + 0.5);
    } else {
      cursorTarget.x = (step + 0.5) * STEP;
    }
    if (cursorSnap) {
      cursorCur.x = cursorTarget.x;
      cursorCur.th = cursorTarget.th;
      cursorSnap = false;
    }
    cursorGroup.visible = true;
    if (terrainMat) terrainMat.uniforms.uCursorOn.value = 1;
    if (step === cursorStepLast) return;
    cursorStepLast = step;
    const hits = hitIndex.get(step);
    if (hits && hitAttr) {
      const now = clock.elapsedTime;
      for (const i of hits) hitAttr.setX(i, now);
      hitAttr.needsUpdate = true;
    }
  }

  function clearCursor() {
    cursorStepLast = -1;
    if (cursorGroup) cursorGroup.visible = false;
    if (terrainMat) terrainMat.uniforms.uCursorOn.value = 0;
  }

  function setActive(on) {
    active = on;
    if (on && renderer && rafId === null) {
      clock.getDelta();  // descarta el tiempo transcurrido inactivo
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick() {
    if (!active || !renderer) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
    const dt = clock.getDelta();

    for (const m of shaderMats) {
      if (m.uniforms.uTime) m.uniforms.uTime.value = clock.elapsedTime;
    }

    if (cursorGroup && cursorGroup.visible) {
      const k = 1 - Math.exp(-dt * 14);
      cursorCur.x += (cursorTarget.x - cursorCur.x) * k;
      cursorCur.th += (cursorTarget.th - cursorCur.th) * k;

      let followX;
      if (mode === 'tunnel' && spokeGroup && tun) {
        spokeGroup.rotation.x = cursorCur.th;
        spokeGroup.position.set(cursorCur.x, tun.rMid * Math.cos(cursorCur.th), tun.rMid * Math.sin(cursorCur.th));
        ringMesh.position.x = cursorCur.x;
        followX = cursorCur.x + TURN_PITCH * 0.4;
      } else {
        cursorGroup.position.x = cursorCur.x;
        if (terrainMat) terrainMat.uniforms.uCursorX.value = cursorCur.x;
        followX = cursorCur.x;
      }

      // Seguimiento: cámara y objetivo se deslizan por el eje del tiempo con el
      // cursor, conservando el ángulo y la distancia que haya elegido el usuario
      if (follow && cursorStepLast >= 0) {
        const shift = (followX - controls.target.x) * (1 - Math.exp(-dt * 3));
        controls.target.x += shift;
        camera.position.x += shift;
      }
    }

    controls.update();
    composer.render();
  }

  return { init, renderPiece, setCursor, clearCursor, setActive, setMode };
})();
