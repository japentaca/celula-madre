// Vistas 3D de la grilla con THREE.js: trece modos que comparten renderer,
// cursor, destello de las notas al sonar y seguimiento de cámara:
// - «city»: ciudad de notas — tiempo en X, pistas en Z, altura tonal en Y.
// - «tunnel»: túnel helicoidal — una vuelta = una célula, cada pista un
//   anillo concéntrico, cámara por dentro.
// - «terrain»: heightfield con una cresta por pista y frente de onda luminoso.
// - «stars»: cada nota una estrella con onda expansiva; bloques enlazados como
//   constelaciones y secciones como nebulosas.
// - «musicbox»: caja de música — un rodillo por pista que gira una vuelta por
//   célula, un pino por nota (la célula binaria literal) y un peine cuyas púas
//   vibran y brillan al ser empujadas; la pieza entera se extiende a lo largo
//   del rodillo.
// - «fifths»: órbita de quintas — doce faros en círculo (el ciclo de quintas),
//   cada sección una órbita alrededor del faro de su tonalidad, estelas entre
//   secciones y una nave como cursor: el plan tonal precompuesto, visible.
// - «pianola»: rollo de pianola — papel perforado con una banda por pista,
//   cada nota un agujero (largo = duración), un rodillo lector con lámpara
//   que recorre el rollo: los agujeros se encienden al pasar la luz y la
//   proyectan como manchas de color en el suelo.
// - «loom»: telar — cada pista un hilo de urdimbre tenso a lo largo del
//   tiempo que sube y baja con la altura, liso en los tramos ligados y roto en
//   puntadas en los picados (la onda de legato), bloques como tramas de color
//   por motivo y la lanzadera como cursor: la pieza como tapiz que se teje.
// - «strings»: arpa — una cuerda fija por pista que cada nota pulsa (onda
//   estacionaria: amplitud = velocity, nodos = altura, decaimiento = sustain);
//   solo se ve lo que suena; una regla de tiempo con secciones lleva el cursor.
// - «galaxy»: galaxia — vista cenital de la pieza entera enrollada en espiral
//   (radio = tiempo, un brazo por pista, una estrella por nota); un brazo de
//   radar barre como cursor: lo sonado queda cálido, lo por venir frío, y las
//   secciones son anillos de distinta densidad.
// - «garden»: jardín — cada nota una flor (tallo = altura, corola = velocity,
//   especie = motivo, hoja = duración) sobre parterres por sección; las flores
//   brotan al llegar el cursor, se marchitan con el tiempo y la recapitulación
//   florece en ámbar.
// - «swarm»: enjambre — una bandada (boids simulados por CPU en cada frame)
//   por pista: vuela a la altura de su melodía, se compacta con la densidad de
//   ataques, cada nota la sacude y destella, y el silencio la dispersa; cruza
//   la caja durante la pieza. No dibuja la pieza: la habita.
// - «mobius»: cinta de Möbius — la pieza entera impresa en una vuelta de la
//   cinta, pistas a lo ancho; la cámara la recorre en raíl y, como el plan
//   tonal, termina donde empezó, pero por la otra cara.
// Implementa la misma interfaz que Visualizer (renderPiece/setCursor/
// clearCursor) más setMode/setActive; App conmuta con el selector «Vista».
//
// Es el único módulo ESM del proyecto: los addons de THREE (OrbitControls,
// postprocesado) solo se distribuyen como módulos, así que se carga con
// <script type="module"> + importmap y publica su global en window a mano.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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

  // --- Caja de música ---
  const MB_LENGTH_X = 60;  // largo del rodillo: contiene la pieza entera
  const MB_COMB_W = 10;    // banda axial en la que la altura desplaza el pino
  const MB_R = 4;          // radio del rodillo
  const MB_GAP = 12;       // separación entre rodillos (pistas) en Z
  const MB_READ_TH = 0.3;  // ángulo de lectura (desde +Y hacia la cámara): ahí está el peine

  // --- Órbita de quintas ---
  // Faros vecinos distan 2·F_R·sin(15°): la órbita más ancha (8 pistas y varias
  // secciones en el mismo faro) tiene que caber en la mitad de esa cuerda
  const F_R = 72;           // radio del círculo de faros
  const F_ORBIT_R = 8;      // radio base de la órbita de una sección
  const F_TRACK_GAP = 0.7;  // separación radial entre pistas dentro de la órbita
  const F_SHARE_GAP = 1.6;  // radio extra por cada sección anterior en el mismo faro
  const F_H = 10;           // recorrido vertical del rango de alturas
  const F_TOWER_H = 7;      // altura de la torre del faro
  const F_SHARP_NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const F_FLAT_NAMES = ['Do', 'Re♭', 'Re', 'Mi♭', 'Mi', 'Fa', 'Sol♭', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];

  // --- Pianola ---
  const PL_Y = 3.2;          // altura del papel sobre el suelo
  const PL_BAND = 6;         // ancho en Z de la banda de cada pista
  const PL_MARGIN = 3;       // papel sobrante antes y después de la pieza
  const PL_ROLLER_R = 1.4;   // radio del rodillo lector
  const PL_LAMP_Y = PL_Y + 1.6;  // altura de la lámpara sobre el rodillo
  // La mancha de luz de cada agujero se proyecta desde la lámpara: ampliada
  // desde el eje del papel por este factor cae fuera del papel y se ve
  const PL_MAG = PL_LAMP_Y / (PL_LAMP_Y - PL_Y);
  const PL_STEP_SEC = 0.12;  // duración de un paso hasta medirla (125 bpm)

  // --- Telar ---
  const LM_LANE = 3.5;       // separación entre hilos (pistas) en Z
  const LM_H = 10;           // recorrido vertical del rango de alturas
  const LM_BASE = 0.4;       // altura de reposo del hilo en los silencios
  const LM_W = 0.5;          // ancho pleno de la cinta del hilo
  const LM_SUB = 2;          // muestras de la cinta por paso (curva suave entre claves)

  // --- Arpa ---
  const ST_LEN = 40;         // largo de cada cuerda en X (también el de la regla de tiempo)
  const ST_GAP = 2.2;        // separación vertical entre cuerdas (pistas)
  const ST_SEG = 96;         // segmentos por cuerda
  const ST_W = 0.12;         // grosor de la cinta de la cuerda en reposo
  const ST_MAX = 8;          // máximo de pistas: los sliders de pistas de index.html llegan a 8
  const ST_RULER_Y = -2.4;   // altura de la regla de tiempo, bajo la primera cuerda
  const ST_FREQ = 6;         // frecuencia visual base de la vibración (Hz)
  const ST_FREQ_NODE = 0.8;  // Hz extra por nodo: las cuerdas agudas vibran más deprisa

  // --- Galaxia ---
  const G_R0 = 6;            // radio donde arranca la espiral (el núcleo queda dentro)
  const G_PITCH = 1.6;       // avance radial por vuelta, como máximo
  const G_PITCH_MIN = 0.35;  // por debajo, una vuelta abarca varias células
  const G_RMAX = 140;        // radio máximo de la espiral, sea cual sea el largo de la pieza
  const G_H = 6;             // recorrido vertical del rango de alturas (grosor del disco)
  const G_DUST = 1500;       // partículas de polvo de fondo
  const G_ARM_HALF = 0.06;   // semiancho angular (rad) de la cuña del radar

  // --- Jardín ---
  const GD_LANE = 4;         // separación entre hileras (pistas) en Z
  const GD_H = 9;            // recorrido vertical del rango de alturas (largo del tallo)
  const GD_BASE_Y = 0.02;    // altura del suelo de los parterres: pivote del brote
  const GD_JITTER_X = 0.3;   // desorden orgánico de la hilera en X (±)
  const GD_JITTER_Z = 0.9;   // y en Z (±)
  const GD_LEAF_W = 0.35;    // ancho de la hoja
  const GD_BED_INSET = 0.3;  // margen entre parterres contiguos

  // --- Enjambre ---
  // Caja invisible de vuelo: x en [0, SW_W], y en [0, SW_H], z en [−SW_D, 0]
  const SW_W = 60;
  const SW_H = 24;
  const SW_D = 40;
  const SW_PER_TRACK = 120;      // boids por bandada (pista)
  const SW_MAX = 8;              // máximo de pistas: tamaño de los arrays de uniforms
  const SW_NEIGHBORS = 6;        // vecinos por índice a cada lado (12 en total): vecindad barata
  const SW_VMAX = 9;             // velocidad máxima (unidades/s) con la bandada llena
  const SW_VMIN = 1.5;           // velocidad mínima: un boid nunca se queda quieto
  const SW_SEP = 3.0;            // radio de separación con la bandada compacta
  const SW_PULL_MAX = 6;         // distancia a partir de la cual la atracción ya no crece
  const SW_DENSITY_DECAY = 0.92; // EMA de ataques por paso: memoria de ~ una célula
  const SW_DENSITY_REF = 4;      // densidad que cuenta como bandada «llena»
  const SW_KICK = 2.5;           // empujón radial por ataque, × velocity
  const SW_TRAIL = 0.12;         // estela: segundos de vuelo hacia atrás
  const SW_RULER_Z = 4;          // regla de tiempo en el suelo, delante de la caja

  // --- Cinta de Möbius ---
  const MO_SCALE = 0.35;     // fracción del largo natural (STEP por paso) que da la circunferencia
  const MO_R_MIN = 30;       // radio mínimo de la cinta
  const MO_R_MAX = 400;      // y máximo: en piezas largas las notas quedan apretadas
  const MO_LANE = 2.6;       // ancho por pista (la cinta mide numTracks·MO_LANE + 2)
  const MO_SEG_U_MAX = 2048; // segmentos de la cinta a lo largo, como máximo
  const MO_SEG_V = 8;        // segmentos a lo ancho
  const MO_PITCH_SPAN = 0.8; // fracción del carril que recorre la altura tonal
  const MO_CAM_H = 6;        // altura de la cámara en raíl sobre la cara actual
  const MO_LOOK_AHEAD = 8;   // el objetivo en raíl va tantas unidades de arco por delante
  const MO_CAM_BACK = 10;    // y la cámara tantas por detrás
  const MO_EPS = 1e-4;       // paso de las derivadas numéricas de la parametrización

  const FALLBACK_COLORS =[[106, 99, 255], [78, 205, 196], [255, 159, 67]];

  // --- Tasa de render ---
  const IDLE_FRAME_MS = 1000 / 30 - 4;  // margen para el jitter de rAF: 30 fps a 60/120 Hz
  const PLAY_HOLD_MS = 1500;            // tras el último paso: cubre destellos y ondas
  const SETTLE_HOLD_MS = 250;           // tras el último movimiento de cámara
  const MAX_HIT_RANGES = 512;

  let container = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let controls = null;
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
  let mb = null;              // caja de música: material de pinos, rodillos y marcador
  let fif = null;             // órbita de quintas: secciones colocadas, faros y faro activo
  let pl = null;              // pianola: materiales de agujeros y manchas (uStepSec)
  let loomMat = null;         // material de los hilos del telar (brillo que recorre desde uCursorX)
  let st = null;              // arpa: material de las cuerdas y rango de alturas de la pieza
  let gal = null;             // galaxia: geometría de la espiral, material de estrellas, radar y núcleo
  let gd = null;              // jardín: materiales con el brote por uCursorX
  let sw = null;              // enjambre: estado de la simulación (posiciones, velocidades, densidad…)
  let mo = null;              // cinta de Möbius: radio, ancho, material de la cinta y auxiliares del raíl
  let stepSec = PL_STEP_SEC;  // duración real de un paso en segundos, medida entre pasos
  let hitIndex = new Map();   // paso -> índices de instancia que arrancan ahí

  let active = false;
  let rafId = null;
  const cursorCur = { x: 0, th: 0, y: 0, z: 0 };
  const cursorTarget = { x: 0, th: 0, y: 0, z: 0 };
  let cursorSnap = true;      // primer setCursor tras rebuild: sin animación
  let cursorStepLast = -1;
  let follow = true;
  let insideView = true;      // túnel: «Encuadrar» alterna interior/exterior; Möbius: en raíl/vista general
  let dimsKey = '';           // modo+dimensiones de la última pieza encuadrada

  // Reposo vs plena tasa (performance.now): «reproduciendo» = el cursor cambió
  // de paso hace poco; en pausa setCursor repite el mismo paso y no cuenta
  let lastStepAt = -Infinity;
  let lastMotionAt = -Infinity;
  let lastRenderAt = -Infinity;
  let interacting = false;
  let dirty = true;

  function motifColors() {
    return (typeof Visualizer !== 'undefined' && Visualizer.MOTIF_COLORS) || FALLBACK_COLORS;
  }

  function midiRange(grid) {
    if (typeof Visualizer !== 'undefined' && Visualizer.midiRange) return Visualizer.midiRange(grid);
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

  // ---- Shader de la galaxia: las estrellas de la constelación (mismo
  // STAR_FRAGMENT) templadas por el radar: lo ya sonado (aStep ≤ uCursorStep)
  // tira a ámbar, lo por venir a azul frío y más tenue; sin cursor, neutras ----

  const G_STAR_VERTEX = /* glsl */`
    attribute vec3 aColor;
    attribute float aHit;
    attribute float aSize;
    attribute float aSeed;
    attribute float aStep;
    uniform float uTime;
    uniform float uCursorStep;
    uniform float uCursorOn;
    varying vec3 vColor;
    varying float vFlash;
    varying float vSeed;
    varying float vDist;
    void main() {
      float past = step(aStep, uCursorStep);
      vec3 warm = mix(aColor, vec3(1.0, 0.55, 0.16), 0.35);
      vec3 cold = mix(aColor, vec3(0.45, 0.55, 1.0), 0.45) * 0.55;
      vColor = mix(aColor, mix(cold, warm, past), uCursorOn);
      vSeed = aSeed;
      float dt = uTime - aHit;
      vFlash = dt >= 0.0 ? exp(-dt * 3.5) : 0.0;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vDist = length(mv.xyz);
      gl_PointSize = min((6.0 + aSize * 9.0) * (1.0 + 2.5 * vFlash) * (160.0 / vDist), 200.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  // ---- Shaders de la caja de música: los pinos giran con el rodillo de su
  // pista (uRoll, alrededor del eje X en z = iAxisZ) y las púas del peine vibran
  // como ménsulas al dispararse; ambos usan NOTE_FRAGMENT ----

  const MB_PIN_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    attribute float iAxisZ;
    uniform float uRoll;
    varying vec3 vColor;
    varying float vHit;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = iColor;
      vHit = iHit;
      float c = cos(uRoll);
      float s = sin(uRoll);
      mat3 rot = mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
      vec3 p = (instanceMatrix * vec4(position, 1.0)).xyz;
      p.z -= iAxisZ;
      p = rot * p;
      p.z += iAxisZ;
      vec4 world = modelMatrix * vec4(p, 1.0);
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * (rot * (mat3(instanceMatrix) * normal)));
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const MB_TOOTH_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    attribute float iAmp;
    uniform float uTime;
    varying vec3 vColor;
    varying float vHit;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = iColor;
      vHit = iHit;
      float dt = uTime - iHit;
      float wob = dt >= 0.0 ? sin(dt * 42.0) * exp(-dt * 3.0) * iAmp : 0.0;
      // la púa es una ménsula: la raíz (z local negativo) no se mueve, la punta sí
      vec3 up = normalize(instanceMatrix[1].xyz);
      vec4 inst = instanceMatrix * vec4(position, 1.0);
      inst.xyz += up * wob * (0.5 + position.z);
      vec4 world = modelMatrix * inst;
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  // ---- Shaders de la pianola: el agujero es oscuro en reposo y se enciende
  // mientras la luz del lector lo atraviesa (dt < duración · uStepSec), con un
  // destello al arrancar; la mancha del suelo sigue el mismo encendido y se
  // saca del clip cuando está apagada para no rasterizarla ----

  const PL_HOLE_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    attribute float iDur;
    varying vec3 vColor;
    varying float vHit;
    varying float vDur;
    varying vec3 vWorldPos;
    void main() {
      vColor = iColor;
      vHit = iHit;
      vDur = iDur;
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const PL_HOLE_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform float uStepSec;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    varying vec3 vColor;
    varying float vHit;
    varying float vDur;
    varying vec3 vWorldPos;
    void main() {
      float dt = uTime - vHit;
      float flash = dt >= 0.0 ? exp(-dt * 3.0) : 0.0;
      float lit = (dt >= 0.0 && dt < vDur * uStepSec) ? 1.0 : 0.0;
      vec3 col = vColor * 0.08;
      col += (vColor * 1.4 + vec3(0.5)) * (lit + flash * 0.8);
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  const PL_SPOT_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    attribute float iDur;
    uniform float uTime;
    uniform float uStepSec;
    varying vec3 vColor;
    varying float vGlow;
    varying vec2 vUv;
    varying float vDist;
    void main() {
      vColor = iColor;
      vUv = uv;
      float dt = uTime - iHit;
      float flash = dt >= 0.0 ? exp(-dt * 3.0) : 0.0;
      float lit = (dt >= 0.0 && dt < iDur * uStepSec) ? 1.0 : 0.0;
      vGlow = lit + flash * 0.8;
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      vDist = length(mv.xyz);
      gl_Position = vGlow < 0.004 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * mv;
    }
  `;

  const PL_SPOT_FRAGMENT = /* glsl */`
    uniform float uFogDensity;
    varying vec3 vColor;
    varying float vGlow;
    varying vec2 vUv;
    varying float vDist;
    void main() {
      vec2 q = (vUv - 0.5) * 2.0;
      float d2 = dot(q, q);
      float core = exp(-d2 * 6.0);
      float halo = exp(-sqrt(d2) * 3.0) * 0.35;
      vec3 col = (vColor * (core + halo) + vec3(1.0, 0.86, 0.62) * core * 0.3) * vGlow;
      // en aditivo la niebla no se mezcla: atenúa
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
      gl_FragColor = vec4(col * (1.0 - clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  // ---- Shader del telar: la cinta de cada hilo se sombrea como un hilo
  // redondo (normal falsa que gira del borde superior al inferior, aEdge en
  // −1..1), con un brillo cálido que la recorre desde uCursorX ----

  const LM_WARP_VERTEX = /* glsl */`
    attribute vec3 aColor;
    attribute float aEdge;
    varying vec3 vColor;
    varying float vEdge;
    varying vec3 vWorldPos;
    void main() {
      vColor = aColor;
      vEdge = aEdge;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const LM_WARP_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uCursorX;
    uniform float uCursorOn;
    varying vec3 vColor;
    varying float vEdge;
    varying vec3 vWorldPos;
    void main() {
      float e = clamp(vEdge, -1.0, 1.0);
      vec3 n = normalize(vec3(0.0, e, sqrt(max(1.0 - e * e, 0.0))));
      vec3 lightDir = normalize(vec3(0.3, 0.8, 0.6));
      float diff = 0.35 + 0.65 * max(dot(n, lightDir), 0.0);
      vec3 col = vColor * diff;
      // leve respiración a lo largo de la fibra
      col *= 1.0 + 0.05 * sin(uTime * 0.6 + vWorldPos.x * 0.4);
      // brillo de la lanzadera que recorre el hilo
      float g = uCursorOn * exp(-abs(vWorldPos.x - uCursorX) * 0.35);
      col += (vec3(1.0, 0.62, 0.35) * 0.5 + vColor * 1.4) * g;
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
    }
  `;

  // ---- Shader del arpa: cada cuerda es una cinta (aEdge en −1..1 a lo ancho)
  // cuyo estado vive en arrays de uniforms indexados por pista (aTrack); la
  // onda estacionaria entera se calcula aquí a partir del último pulsado ----

  const ST_VERTEX = /* glsl */`
    #define ST_MAX ${ST_MAX}
    #define PI 3.14159265
    attribute float aTrack;
    attribute float aU;
    attribute float aEdge;
    uniform float uTime;
    uniform float uAmp[ST_MAX];
    uniform float uNodes[ST_MAX];
    uniform float uHit[ST_MAX];
    uniform float uDecay[ST_MAX];
    uniform vec3 uColor[ST_MAX];
    varying vec3 vColor;
    varying float vEdge;
    void main() {
      int t = int(aTrack + 0.5);
      float dt = uTime - uHit[t];
      float env = dt >= 0.0 ? exp(-dt * uDecay[t]) : 0.0;
      float energy = uAmp[t] * env;
      float shape = sin(PI * uNodes[t] * aU);
      float f = ${ST_FREQ.toFixed(2)} + uNodes[t] * ${ST_FREQ_NODE.toFixed(2)};
      vec3 p = position;
      p.y += energy * shape * sin(2.0 * PI * f * max(dt, 0.0));
      // la cinta engorda al vibrar: más superficie encendida
      p.y += aEdge * ${(ST_W / 2).toFixed(3)} * (1.0 + 2.5 * energy);
      // reposo gris tenue; al sonar, el color del
      // motivo, más intenso en los vientres de la onda
      vColor = vec3(0.12) * (1.0 - 0.5 * min(energy, 1.0))
        + uColor[t] * energy * (0.8 + 1.6 * abs(shape));
      vEdge = aEdge;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  const ST_FRAGMENT = /* glsl */`
    varying vec3 vColor;
    varying float vEdge;
    void main() {
      // aditivo: el borde se desvanece atenuando el color
      gl_FragColor = vec4(vColor * (1.0 - vEdge * vEdge), 1.0);
    }
  `;

  // ---- Shaders del jardín: NOTE_* con brote por uCursorX y marchitez ----
  // Tallo, corolas y hoja comparten shader: cada parte crece desde la base de
  // su flor (iX, uBaseY, z de la instancia; la matriz del tallo y de la hoja
  // tiene ahí su origen, la de la corola en la punta). En Y escala con el
  // brote; en XZ con un tramo propio de cada parte (uXZMin/uXZFrom): el tallo
  // engorda desde la mitad, la corola solo se abre cuando el tallo ya subió.
  // Sin brote queda un muñón de tallo: la hilera de semillas por venir

  const GD_VERTEX = /* glsl */`
    attribute vec3 iColor;
    attribute float iHit;
    attribute float iX;
    attribute float iAmber;
    uniform float uCursorX;
    uniform float uCursorOn;
    uniform float uBaseY;
    uniform float uXZMin;
    uniform float uXZFrom;
    varying vec3 vColor;
    varying float vHit;
    varying float vAmber;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = iColor;
      vHit = iHit;
      vAmber = iAmber;
      float grow = uCursorOn > 0.5 ? smoothstep(-2.0, 0.0, uCursorX - iX) : 1.0;
      vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vec3 base = vec3(iX, uBaseY, (modelMatrix * instanceMatrix[3]).z);
      float xz = mix(uXZMin, 1.0, smoothstep(uXZFrom, 1.0, grow));
      world.y = base.y + (world.y - base.y) * max(grow, 0.04);
      world.xz = base.xz + (world.xz - base.xz) * xz;
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  // Como NOTE_FRAGMENT, más el tinte ámbar de la recapitulación y la
  // marchitez: desde el disparo, 20 s hasta apagarse un 25 % hacia pardo
  const GD_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform vec3 uAmber;
    varying vec3 vColor;
    varying float vHit;
    varying float vAmber;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) n = -n;
      vec3 lightDir = normalize(vec3(0.35, 0.85, 0.45));
      float diff = 0.4 + 0.6 * max(dot(n, lightDir), 0.0);
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - clamp(abs(dot(n, viewDir)), 0.0, 1.0), 2.5);
      float dt = uTime - vHit;
      float flash = dt >= 0.0 ? exp(-dt * 4.5) : 0.0;
      float wither = vHit > -500.0 ? 0.25 * clamp(dt / 20.0, 0.0, 1.0) : 0.0;
      vec3 base = mix(vColor, uAmber * max(max(vColor.r, vColor.g), vColor.b), vAmber * 0.6);
      base = mix(base, vec3(0.35, 0.3, 0.25) * 0.5, wither);
      vec3 col = base * (diff * 0.85 + fresnel * 0.7);
      col += (base * 1.6 + vec3(0.9)) * flash;
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      col = mix(col, uFogColor, clamp(fog, 0.0, 1.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // ---- Shaders del enjambre: los boids son Points como las estrellas de la
  // constelación (núcleo gaussiano + halo, aditivo, sin niebla), pero color,
  // tamaño y destello son por bandada: arrays de uniforms indexados por aTrack
  // (como el arpa), así un ataque o un cambio de color no toca atributos.
  // Las estelas comparten esos uniforms ----

  const SW_VERTEX = /* glsl */`
    #define SW_MAX ${SW_MAX}
    attribute float aTrack;
    attribute float aSeed;
    uniform float uTime;
    uniform float uHit[SW_MAX];
    uniform float uSize[SW_MAX];
    uniform vec3 uColor[SW_MAX];
    varying vec3 vColor;
    varying float vFlash;
    varying float vSeed;
    void main() {
      int t = int(aTrack + 0.5);
      vColor = uColor[t];
      vSeed = aSeed;
      // destello escalonado por boid: la bandada chisporrotea, no parpadea en bloque
      float dt = uTime - uHit[t] - aSeed * 0.08;
      vFlash = dt >= 0.0 ? exp(-dt * 4.0) : 0.0;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float dist = max(length(mv.xyz), 0.1);
      gl_PointSize = min((2.0 + uSize[t] * 4.0) * (0.7 + 0.6 * aSeed) * (1.0 + 1.2 * vFlash) * (160.0 / dist), 48.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const SW_FRAGMENT = /* glsl */`
    uniform float uTime;
    varying vec3 vColor;
    varying float vFlash;
    varying float vSeed;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      // Cientos de puntos aditivos apilados en una bandada compacta saturan en
      // una mancha: núcleo estrecho, halo mínimo y poca intensidad por boid
      float core = exp(-d * d * 9.0);
      float halo = exp(-d * 4.0) * 0.08;
      float twinkle = 0.85 + 0.15 * sin(uTime * 3.0 + vSeed * 6.2832);
      vec3 col = vColor * (core + halo) * twinkle * 0.28;
      col += (vec3(0.6) * core + vColor * halo) * vFlash * 0.8;
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  // Estela: segmento de la posición actual (aTail = 0) hacia atrás por la
  // velocidad (aTail = 1), que se apaga hacia la cola
  const SW_TRAIL_VERTEX = /* glsl */`
    #define SW_MAX ${SW_MAX}
    attribute float aTrack;
    attribute float aTail;
    uniform float uTime;
    uniform float uHit[SW_MAX];
    uniform vec3 uColor[SW_MAX];
    varying vec3 vColor;
    void main() {
      int t = int(aTrack + 0.5);
      float dt = uTime - uHit[t];
      float flash = dt >= 0.0 ? exp(-dt * 4.0) : 0.0;
      vColor = uColor[t] * (1.0 - aTail) * (0.10 + 0.25 * flash);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const SW_TRAIL_FRAGMENT = /* glsl */`
    varying vec3 vColor;
    void main() {
      gl_FragColor = vec4(vColor, 1.0);
    }
  `;

  // ---- Shader de la cinta de Möbius: lambert de dos caras + resplandor del
  // cursor por distancia angular en u (la cinta es cerrada: el final brilla
  // junto al principio) ----

  const MOBIUS_VERTEX = /* glsl */`
    attribute vec3 aColor;
    attribute float aU;
    varying vec3 vColor;
    varying float vU;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vColor = aColor;
      vU = aU;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorldPos = world.xyz;
      vNormal = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const MOBIUS_FRAGMENT = /* glsl */`
    uniform float uTime;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uCursorU;
    uniform float uCursorOn;
    uniform float uGlowK;
    varying vec3 vColor;
    varying float vU;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    const float TAU = 6.28318530718;
    float angDiff(float a, float b) {
      float d = mod(abs(a - b), TAU);
      return min(d, TAU - d);
    }
    void main() {
      vec3 n = normalize(vNormal);
      vec3 lightDir = normalize(vec3(0.3, 0.8, 0.5));
      // las dos caras se iluminan igual: la normal cambia de signo con la torsión
      float diff = 0.35 + 0.65 * abs(dot(n, lightDir));
      vec3 col = vColor * diff;
      col *= 1.0 + 0.05 * sin(uTime * 0.7 + vU * 40.0);
      float g = uCursorOn * exp(-angDiff(vU, uCursorU) * uGlowK);
      col += (vec3(1.0, 0.62, 0.35) * 0.45 + vColor * 1.3) * g;
      float dist = distance(vWorldPos, cameraPosition);
      float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
      gl_FragColor = vec4(mix(col, uFogColor, clamp(fog, 0.0, 1.0)), 1.0);
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
    scene.background = new THREE.Color(0x0b0b0d);
    scene.fog = new THREE.FogExp2(0x0b0b0d, 0.004);

    camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(30, 20, 40);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // 'change' también lo emiten el damping y los movimientos programáticos
    controls.addEventListener('start', () => { interacting = true; });
    controls.addEventListener('end', () => { interacting = false; lastMotionAt = performance.now(); });
    controls.addEventListener('change', () => { lastMotionAt = performance.now(); });

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
    btnFrame.title = 'Ver la pieza entera; en el túnel alterna interior/exterior y en la cinta de Möbius, vista general/en raíl';
    btnFrame.addEventListener('click', () => {
      if (mode === 'tunnel') {
        insideView = !insideView;
        if (insideView) frameTunnelInside();
        else frameTunnelOutside();
      } else if (mode === 'fifths') {
        frameFifths();
      } else if (mode === 'strings') {
        frameStrings();
      } else if (mode === 'galaxy') {
        frameGalaxy();
      } else if (mode === 'swarm') {
        frameSwarm();
      } else if (mode === 'mobius') {
        insideView = !insideView;
        if (insideView) frameMobiusRail();
        else frameMobius();
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
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    dirty = true;
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
    ctx.font = '500 ' + fontSize + 'px "JetBrains Mono", ui-monospace, monospace';
    canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
    canvas.height = fontSize + pad * 2;
    ctx = canvas.getContext('2d');
    ctx.font = '500 ' + fontSize + 'px "JetBrains Mono", ui-monospace, monospace';
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
      + (section.totalRepeats > 1 ? ' ×' + section.totalRepeats : '')
      + (section.recap ? ' · recap' : '');
  }

  // Recorre el grid creando el InstancedMesh de notas con sus atributos de
  // color y disparo, y llenando hitIndex; placeNote coloca el dummy según el
  // modo. Un modo puede traer su propio material (con uniforms uTime/uFog*)
  function buildNotes(placeNote, material) {
    const range = midiRange(piece.grid);
    const colors = motifColors();
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;

    const noteMaterial = material || new THREE.ShaderMaterial({
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
    // el enjambre sobrevive al rebuild (retune, pieza nueva): las bandadas
    // siguen volando desde donde estaban en vez de reaparecer
    const prevSwarm = sw;
    sw = null;
    hitIndex = new Map();
    cursorStepLast = -1;
    cursorSnap = true;
    spokeGroup = null;
    ringMesh = null;
    tun = null;
    mb = null;
    fif = null;
    pl = null;
    shaderMats = [];
    terrainMat = null;
    loomMat = null;
    st = null;
    gal = null;
    gd = null;
    mo = null;
    hitAttr = null;
    dirty = true;

    if (mode === 'tunnel') buildTunnel();
    else if (mode === 'terrain') buildTerrain();
    else if (mode === 'stars') buildStars();
    else if (mode === 'musicbox') buildMusicbox();
    else if (mode === 'fifths') buildFifths();
    else if (mode === 'pianola') buildPianola();
    else if (mode === 'loom') buildLoom();
    else if (mode === 'strings') buildStrings();
    else if (mode === 'galaxy') buildGalaxy();
    else if (mode === 'garden') buildGarden();
    else if (mode === 'swarm') buildSwarm(prevSwarm);
    else if (mode === 'mobius') buildMobius();
    else buildCity();

    // El encuadre del usuario se respeta al regenerar o retonalizar; solo se
    // recoloca la cámara si cambian el modo o las dimensiones de la pieza
    const key = mode + ':' + piece.totalSteps + 'x' + piece.numTracks + 'x' + piece.cellLength;
    if (key !== dimsKey) {
      dimsKey = key;
      if (mode === 'tunnel') {
        insideView = true;
        frameTunnelInside();
      } else if (mode === 'musicbox') {
        // el rodillo es corto: cabe entero
        frameSpan(MB_LENGTH_X + 6, MB_LENGTH_X / 2);
      } else if (mode === 'fifths') {
        frameFifths();
      } else if (mode === 'strings') {
        frameStrings();
      } else if (mode === 'galaxy') {
        frameGalaxy();
      } else if (mode === 'swarm') {
        frameSwarm();
      } else if (mode === 'mobius') {
        insideView = mo.hadCursor;
        if (insideView) frameMobiusRail();
        else frameMobius();
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
      new THREE.MeshBasicMaterial({ color: 0x111114 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, -0.05, laneZ(piece.numTracks - 1) / 2);
    cityGroup.add(floor);

    // Losas de sección alternadas (ámbar si es recapitulación) y su etiqueta
    piece.sections.forEach((section, i) => {
      const sx = section.startStep * STEP;
      const sw = section.lengthSteps * STEP;
      const slabColor = section.recap ? srgb(255, 181, 71) : srgb(200, 198, 192);
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(sw, depth + 2),
        new THREE.MeshBasicMaterial({
          color: slabColor,
          transparent: true,
          opacity: section.recap ? 0.07 : (i % 2 === 0 ? 0.05 : 0.02),
          depthWrite: false
        })
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(sx + sw / 2, 0.01, laneZ(piece.numTracks - 1) / 2);
      cityGroup.add(slab);

      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      sprite.position.set(sx + sw / 2, PITCH_H + 3.2, zBack - 1.5);
      cityGroup.add(sprite);
    });

    // Rejilla del suelo: pulsos cada 4 pasos tenues, límites de sección marcados
    const linePos = [];
    const lineCol = [];
    const beatColor = srgb(30, 30, 34);
    const sectionColor = srgb(200, 198, 192).multiplyScalar(0.3);
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
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
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
        color: 0xff5a4e, transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, cursorH, depth + 1.5),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
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
      const color = section.recap ? 0xffb547 : 0x8f8d87;
      const ring = new THREE.Mesh(
        ringGeo.clone(),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = x;
      cityGroup.add(ring);

      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 2.0);
      sprite.position.set(x + 0.8, -R0 * 0.35, 0);
      cityGroup.add(sprite);
    });
    ringGeo.dispose();

    // Etiquetas de pista en la boca del túnel, una por banda radial
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.5);
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
        color: 0xff5a4e, transparent: true, opacity: 0.12,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, radialSpan, 0.18),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    spokeGroup.add(slab);
    spokeGroup.add(core);
    cursorGroup.add(spokeGroup);

    ringMesh = new THREE.Mesh(
      new THREE.TorusGeometry(rOuter + 0.3, 0.06, 8, 64),
      new THREE.MeshBasicMaterial({
        color: 0xff5a4e, transparent: true, opacity: 0.35,
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
    const amber = srgb(255, 181, 71);
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
    const IndexArray = vertsX * rowsZ > 65535 ? Uint32Array : Uint16Array;
    const index = new IndexArray((rowsZ - 1) * (vertsX - 1) * 6);
    let k = 0;
    for (let iz = 0; iz < rowsZ - 1; iz++) {
      for (let ix = 0; ix < vertsX - 1; ix++) {
        const a = iz * vertsX + ix;
        const b = a + 1;
        const c = a + vertsX;
        const d = c + 1;
        index[k++] = a; index[k++] = c; index[k++] = b;
        index[k++] = b; index[k++] = c; index[k++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
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
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      sprite.position.set((section.startStep + section.lengthSteps / 2) * STEP, 9.5, -depth - 2);
      cityGroup.add(sprite);
    });
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
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

  // Estrellas (Points con el material dado) y ondas expansivas: comparten
  // posición y atributo de disparo, así un solo estampado en setCursor
  // enciende flare y onda a la vez. Asigna hitAttr; `extra` añade atributos
  // propios del material de las estrellas
  function addStarField(positions, aColor, aSize, aSeed, starMat, extra) {
    const posAttr = new THREE.BufferAttribute(positions, 3);
    const colAttr = new THREE.BufferAttribute(aColor, 3);
    hitAttr = new THREE.BufferAttribute(new Float32Array(aSize.length).fill(-1000), 1);

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', posAttr);
    starGeo.setAttribute('aColor', colAttr);
    starGeo.setAttribute('aHit', hitAttr);
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    starGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    for (const name in extra || {}) starGeo.setAttribute(name, extra[name]);
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
  }

  function buildStars() {
    const range = midiRange(piece.grid);
    const colors = motifColors();
    const centerZ = -(piece.numTracks - 1) * S_LANE / 2;
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;

    const positions = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 3);
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

    addStarField(positions, aColor, aSize, aSeed, new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));

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
        color: section.recap ? 0xffb547 : 0x6c63ff
      }));
      neb.scale.set(section.lengthSteps * STEP * 0.9, S_H * 1.9, 1);
      neb.position.set(cx, S_H * 0.5, centerZ);
      cityGroup.add(neb);

      const label = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      label.position.set(cx, S_H + 4, -(piece.numTracks - 1) * S_LANE - 4);
      cityGroup.add(label);
    });
    for (let t = 0; t < piece.numTracks; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
      sprite.position.set(-3, 1.2, -t * S_LANE);
      cityGroup.add(sprite);
    }

    // Cursor: lámina translúcida como en la ciudad, a la altura del cielo
    cursorGroup = new THREE.Group();
    const depth = (piece.numTracks - 1) * S_LANE + 10;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(STEP, S_H + 8, depth),
      new THREE.MeshBasicMaterial({
        color: 0xff5a4e, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, S_H + 8, depth),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(slab);
    cursorGroup.add(core);
    cursorGroup.position.set(0.5 * STEP, S_H / 2 + 1, centerZ);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo caja de música ----

  // Posición axial de un paso: la pieza entera cabe en el rodillo dejando media
  // banda de peine a cada extremo para el desplazamiento por altura
  function mbX(step) {
    return (step / piece.totalSteps) * (MB_LENGTH_X - MB_COMB_W) + MB_COMB_W / 2;
  }

  function buildMusicbox() {
    const L = piece.cellLength;
    const R = MB_R;
    const nT = piece.numTracks;
    const zBack = -(nT - 1) * MB_GAP;
    const colors = motifColors();
    const trackZ = t => -t * MB_GAP;
    const arcStep = 2 * Math.PI * R / L;
    const Rc = R + 1.05;   // radio de la lámina del peine: las púas rozan los pinos más largos

    // Rodillos y peines son metal estándar y necesitan luces (los demás modos
    // iluminan en sus propios shaders)
    cityGroup.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(-25, 45, 40);
    cityGroup.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(MB_LENGTH_X + 30, -zBack + 2 * MB_GAP + 10),
      new THREE.MeshBasicMaterial({ color: 0x111114 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(MB_LENGTH_X / 2, -R - 1.5, zBack / 2);
    cityGroup.add(floor);

    // Un rodillo por pista con su eje; unas costuras axiales delatan el giro
    // (el cilindro liso rotando no se vería moverse)
    const rollerGeo = new THREE.CylinderGeometry(R, R, MB_LENGTH_X + 1.5, 48, 1);
    rollerGeo.rotateZ(Math.PI / 2);
    const axleGeo = new THREE.CylinderGeometry(0.4, 0.4, MB_LENGTH_X + 7, 12, 1);
    axleGeo.rotateZ(Math.PI / 2);
    const rollerMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.85, roughness: 0.45 });
    const axleMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, metalness: 0.9, roughness: 0.35 });
    const seamPos = [];
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const y = (R + 0.01) * Math.cos(a);
      const z = (R + 0.01) * Math.sin(a);
      seamPos.push(-MB_LENGTH_X / 2 - 0.75, y, z, MB_LENGTH_X / 2 + 0.75, y, z);
    }
    const seamGeo = new THREE.BufferGeometry();
    seamGeo.setAttribute('position', new THREE.Float32BufferAttribute(seamPos, 3));
    const seamMat = new THREE.LineBasicMaterial({ color: 0x15151a });
    const rollers = [];
    for (let t = 0; t < nT; t++) {
      const roller = new THREE.Mesh(rollerGeo, rollerMat);
      roller.position.set(MB_LENGTH_X / 2, 0, trackZ(t));
      roller.add(new THREE.LineSegments(seamGeo, seamMat));
      cityGroup.add(roller);
      rollers.push(roller);
      const axle = new THREE.Mesh(axleGeo, axleMat);
      axle.position.copy(roller.position);
      cityGroup.add(axle);
    }

    // Peine: lámina tangente al rodillo en el ángulo de lectura. Las púas (una
    // por nota, InstancedMesh aparte) son ménsulas desde esa lámina hacia el
    // lado por donde llegan los pinos, y vibran al dispararse
    const spineGeo = new THREE.BoxGeometry(MB_LENGTH_X + 2, 0.22, 0.5);
    const spineMat = new THREE.MeshStandardMaterial({ color: 0x3a3a42, metalness: 0.8, roughness: 0.4 });
    for (let t = 0; t < nT; t++) {
      const comb = new THREE.Group();
      comb.position.set(MB_LENGTH_X / 2, Rc * Math.cos(MB_READ_TH), trackZ(t) + Rc * Math.sin(MB_READ_TH));
      comb.rotation.x = MB_READ_TH;
      const spine = new THREE.Mesh(spineGeo, spineMat);
      spine.position.set(0, 0, -1.0);
      comb.add(spine);
      cityGroup.add(comb);
    }

    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;
    const axisZ = new Float32Array(count);
    const toothColor = new Float32Array(count * 3);
    const toothAmp = new Float32Array(count);
    const toothMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: MB_TOOTH_VERTEX,
      fragmentShader: NOTE_FRAGMENT
    });
    shaderMats.push(toothMat);
    const teeth = count ? new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), toothMat, count) : null;
    const steel = srgb(118, 120, 130);
    const tooth = new THREE.Object3D();
    let i = 0;

    // Pinos: el giro del rodillo se aplica en el shader (uRoll), así todas las
    // pistas caben en un solo InstancedMesh aunque cada una gire sobre su eje
    const pinMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density },
        uRoll: { value: 0 }
      },
      vertexShader: MB_PIN_VERTEX,
      fragmentShader: NOTE_FRAGMENT
    });
    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      const x = mbX(s) + (norm - 0.5) * MB_COMB_W;
      const dur = Math.min(durationSteps, 4);
      // ángulo local del pino (su borde de ataque queda en 2π·s/L + lectura);
      // el rodillo gira −2π·(paso+0.5)/L, así el ataque pasa bajo la púa al sonar
      const phi = 2 * Math.PI * (s + dur / 2) / L + MB_READ_TH;
      const len = 0.5 + 0.4 * cell.velocity;
      const r = R + len / 2;
      dummy.position.set(x, r * Math.cos(phi), trackZ(t) + r * Math.sin(phi));
      dummy.rotation.set(phi, 0, 0);
      dummy.scale.set(0.25, len, Math.max(dur * arcStep - 0.1, 0.2));
      axisZ[i] = trackZ(t);

      // púa fija sobre la lámina, justo donde el pino la empujará
      tooth.position.set(x, 0, trackZ(t));
      tooth.rotation.set(MB_READ_TH, 0, 0);
      tooth.translateY(Rc);
      tooth.translateZ(-0.3);
      tooth.scale.set(0.16, 0.08, 1.4);
      tooth.updateMatrix();
      teeth.setMatrixAt(i, tooth.matrix);
      const mc = colors[(cell.motifIndex || 0) % colors.length];
      const c = steel.clone().lerp(srgb(mc[0], mc[1], mc[2]), 0.4);
      toothColor[i * 3] = c.r;
      toothColor[i * 3 + 1] = c.g;
      toothColor[i * 3 + 2] = c.b;
      toothAmp[i] = 0.12 + 0.14 * cell.velocity;
      i++;
    }, pinMat);

    if (notesMesh) {
      notesMesh.geometry.setAttribute('iAxisZ', new THREE.InstancedBufferAttribute(axisZ, 1));
      // mismo atributo de disparo que los pinos: un estampado enciende ambos
      teeth.geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(toothColor, 3));
      teeth.geometry.setAttribute('iAmp', new THREE.InstancedBufferAttribute(toothAmp, 1));
      teeth.geometry.setAttribute('iHit', hitAttr);
      teeth.instanceMatrix.needsUpdate = true;
      teeth.frustumCulled = false;
      cityGroup.add(teeth);
    }

    // Frontera de sección: anillo fino en cada rodillo (ámbar si recapitula)
    // y etiqueta al fondo
    const ringGeo = new THREE.TorusGeometry(R + 0.12, 0.045, 6, 48);
    piece.sections.forEach(section => {
      const x = mbX(section.startStep);
      const ringMat = new THREE.MeshBasicMaterial({
        color: section.recap ? 0xffb547 : 0x8f8d87, transparent: true, opacity: 0.55
      });
      for (let t = 0; t < nT; t++) {
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.y = Math.PI / 2;
        ring.position.set(x, 0, trackZ(t));
        cityGroup.add(ring);
      }
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.2);
      sprite.position.set(mbX(section.startStep + section.lengthSteps / 2), R + 2.4, zBack - 2.5);
      cityGroup.add(sprite);
    });

    // Etiquetas de pista en la boca de cada rodillo
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
      sprite.position.set(-5.5, 0, trackZ(t));
      cityGroup.add(sprite);
    }

    // Cursor: barra roja fija en la línea de lectura de cada rodillo + aro
    // ámbar que avanza en X señalando por dónde va la pieza
    cursorGroup = new THREE.Group();
    const barGeo = new THREE.BoxGeometry(MB_LENGTH_X + 2, 0.12, 0.12);
    const barMat = new THREE.MeshBasicMaterial({
      color: 0xff5a4e, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const markerGeo = new THREE.TorusGeometry(R + 0.4, 0.07, 8, 48);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffb547, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const marker = new THREE.Group();
    const Rb = R + 0.95;
    for (let t = 0; t < nT; t++) {
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(MB_LENGTH_X / 2, Rb * Math.cos(MB_READ_TH), trackZ(t) + Rb * Math.sin(MB_READ_TH));
      bar.rotation.x = MB_READ_TH;
      cursorGroup.add(bar);
      const ring = new THREE.Mesh(markerGeo, markerMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0, 0, trackZ(t));
      marker.add(ring);
    }
    cursorGroup.add(marker);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
    mb = { pinMat, rollers, marker };
  }

  // ---- Modo órbita de quintas ----

  // Faro k (quintas desde la tónica, reducido mod 12): la tónica al fondo
  // (−Z), los sostenidos en sentido horario visto desde arriba
  function lighthouseXZ(k) {
    const th = 2 * Math.PI * k / 12;
    return { x: F_R * Math.sin(th), z: -F_R * Math.cos(th) };
  }

  // Ángulo de un paso sobre la órbita de una sección (una vuelta = la sección)
  function orbitPhi(sec, step) {
    return sec.phi0 + 2 * Math.PI * (step - sec.startStep) / sec.lengthSteps;
  }

  // Posición en el plano XZ (y = 0) de un paso sobre la órbita de `sec`;
  // trackIndex < 0 = radio medio del anillo (la nave)
  function orbitXZ(sec, step, trackIndex, out) {
    const phi = orbitPhi(sec, step);
    const t = trackIndex < 0 ? (piece.numTracks - 1) / 2 : trackIndex;
    const r = sec.radius + t * F_TRACK_GAP;
    const v = out || new THREE.Vector3();
    return v.set(sec.cx + r * Math.sin(phi), 0, sec.cz - r * Math.cos(phi));
  }

  // Igual, sobre la órbita de la sección que contiene el paso
  function fifthsPos(step, trackIndex, out) {
    const s = Math.min(Math.max(Math.floor(step), 0), piece.totalSteps - 1);
    return orbitXZ(fif.sections[fif.stepSection[s]], step, trackIndex, out);
  }

  function buildFifths() {
    const nT = piece.numTracks;
    const colors = motifColors();
    const amber = srgb(255, 181, 71);
    const key = ((parseInt(piece.key, 10) || 0) % 12 + 12) % 12;

    // Plan tonal: cada sección orbita el faro de su tonalidad; las que repiten
    // faro (clímax sostenido, regreso, recapitulación) salen a radios crecientes
    const shareCount = new Array(12).fill(0);
    const sections = piece.sections.map(section => {
      const k = (((section.fifthOffset || 0) % 12) + 12) % 12;
      const { x, z } = lighthouseXZ(k);
      const radius = F_ORBIT_R + shareCount[k] * ((nT - 1) * F_TRACK_GAP + F_SHARE_GAP);
      shareCount[k]++;
      return { k, cx: x, cz: z, radius, phi0: 0, startStep: section.startStep, lengthSteps: section.lengthSteps };
    });
    // La órbita arranca (y, al dar la vuelta completa, termina) mirando hacia
    // el faro del que viene la nave; la primera mira al centro del círculo
    sections.forEach((sec, i) => {
      const prev = i > 0 ? sections[i - 1] : null;
      if (prev && prev.k === sec.k) { sec.phi0 = prev.phi0; return; }
      const tx = prev ? prev.cx : 0;
      const tz = prev ? prev.cz : 0;
      sec.phi0 = Math.atan2(tx - sec.cx, -(tz - sec.cz));
    });
    const stepSection = new Uint16Array(piece.totalSteps);
    sections.forEach((sec, i) => {
      const end = Math.min(sec.startStep + sec.lengthSteps, piece.totalSteps);
      for (let s = sec.startStep; s < end; s++) stepSection[s] = i;
    });
    const visited = new Set(sections.map(sec => sec.k));
    fif = { sections, stepSection, lamps: [], activeLamp: null };

    // Suelo y el propio ciclo de quintas, como una línea tenue entre faros
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry((F_R + 40) * 2, (F_R + 40) * 2),
      new THREE.MeshBasicMaterial({ color: 0x111114 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.05;
    cityGroup.add(floor);

    const linePos = [];
    const lineCol = [];
    const pushRing = (cx, cz, r, c, segs) => {
      for (let i = 0; i < segs; i++) {
        const a0 = 2 * Math.PI * i / segs;
        const a1 = 2 * Math.PI * (i + 1) / segs;
        linePos.push(cx + r * Math.sin(a0), 0.02, cz - r * Math.cos(a0), cx + r * Math.sin(a1), 0.02, cz - r * Math.cos(a1));
        lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
      }
    };
    pushRing(0, 0, F_R, srgb(30, 30, 36), 144);
    // Órbitas: un anillo por pista (tenue) y el de la sección (más claro, ámbar
    // si recapitula) a su radio base
    piece.sections.forEach((section, i) => {
      const sec = sections[i];
      const base = section.recap ? amber.clone().multiplyScalar(0.55) : srgb(200, 198, 192).multiplyScalar(0.3);
      pushRing(sec.cx, sec.cz, sec.radius - 0.35, base, 96);
      const faint = srgb(26, 26, 46);
      for (let t = 0; t < nT; t++) pushRing(sec.cx, sec.cz, sec.radius + t * F_TRACK_GAP, faint, 96);
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Faros: torre fina + lámpara aditiva + nombre de la tonalidad. Los que la
    // pieza visita brillan; el resto apenas se insinúa; la tónica, ámbar.
    // Del lado de los bemoles (k ≥ 7, es decir −5..−1) se nombran con bemol
    const towerGeo = new THREE.CylinderGeometry(0.16, 0.26, F_TOWER_H, 10, 1);
    const lampGeo = new THREE.SphereGeometry(0.75, 16, 12);
    const glowTex = makeGlowTexture();
    for (let k = 0; k < 12; k++) {
      const { x, z } = lighthouseXZ(k);
      const isTonic = k === 0;
      const lit = visited.has(k);
      const color = isTonic ? 0xffb547 : (lit ? 0xd8d6d0 : 0x4a4a54);
      const tower = new THREE.Mesh(towerGeo, new THREE.MeshBasicMaterial({ color: lit ? 0x3a3a42 : 0x1e1e24 }));
      tower.position.set(x, F_TOWER_H / 2, z);
      cityGroup.add(tower);
      const baseOpacity = isTonic ? 0.9 : (lit ? 0.6 : 0.16);
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: baseOpacity,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      lamp.position.set(x, F_TOWER_H + 0.6, z);
      cityGroup.add(lamp);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: baseOpacity * 0.5
      }));
      halo.scale.set(5, 5, 1);
      halo.position.copy(lamp.position);
      cityGroup.add(halo);
      fif.lamps.push({ lamp, halo, baseOpacity });

      const pc = (key + 7 * k) % 12;
      const name = k >= 7 ? F_FLAT_NAMES[pc] : F_SHARP_NAMES[pc];
      const label = makeTextSprite(name, isTonic ? '#ffb547' : (lit ? '#a3a19b' : '#4a4a50'), lit ? 2.2 : 1.6);
      label.position.set(x, F_TOWER_H + 3.2, z);
      cityGroup.add(label);
    }

    // Estelas: el viaje de la nave del final de una órbita al inicio de la
    // siguiente, abombadas hacia fuera para no cruzar los anillos
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x8f8d87, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const trailRecapMat = trailMat.clone();
    trailRecapMat.color.set(0xffb547);
    const trailY = 0.6 + F_H / 2;
    for (let i = 0; i + 1 < sections.length; i++) {
      // la vuelta completa termina donde empezó: su fin es el punto phi0 + 2π
      const a = orbitXZ(sections[i], sections[i].startStep + sections[i].lengthSteps, -1);
      const b = orbitXZ(sections[i + 1], sections[i + 1].startStep, -1);
      a.y = b.y = trailY;
      const m = a.clone().add(b).multiplyScalar(0.5);
      for (const sec of [sections[i], sections[i + 1]]) {
        const rMin = sec.radius + (nT - 1) * F_TRACK_GAP + 2.5;
        const dx = m.x - sec.cx;
        const dz = m.z - sec.cz;
        const d = Math.hypot(dx, dz);
        if (d < rMin) {
          const push = d > 1e-6 ? rMin / d : 0;
          m.x = sec.cx + (d > 1e-6 ? dx * push : rMin);
          m.z = sec.cz + (d > 1e-6 ? dz * push : 0);
        }
      }
      const curve = new THREE.CatmullRomCurve3([a, m, b], false, 'centripetal');
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 32, 0.1, 6, false),
        piece.sections[i + 1].recap ? trailRecapMat : trailMat
      );
      cityGroup.add(tube);
    }

    // Etiquetas de sección sobre su órbita y de pista en el arranque de la
    // primera, una por radio (la misma leyenda vale para todas las órbitas).
    // Las regiones en otro modo (relativo, homónimo: el faro es su tónica)
    // lo dicen en la etiqueta, para distinguir Do mayor de Do menor
    const MODE_NAMES = { major: 'mayor', minor: 'menor', dorian: 'dórica', mixolydian: 'mixolidia' };
    piece.sections.forEach((section, i) => {
      const sec = sections[i];
      const mode = section.localScale && section.localScale !== piece.scale ? MODE_NAMES[section.localScale] : null;
      const label = makeTextSprite(sectionLabel(section) + (mode ? ' · ' + mode : ''), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      label.position.set(sec.cx, F_H + 2.6, sec.cz);
      cityGroup.add(label);
    });
    for (let t = 0; t < nT; t++) {
      const p = fifthsPos(0, t);
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 0.8);
      sprite.position.set(p.x, 0.3, p.z);
      cityGroup.add(sprite);
    }

    // Notas: cajas tangentes a la órbita, largo proporcional al arco de su
    // duración, altura por velocity. Las alteradas — fuera de la armadura de
    // la tonalidad base (lo que la modulación cambia: Fa# en Sol, Sib en Fa)
    // o con alteración del plan armónico (sensible, dominante secundaria) —
    // se inclinan hacia fuera del anillo y brillan más: ahí se ve la modulación
    const canCompare = typeof Generator !== 'undefined' && !!Generator.SCALES;
    const homePcs = canCompare
      ? new Set((Generator.SCALES[piece.scale] || Generator.SCALES.major).map(iv => (key + iv) % 12))
      : null;
    const altered = [];
    let i = 0;
    const tmp = new THREE.Vector3();
    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      const sec = fif.sections[fif.stepSection[s]];
      const r = sec.radius + t * F_TRACK_GAP;
      const arcStep = 2 * Math.PI * r / sec.lengthSteps;
      // la nota se queda en la órbita de la sección donde arranca aunque su
      // duración cruce la frontera
      const mid = s + durationSteps / 2;
      const phi = orbitPhi(sec, mid);
      const isAltered = canCompare && (!!cell.alter || !homePcs.has(((cell.midi % 12) + 12) % 12));
      orbitXZ(sec, mid, t, tmp);
      if (isAltered) {
        tmp.x += 0.3 * Math.sin(phi);
        tmp.z -= 0.3 * Math.cos(phi);
        altered.push(i);
      }
      dummy.position.set(tmp.x, 0.6 + norm * F_H, tmp.z);
      // orden YXZ: primero orientar la caja tangente al anillo, luego volcarla
      // sobre esa tangente hacia fuera si está alterada
      dummy.rotation.order = 'YXZ';
      dummy.rotation.set(isAltered ? -0.45 : 0, -phi, 0);
      dummy.scale.set(Math.min(Math.max(durationSteps * arcStep - 0.1, 0.25), 6), 0.4 + 0.5 * cell.velocity, 0.5);
      i++;
    });
    if (notesMesh && altered.length) {
      const attr = notesMesh.geometry.getAttribute('iColor');
      for (const idx of altered) {
        attr.setXYZ(idx, Math.min(attr.getX(idx) * 1.5 + 0.25, 1.6), Math.min(attr.getY(idx) * 1.5 + 0.25, 1.6), Math.min(attr.getZ(idx) * 1.5 + 0.25, 1.6));
      }
      attr.needsUpdate = true;
    }

    // Cursor: la nave, un octaedro aditivo con halo que recorre las órbitas
    cursorGroup = new THREE.Group();
    const ship = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.7, 0),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ship.scale.set(1, 0.6, 1.6);
    cursorGroup.add(ship);
    const shipGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xff5a4e, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.6
    }));
    shipGlow.scale.set(4.5, 4.5, 1);
    cursorGroup.add(shipGlow);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // Halo del faro activo: al cambiar de sección, el faro de la nueva tonalidad
  // sube de intensidad y el anterior vuelve a su brillo base
  function tickFifths() {
    let lampNow = null;
    if (cursorStepLast >= 0) {
      const s = Math.min(cursorStepLast, piece.totalSteps - 1);
      lampNow = fif.lamps[fif.sections[fif.stepSection[s]].k];
    }
    if (lampNow === fif.activeLamp) return;
    for (const [entry, on] of [[fif.activeLamp, false], [lampNow, true]]) {
      if (!entry) continue;
      entry.lamp.material.opacity = on ? 1 : entry.baseOpacity;
      entry.halo.material.opacity = on ? 0.85 : entry.baseOpacity * 0.5;
      entry.lamp.scale.setScalar(on ? 1.7 : 1);
      entry.halo.scale.set(on ? 11 : 5, on ? 11 : 5, 1);
    }
    fif.activeLamp = lampNow;
    dirty = true;
  }

  // ---- Modo pianola ----

  // Centro en Z de la banda de papel de una pista (la primera, pegada a z = 0)
  function plBandZ(t) {
    return -(t + 0.5) * PL_BAND;
  }

  function buildPianola() {
    const nT = piece.numTracks;
    const width = piece.totalSteps * STEP;
    const depth = nT * PL_BAND;
    const zBack = -depth;
    const zc = -depth / 2;
    const colors = motifColors();
    // crema atenuado para que no deslumbre
    const paper = srgb(214, 200, 170).multiplyScalar(0.35);

    // El rodillo lector es metal estándar y necesita luces (como en la caja
    // de música); el papel y los agujeros se iluminan solos
    cityGroup.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(-25, 45, 40);
    cityGroup.add(sun);

    // Suelo: ancho de sobra para las manchas de luz, que caen fuera del papel
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 30, depth * PL_MAG + 26),
      new THREE.MeshBasicMaterial({ color: 0x111114 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, -0.05, zc);
    cityGroup.add(floor);

    // Papel: banda tumbada, una banda de pista por cada PL_BAND en Z
    const sheet = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 2 * PL_MARGIN, depth),
      new THREE.MeshBasicMaterial({ color: paper, side: THREE.DoubleSide })
    );
    sheet.rotation.x = -Math.PI / 2;
    sheet.position.set(width / 2, PL_Y, zc);
    cityGroup.add(sheet);

    // Impreso sobre el papel: separadores de banda, marca tenue cada 4 pasos
    // (algo más cada célula), frontera de sección más clara (ámbar si
    // recapitula) y arranque de cada bloque en el color de su motivo. Los
    // bloques van un pelo más altos para ganar a las marcas que coinciden
    const linePos = [];
    const lineCol = [];
    const pushLine = (x0, z0, x1, z1, y, c) => {
      linePos.push(x0, y, z0, x1, y, z1);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const yLine = PL_Y + 0.012;
    const sepColor = paper.clone().multiplyScalar(0.45);
    const beatColor = paper.clone().multiplyScalar(0.72);
    const cellColor = paper.clone().multiplyScalar(0.55);
    const sectionColor = paper.clone().multiplyScalar(1.9);
    const recapColor = srgb(255, 181, 71).multiplyScalar(0.6);
    for (let t = 0; t <= nT; t++) {
      pushLine(-PL_MARGIN, -t * PL_BAND, width + PL_MARGIN, -t * PL_BAND, yLine, sepColor);
    }
    const sectionStarts = new Set(piece.sections.map(sec => sec.startStep));
    for (let s = 4; s < piece.totalSteps; s += 4) {
      if (sectionStarts.has(s)) continue;
      const x = s * STEP;
      pushLine(x, 0, x, zBack, yLine, s % piece.cellLength === 0 ? cellColor : beatColor);
    }
    piece.sections.forEach(section => {
      const x = section.startStep * STEP;
      pushLine(x, 0.4, x, zBack - 0.4, yLine, section.recap ? recapColor : sectionColor);
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      sprite.position.set((section.startStep + section.lengthSteps / 2) * STEP, PL_Y + 2.6, zBack - 1.6);
      cityGroup.add(sprite);
    });
    pushLine(width, 0.4, width, zBack - 0.4, yLine, sectionColor);
    if (piece.blockMarkers) {
      for (const block of piece.blockMarkers) {
        const mc = colors[block.motifIndex % colors.length];
        const c = srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.45);
        const x = block.startStep * STEP;
        const z = -block.trackIndex * PL_BAND;
        pushLine(x, z - 0.3, x, z - PL_BAND + 0.3, yLine + 0.004, c);
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Etiquetas de pista al principio de cada banda
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
      sprite.position.set(-PL_MARGIN - 1.6, PL_Y + 0.2, plBandZ(t));
      cityGroup.add(sprite);
    }

    // Agujeros (cajas planas oscuras sobre el papel) y manchas de luz en el
    // suelo (planos aditivos, InstancedMesh aparte): comparten el atributo de
    // disparo y el de duración, así un estampado enciende ambos. Las manchas
    // van instanciadas y no como Points porque un InstancedBufferAttribute
    // compartido con una geometría no instanciada se leería con divisor
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;
    const dur = new Float32Array(count);
    const spotColor = new Float32Array(count * 3);
    const holeMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStepSec: { value: stepSec },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: PL_HOLE_VERTEX,
      fragmentShader: PL_HOLE_FRAGMENT
    });
    const spotMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uStepSec: { value: stepSec },
        uFogDensity: { value: scene.fog.density }
      },
      vertexShader: PL_SPOT_VERTEX,
      fragmentShader: PL_SPOT_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    shaderMats.push(spotMat);   // holeMat lo registra buildNotes
    const spotGeo = new THREE.PlaneGeometry(1, 1);
    spotGeo.rotateX(-Math.PI / 2);
    const spots = count ? new THREE.InstancedMesh(spotGeo, spotMat, count) : null;
    const spot = new THREE.Object3D();
    let i = 0;
    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      const x = (s + durationSteps / 2) * STEP;
      const z = plBandZ(t) + (norm - 0.5) * (PL_BAND - 0.8);
      dummy.position.set(x, PL_Y + 0.02, z);
      dummy.scale.set(Math.max(durationSteps * STEP - 0.14, 0.3), 0.08, 0.42);
      dur[i] = durationSteps;

      // la mancha: el agujero proyectado desde la lámpara (eje del papel),
      // ampliado PL_MAG veces en Z y algo más largo que el agujero
      spot.position.set(x, 0.02, zc + (z - zc) * PL_MAG);
      spot.scale.set(Math.max(durationSteps * STEP, 0.6) + 1.6, 1, 0.42 * PL_MAG + 1.0 + 0.8 * cell.velocity);
      spot.updateMatrix();
      spots.setMatrixAt(i, spot.matrix);
      const mc = colors[(cell.motifIndex || 0) % colors.length];
      const c = srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.5 + 0.5 * cell.velocity);
      spotColor[i * 3] = c.r;
      spotColor[i * 3 + 1] = c.g;
      spotColor[i * 3 + 2] = c.b;
      i++;
    }, holeMat);

    if (notesMesh) {
      const durAttr = new THREE.InstancedBufferAttribute(dur, 1);
      notesMesh.geometry.setAttribute('iDur', durAttr);
      spots.geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(spotColor, 3));
      spots.geometry.setAttribute('iHit', hitAttr);
      spots.geometry.setAttribute('iDur', durAttr);
      spots.instanceMatrix.needsUpdate = true;
      spots.frustumCulled = false;
      cityGroup.add(spots);
    }

    // Cursor: el lector entero se desplaza por el rollo — rodillo metálico
    // bajo el papel, pórtico con la lámpara (tubo cálido) encima, un velo de
    // luz cayendo sobre el papel y la línea roja de lectura
    cursorGroup = new THREE.Group();
    const rollerGeo = new THREE.CylinderGeometry(PL_ROLLER_R, PL_ROLLER_R, depth + 3, 32, 1);
    rollerGeo.rotateX(Math.PI / 2);
    const roller = new THREE.Mesh(
      rollerGeo,
      new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.85, roughness: 0.45 })
    );
    const rollerY = PL_Y - PL_ROLLER_R - 0.2;
    roller.position.set(0, rollerY, zc);
    cursorGroup.add(roller);
    const axleGeo = new THREE.CylinderGeometry(0.3, 0.3, depth + 6, 12, 1);
    axleGeo.rotateX(Math.PI / 2);
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, metalness: 0.9, roughness: 0.35 });
    const axle = new THREE.Mesh(axleGeo, darkMetal);
    axle.position.copy(roller.position);
    cursorGroup.add(axle);
    const postGeo = new THREE.BoxGeometry(0.35, PL_LAMP_Y + 0.4, 0.35);
    for (const z of [1.4, zBack - 1.4]) {
      const post = new THREE.Mesh(postGeo, darkMetal);
      post.position.set(0, (PL_LAMP_Y + 0.4) / 2 - 0.05, z);
      cursorGroup.add(post);
    }
    const tube = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, depth + 2.8),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    tube.position.set(0, PL_LAMP_Y, zc);
    cursorGroup.add(tube);
    const veil = new THREE.Mesh(
      new THREE.BoxGeometry(STEP, PL_LAMP_Y - PL_Y, depth + 1),
      new THREE.MeshBasicMaterial({
        color: 0xffb547, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    veil.position.set(0, (PL_LAMP_Y + PL_Y) / 2, zc);
    cursorGroup.add(veil);
    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.04, depth + 1),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    line.position.set(0, PL_Y + 0.1, zc);
    cursorGroup.add(line);
    cursorGroup.position.x = 0.5 * STEP;
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
    pl = { holeMat, spotMat };
  }

  // ---- Modo telar ----

  function lmLaneZ(t) {
    return -t * LM_LANE;
  }

  function buildLoom() {
    const nT = piece.numTracks;
    const W = piece.totalSteps;
    const width = W * STEP;
    const depth = (nT - 1) * LM_LANE + 2;
    const zc = -(nT - 1) * LM_LANE / 2;
    const zBack = lmLaneZ(nT - 1);
    const range = midiRange(piece.grid);
    const colors = motifColors();
    const amber = srgb(255, 181, 71);
    const linen = srgb(96, 90, 80);   // hilo sin nota: lino crudo apagado

    // Los travesaños del marco son metal estándar y necesitan luces (como la
    // caja de música); hilos, tramas y nudos se iluminan en sus shaders
    cityGroup.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(-25, 45, 40);
    cityGroup.add(sun);
    const beamGeo = new THREE.BoxGeometry(width + 6, 0.5, depth + 2);
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.85, roughness: 0.45 });
    for (const y of [LM_H + 2, -0.6]) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.position.set(width / 2, y, zc);
      cityGroup.add(beam);
    }

    const recapAt = new Uint8Array(W);
    piece.sections.forEach(section => {
      if (!section.recap) return;
      const end = Math.min(section.startStep + section.lengthSteps, W);
      for (let s = section.startStep; s < end; s++) recapAt[s] = 1;
    });

    // Urdimbre: por pista, una clave por paso (altura, ancho y color del hilo)
    // y una cinta vertical muestreada LM_SUB veces por paso con interpolación
    // suave entre claves. Durante una nota el hilo va a su altura con ancho
    // pleno; en el hueco que sigue, el sustain de esa nota decide si sigue
    // liso hacia la siguiente (ligado) o se estrecha a una puntada y cae
    // hacia la línea base (picado)
    const N = W * LM_SUB + 1;
    const vertsPerTrack = N * 2;
    const positions = new Float32Array(nT * vertsPerTrack * 3);
    const aColor = new Float32Array(nT * vertsPerTrack * 3);
    const aEdge = new Float32Array(nT * vertsPerTrack);
    const index = new Uint32Array(nT * (N - 1) * 6);
    const yKeys = [];
    const yKey = new Float32Array(W);
    const wKey = new Float32Array(W);
    const cKey = new Float32Array(W * 3);
    const tmp = new THREE.Color();
    let k = 0;
    for (let t = 0; t < nT; t++) {
      const row = piece.grid[t];
      const notes = [];
      for (let s = 0; s < W; s++) {
        const cell = row[s];
        if (!cell) continue;
        const norm = (cell.midi - range.min) / (range.max - range.min);
        const mc = colors[(cell.motifIndex || 0) % colors.length];
        notes.push({
          s,
          end: s + (cell.durationSteps || 1),
          y: 0.6 + norm * LM_H,
          sustain: cell.sustain,
          c: srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.5 + 0.5 * cell.velocity)
        });
      }
      let ni = 0;
      for (let s = 0; s < W; s++) {
        while (ni < notes.length && notes[ni].end <= s) ni++;
        const next = ni < notes.length ? notes[ni] : null;   // activa o futura
        const prev = ni > 0 ? notes[ni - 1] : null;
        let y;
        let w;
        if (next && next.s <= s) {
          y = next.y;
          w = LM_W;
          tmp.copy(next.c);
        } else if (prev) {
          const cont = Math.min(Math.max((prev.sustain - 0.45) / 0.25, 0), 1);
          const j = s - prev.end + 1;
          const yDecay = LM_BASE + (prev.y - LM_BASE) * Math.exp(-j * 0.5);
          const yBridge = next ? prev.y + (next.y - prev.y) * (s - prev.end + 0.5) / (next.s - prev.end) : yDecay;
          y = yDecay + (yBridge - yDecay) * cont;
          w = LM_W * (0.15 + 0.85 * cont);
          tmp.copy(linen).lerp(prev.c, 0.25 + 0.55 * cont);
        } else {
          y = LM_BASE;
          w = LM_W * 0.15;
          tmp.copy(linen);
        }
        // fibra: ondulación leve y determinista
        y += (hash2(s, t) - 0.5) * 0.16;
        if (recapAt[s]) tmp.lerp(amber, 0.15);
        yKey[s] = y;
        wKey[s] = w;
        cKey[s * 3] = tmp.r;
        cKey[s * 3 + 1] = tmp.g;
        cKey[s * 3 + 2] = tmp.b;
      }
      yKeys.push(yKey.slice());

      const z = lmLaneZ(t);
      const base = t * vertsPerTrack;
      for (let i = 0; i < N; i++) {
        const x = i * STEP / LM_SUB;
        // la clave del paso k vive en su centro (k + 0.5)
        const f = x / STEP - 0.5;
        const k0 = Math.max(0, Math.min(W - 1, Math.floor(f)));
        const k1 = Math.min(W - 1, k0 + 1);
        let u = Math.min(Math.max(f - k0, 0), 1);
        u = u * u * (3 - 2 * u);
        const y = yKey[k0] + (yKey[k1] - yKey[k0]) * u;
        const w = wKey[k0] + (wKey[k1] - wKey[k0]) * u;
        const lo = base + i * 2;
        const hi = lo + 1;
        positions[lo * 3] = x;
        positions[lo * 3 + 1] = y - w / 2;
        positions[lo * 3 + 2] = z;
        positions[hi * 3] = x;
        positions[hi * 3 + 1] = y + w / 2;
        positions[hi * 3 + 2] = z;
        aEdge[lo] = -1;
        aEdge[hi] = 1;
        for (let c = 0; c < 3; c++) {
          const cv = cKey[k0 * 3 + c] + (cKey[k1 * 3 + c] - cKey[k0 * 3 + c]) * u;
          aColor[lo * 3 + c] = cv;
          aColor[hi * 3 + c] = cv;
        }
      }
      for (let i = 0; i < N - 1; i++) {
        const a = base + i * 2;
        index[k++] = a; index[k++] = a + 2; index[k++] = a + 1;
        index[k++] = a + 1; index[k++] = a + 2; index[k++] = a + 3;
      }
    }
    const warpGeo = new THREE.BufferGeometry();
    warpGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    warpGeo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    warpGeo.setAttribute('aEdge', new THREE.BufferAttribute(aEdge, 1));
    warpGeo.setIndex(new THREE.BufferAttribute(index, 1));
    loomMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density },
        uCursorX: { value: 0 },
        uCursorOn: { value: 0 }
      },
      vertexShader: LM_WARP_VERTEX,
      fragmentShader: LM_WARP_FRAGMENT,
      side: THREE.DoubleSide
    });
    shaderMats.push(loomMat);
    cityGroup.add(new THREE.Mesh(warpGeo, loomMat));

    // Tramas: una franja translúcida por bloque en el color de su motivo, en
    // el plano del hilo (un pelo por detrás) y fusionadas en una sola geometría
    const blocks = (piece.blockMarkers || []).filter(b => b.motifIndex !== null && b.motifIndex !== undefined);
    if (blocks.length) {
      const wPos = new Float32Array(blocks.length * 12);
      const wCol = new Float32Array(blocks.length * 12);
      const wIdx = new Uint32Array(blocks.length * 6);
      const y0 = -0.3;
      const y1 = LM_H + 0.7;
      blocks.forEach((block, i) => {
        const x0 = block.startStep * STEP;
        const x1 = x0 + block.lengthSteps * STEP;
        const z = lmLaneZ(block.trackIndex) - 0.45;
        const mc = colors[block.motifIndex % colors.length];
        const c = srgb(mc[0], mc[1], mc[2]);
        const corners = [x0, y0, x1, y0, x0, y1, x1, y1];
        for (let v = 0; v < 4; v++) {
          const o = (i * 4 + v) * 3;
          wPos[o] = corners[v * 2];
          wPos[o + 1] = corners[v * 2 + 1];
          wPos[o + 2] = z;
          wCol[o] = c.r;
          wCol[o + 1] = c.g;
          wCol[o + 2] = c.b;
        }
        const a = i * 4;
        wIdx[i * 6] = a; wIdx[i * 6 + 1] = a + 1; wIdx[i * 6 + 2] = a + 2;
        wIdx[i * 6 + 3] = a + 1; wIdx[i * 6 + 4] = a + 3; wIdx[i * 6 + 5] = a + 2;
      });
      const weftGeo = new THREE.BufferGeometry();
      weftGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
      weftGeo.setAttribute('color', new THREE.BufferAttribute(wCol, 3));
      weftGeo.setIndex(new THREE.BufferAttribute(wIdx, 1));
      cityGroup.add(new THREE.Mesh(weftGeo, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.09,
        depthWrite: false, side: THREE.DoubleSide
      })));
    }

    // Peines: una lámina vertical fina entre travesaños en cada frontera de
    // sección (ámbar si recapitula) con su etiqueta encima; otro al final
    const combGeo = new THREE.PlaneGeometry(depth + 2, LM_H + 2.1);
    const combY = LM_H / 2 + 0.7;
    const addComb = (x, color, opacity) => {
      const comb = new THREE.Mesh(combGeo, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide
      }));
      comb.rotation.y = Math.PI / 2;
      comb.position.set(x, combY, zc);
      cityGroup.add(comb);
    };
    piece.sections.forEach(section => {
      addComb(section.startStep * STEP, section.recap ? 0xffb547 : 0x8f8d87, section.recap ? 0.35 : 0.22);
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      sprite.position.set((section.startStep + section.lengthSteps / 2) * STEP, LM_H + 3.4, zBack - 1.5);
      cityGroup.add(sprite);
    });
    addComb(width, 0x8f8d87, 0.22);

    // Etiquetas de pista al arranque de cada hilo
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
      sprite.position.set(-2.2, LM_BASE + 0.5, lmLaneZ(t));
      cityGroup.add(sprite);
    }

    // Nudos: un ataque es un nudo sobre el hilo, en el paso de ataque (no en
    // el centro de la duración), a la altura exacta del hilo
    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      dummy.position.set((s + 0.5) * STEP, yKeys[t][s], lmLaneZ(t));
      dummy.scale.set(0.45, 0.35 + 0.5 * cell.velocity, LM_W + 0.3);
    });

    // Cursor: la lanzadera, una pieza alargada que cruza todos los hilos a
    // media altura; el brillo que recorre cada hilo lo pinta su shader
    cursorGroup = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.6, depth + 2),
      new THREE.MeshBasicMaterial({
        color: 0xff5a4e, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.18, depth + 2.4),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(body);
    cursorGroup.add(core);
    cursorGroup.position.set(0.5 * STEP, LM_H / 2 + 0.6, zc);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo arpa ----

  function buildStrings() {
    const nT = Math.min(piece.numTracks, ST_MAX);
    const top = ST_GAP * (nT - 1);
    const colors = motifColors();

    // Las columnas del marco son metal estándar y necesitan luces (como la
    // caja de música); las cuerdas se iluminan en su shader
    cityGroup.add(new THREE.AmbientLight(0xffffff, 0.3));
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.8);
    sun.position.set(-25, 45, 40);
    cityGroup.add(sun);

    const colH = top + 3;
    const colGeo = new THREE.BoxGeometry(0.8, colH, 1.2);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.85, roughness: 0.45 });
    for (const x of [-0.7, ST_LEN + 0.7]) {
      const column = new THREE.Mesh(colGeo, colMat);
      column.position.set(x, top / 2, 0);
      cityGroup.add(column);
    }
    // Tabla armónica detrás: también alberga la regla de tiempo
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(ST_LEN + 8, top - ST_RULER_Y + 7),
      new THREE.MeshBasicMaterial({ color: 0x121216 })
    );
    board.position.set(ST_LEN / 2, (top + ST_RULER_Y) / 2 - 0.5, -1.5);
    cityGroup.add(board);

    // Cuerdas: una cinta por pista en geometría única; la vibración la pone el
    // shader a partir de los arrays de uniforms que estampa pluckStrings
    const N = ST_SEG + 1;
    const positions = new Float32Array(nT * N * 2 * 3);
    const aTrack = new Float32Array(nT * N * 2);
    const aU = new Float32Array(nT * N * 2);
    const aEdge = new Float32Array(nT * N * 2);
    const index = new Uint16Array(nT * ST_SEG * 6);
    let k = 0;
    for (let t = 0; t < nT; t++) {
      for (let i = 0; i < N; i++) {
        const u = i / ST_SEG;
        for (let e = 0; e < 2; e++) {
          const v = (t * N + i) * 2 + e;
          positions[v * 3] = u * ST_LEN;
          positions[v * 3 + 1] = ST_GAP * t;
          positions[v * 3 + 2] = 0;
          aTrack[v] = t;
          aU[v] = u;
          aEdge[v] = e ? 1 : -1;
        }
      }
      for (let i = 0; i < ST_SEG; i++) {
        const a = (t * N + i) * 2;
        index[k++] = a; index[k++] = a + 2; index[k++] = a + 1;
        index[k++] = a + 1; index[k++] = a + 2; index[k++] = a + 3;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aTrack', new THREE.BufferAttribute(aTrack, 1));
    geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
    geo.setAttribute('aEdge', new THREE.BufferAttribute(aEdge, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    // Arrays tipados mutados en sitio: three sube los uniforms de array en
    // cada render sin caché de valor
    const stringMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAmp: { value: new Float32Array(ST_MAX) },
        uNodes: { value: new Float32Array(ST_MAX).fill(1) },
        uHit: { value: new Float32Array(ST_MAX).fill(-1000) },
        uDecay: { value: new Float32Array(ST_MAX).fill(2) },
        uColor: { value: new Float32Array(ST_MAX * 3) }
      },
      vertexShader: ST_VERTEX,
      fragmentShader: ST_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    shaderMats.push(stringMat);
    const strings = new THREE.Mesh(geo, stringMat);
    strings.frustumCulled = false;   // la vibración sale de la caja de la geometría
    cityGroup.add(strings);

    // Etiquetas de pista junto a la columna izquierda
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 0.9);
      sprite.position.set(-2.4, ST_GAP * t, 0);
      cityGroup.add(sprite);
    }

    // Regla de tiempo: línea base, una marca por célula (si caben), las
    // fronteras de sección más altas (ámbar si recapitula) y sus etiquetas
    const linePos = [];
    const lineCol = [];
    const pushLine = (x0, y0, x1, y1, c) => {
      linePos.push(x0, y0, 0, x1, y1, 0);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const toX = s => ST_LEN * s / piece.totalSteps;
    const baseColor = srgb(60, 60, 66);
    const tickColor = srgb(44, 44, 50);
    const sectionColor = srgb(200, 198, 192).multiplyScalar(0.45);
    const recapColor = srgb(255, 181, 71).multiplyScalar(0.8);
    pushLine(0, ST_RULER_Y, ST_LEN, ST_RULER_Y, baseColor);
    const cells = piece.totalSteps / piece.cellLength;
    if (cells <= 256) {
      for (let s = piece.cellLength; s < piece.totalSteps; s += piece.cellLength) {
        pushLine(toX(s), ST_RULER_Y - 0.12, toX(s), ST_RULER_Y + 0.12, tickColor);
      }
    }
    piece.sections.forEach((section, i) => {
      const x = toX(section.startStep);
      pushLine(x, ST_RULER_Y - 0.35, x, ST_RULER_Y + 0.35, section.recap ? recapColor : sectionColor);
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 0.8);
      // alternadas en dos filas para que no se pisen con secciones cortas
      sprite.position.set(toX(section.startStep + section.lengthSteps / 2), ST_RULER_Y - 0.9 - (i % 2) * 0.9, 0);
      cityGroup.add(sprite);
    });
    pushLine(ST_LEN, ST_RULER_Y - 0.35, ST_LEN, ST_RULER_Y + 0.35, sectionColor);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Cursor: aro ámbar aditivo con núcleo que avanza por la regla
    cursorGroup = new THREE.Group();
    cursorGroup.add(new THREE.Mesh(
      new THREE.TorusGeometry(0.38, 0.06, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffb547, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    ));
    cursorGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    ));
    cursorGroup.position.set(0, ST_RULER_Y, 0.1);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);

    st = { mat: stringMat, nT, range: midiRange(piece.grid), colors };
  }

  // Pulsa las cuerdas cuyas pistas atacan en este paso: amplitud por
  // velocity, nodos por altura y decaimiento por sustain (picado se apaga
  // rápido, ligado dura); las demás siguen con su decaimiento anterior
  function pluckStrings(step) {
    const u = st.mat.uniforms;
    const now = clock.elapsedTime;
    let any = false;
    for (let t = 0; t < st.nT; t++) {
      const cell = piece.grid[t][step];
      if (!cell) continue;
      const norm = (cell.midi - st.range.min) / (st.range.max - st.range.min);
      u.uHit.value[t] = now;
      u.uAmp.value[t] = 0.25 + 0.9 * cell.velocity;
      u.uNodes.value[t] = 1 + Math.round(Math.min(Math.max(norm, 0), 1) * 7);
      u.uDecay.value[t] = 1.2 + (1 - (cell.sustain ?? 1)) * 4;
      const mc = st.colors[(cell.motifIndex || 0) % st.colors.length];
      const c = srgb(mc[0], mc[1], mc[2]);
      u.uColor.value[t * 3] = c.r;
      u.uColor.value[t * 3 + 1] = c.g;
      u.uColor.value[t * 3 + 2] = c.b;
      any = true;
    }
    if (any) dirty = true;
  }

  // ---- Modo galaxia ----

  // Espiral de Arquímedes en el plano XZ, continua (no se reinicia por vuelta).
  // Una vuelta = gal.turnSteps pasos: normalmente una célula, como en el túnel;
  // en piezas tan largas que el avance por vuelta quedaría por debajo de
  // G_PITCH_MIN, una vuelta abarca 2, 4… células para no pasar de G_RMAX
  function galaxyTheta(step) {
    return 2 * Math.PI * step / gal.turnSteps;
  }

  function galaxyR(step) {
    return G_R0 + gal.pitch * step / gal.turnSteps;
  }

  // Posición de un paso en el brazo (sub-espira) de una pista, desplazada
  // radialmente dentro de la vuelta; la altura tonal da el grosor del disco
  function galaxyPos(step, trackIndex, norm, out) {
    const th = galaxyTheta(step);
    const r = galaxyR(step) + trackIndex * gal.laneGap;
    const v = out || new THREE.Vector3();
    return v.set(r * Math.cos(th), norm * G_H, r * Math.sin(th));
  }

  function buildGalaxy() {
    const nT = piece.numTracks;
    const range = midiRange(piece.grid);
    const colors = motifColors();
    const cellTurns = piece.totalSteps / piece.cellLength;
    let k = 1;
    let pitch = Math.min(G_PITCH, (G_RMAX - G_R0) / cellTurns);
    while (pitch < G_PITCH_MIN) {
      k *= 2;
      pitch = Math.min(G_PITCH, (G_RMAX - G_R0) * k / cellTurns);
    }
    // los brazos de una vuelta ocupan el 80% del avance: no se mezclan con la siguiente
    gal = { turnSteps: piece.cellLength * k, pitch, laneGap: pitch * 0.8 / nT };
    const rOuter = galaxyR(piece.totalSteps) + (nT - 1) * gal.laneGap;
    gal.rOuter = rOuter;
    const glowTex = makeGlowTexture();

    // Polvo de fondo determinista en un disco más ancho que la espiral
    const dust = new Float32Array(G_DUST * 3);
    for (let i = 0; i < G_DUST; i++) {
      const r = G_R0 + rOuter * 1.4 * Math.sqrt(hash2(i, 1));
      const a = 2 * Math.PI * hash2(i, 2);
      dust[i * 3] = r * Math.cos(a);
      dust[i * 3 + 1] = (hash2(i, 3) - 0.5) * G_H * 2;
      dust[i * 3 + 2] = r * Math.sin(a);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
    cityGroup.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0x8f8d87, size: 0.6, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false
    })));

    // Secciones como anillos planos bajo el disco. La sección ocupa un tramo
    // de espiral, no un círculo: el anillo es la banda radial que barre, una
    // aproximación (el primer y el último cuarto de vuelta se solapan con las
    // vecinas). Ámbar si recapitula
    const labelH = Math.max(1.7, rOuter * 0.02);
    piece.sections.forEach((section, i) => {
      const r0 = galaxyR(section.startStep);
      const r1 = galaxyR(section.startStep + section.lengthSteps);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r0, Math.max(r1, r0 + 0.05), 128, 1),
        new THREE.MeshBasicMaterial({
          color: section.recap ? 0xffb547 : 0xc8c6c0,
          transparent: true,
          // sobre fondo negro y en lineal, estas opacidades ya se ven mucho
          opacity: section.recap ? 0.03 : (i % 2 === 0 ? 0.016 : 0.006),
          depthWrite: false,
          side: THREE.DoubleSide
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.05;
      cityGroup.add(ring);

      const label = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', labelH);
      label.position.copy(galaxyPos(section.startStep, 0, 0)).setY(G_H + 2);
      cityGroup.add(label);
    });

    // Etiquetas de pista: todos los brazos nacen juntos en θ = 0, separados
    // apenas una fracción de vuelta; en vez de apilarlas ahí (ilegibles) se
    // reparten en orden en un arco junto al núcleo, retrocediendo desde θ = 0
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 0.9);
      const a = -0.4 * (t + 0.5);
      const r = G_R0 - 1.5;
      sprite.position.set(r * Math.cos(a), 0.3, r * Math.sin(a));
      cityGroup.add(sprite);
    }

    // Núcleo: resplandor tenue que late en tickGalaxy
    const nucleus = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffb547, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    nucleus.scale.set(G_R0 * 3, G_R0 * 3, 1);
    nucleus.position.y = G_H * 0.4;
    cityGroup.add(nucleus);
    gal.nucleus = nucleus;

    // Estrellas: una por nota, en su ataque (el radar las enciende al pasar)
    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;
    const positions = new Float32Array(count * 3);
    const aColor = new Float32Array(count * 3);
    const aSize = new Float32Array(count);
    const aSeed = new Float32Array(count);
    const aStep = new Float32Array(count);
    const tmp = new THREE.Vector3();
    let i = 0;
    for (let t = 0; t < nT; t++) {
      const row = piece.grid[t];
      for (let s = 0; s < piece.totalSteps; s++) {
        const cell = row[s];
        if (!cell) continue;
        const norm = (cell.midi - range.min) / (range.max - range.min);
        // jitter determinista dentro del carril del brazo
        galaxyPos(s + 0.5, t + (hash2(s, t) - 0.5) * 0.6, norm, tmp);
        positions[i * 3] = tmp.x;
        positions[i * 3 + 1] = tmp.y + (hash2(s, t + 40) - 0.5) * 0.4;
        positions[i * 3 + 2] = tmp.z;

        const mc = colors[(cell.motifIndex || 0) % colors.length];
        const c = srgb(mc[0], mc[1], mc[2]).multiplyScalar(0.5 + 0.5 * cell.velocity);
        aColor[i * 3] = c.r;
        aColor[i * 3 + 1] = c.g;
        aColor[i * 3 + 2] = c.b;
        aSize[i] = cell.velocity;
        aSeed[i] = hash2(s, t + 80);
        aStep[i] = s;

        if (!hitIndex.has(s)) hitIndex.set(s, []);
        hitIndex.get(s).push(i);
        i++;
      }
    }
    gal.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogDensity: { value: scene.fog.density },
        uCursorStep: { value: -1 },
        uCursorOn: { value: 0 }
      },
      vertexShader: G_STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    addStarField(positions, aColor, aSize, aSeed, gal.mat, { aStep: new THREE.BufferAttribute(aStep, 1) });

    // Cursor: brazo de radar que gira con la espiral. Lámina vertical, cuña
    // plana de ancho angular fijo y núcleo fino, todos de largo 1 en +X:
    // tickGalaxy los estira hasta el radio del paso actual
    cursorGroup = new THREE.Group();
    const arm = new THREE.Group();
    const sheetGeo = new THREE.PlaneGeometry(1, G_H + 2);
    sheetGeo.translate(0.5, G_H / 2, 0);
    const sheet = new THREE.Mesh(sheetGeo, new THREE.MeshBasicMaterial({
      color: 0xff5a4e, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    const wedgeGeo = new THREE.BufferGeometry();
    wedgeGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, G_ARM_HALF, 1, 0, -G_ARM_HALF
    ], 3));
    const wedge = new THREE.Mesh(wedgeGeo, new THREE.MeshBasicMaterial({
      color: 0xff5a4e, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    wedge.position.y = 0.02;
    const coreGeo = new THREE.BoxGeometry(1, 0.12, 0.12);
    coreGeo.translate(0.5, 0, 0);
    const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
      color: 0xff8a80, transparent: true, opacity: 0.9,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    core.position.y = G_H / 2;
    arm.add(sheet);
    arm.add(wedge);
    arm.add(core);
    cursorGroup.add(arm);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
    Object.assign(gal, { arm, sheet, wedge, core });
  }

  // Coloca el brazo de radar (rotación en Y por −θ: el +X local apunta a
  // (cos θ, 0, sin θ), como galaxyPos) y hace latir el núcleo. El latido es
  // por CPU pero no marca animating: en reposo el render sigue a ~30 fps
  function tickGalaxy() {
    if (cursorGroup && cursorGroup.visible) {
      const len = cursorCur.x + 2;
      gal.arm.rotation.y = -cursorCur.th;
      gal.sheet.scale.x = len;
      gal.wedge.scale.set(len, 1, len);
      gal.core.scale.x = len;
    }
    const pulse = 1 + 0.06 * Math.sin(clock.elapsedTime * 1.6);
    gal.nucleus.scale.set(G_R0 * 3 * pulse, G_R0 * 3 * pulse, 1);
  }

  // ---- Modo jardín ----

  function gdLaneZ(t) {
    return -t * GD_LANE;
  }

  function buildGarden() {
    const nT = piece.numTracks;
    const width = piece.totalSteps * STEP;
    const depth = (nT - 1) * GD_LANE + 3;
    const zc = gdLaneZ(nT - 1) / 2;
    const zFront = GD_JITTER_Z + 1.5;
    const zBack = gdLaneZ(nT - 1) - GD_JITTER_Z - 1.5;
    const range = midiRange(piece.grid);
    const colors = motifColors();

    // Tierra
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width + 30, depth + 26),
      new THREE.MeshBasicMaterial({ color: 0x121210 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(width / 2, -0.05, zc);
    cityGroup.add(floor);

    // Parterres: una losa por sección (alternadas, ámbar si recapitula) con su
    // bordillo y su etiqueta; surcos tenues a lo largo de cada hilera
    const linePos = [];
    const lineCol = [];
    const pushLine = (x0, z0, x1, z1, c) => {
      linePos.push(x0, 0.03, z0, x1, 0.03, z1);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const curb = srgb(150, 135, 105).multiplyScalar(0.45);
    const curbRecap = srgb(255, 181, 71).multiplyScalar(0.5);
    piece.sections.forEach((section, i) => {
      const x0 = section.startStep * STEP + GD_BED_INSET;
      const x1 = (section.startStep + section.lengthSteps) * STEP - GD_BED_INSET;
      const bed = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(x1 - x0, 0.1), zFront - zBack),
        new THREE.MeshBasicMaterial({
          color: section.recap ? srgb(255, 181, 71) : srgb(140, 120, 90),
          transparent: true,
          opacity: section.recap ? 0.07 : (i % 2 === 0 ? 0.06 : 0.03),
          depthWrite: false
        })
      );
      bed.rotation.x = -Math.PI / 2;
      bed.position.set((x0 + x1) / 2, 0.01, (zFront + zBack) / 2);
      cityGroup.add(bed);

      const c = section.recap ? curbRecap : curb;
      pushLine(x0, zFront, x1, zFront, c);
      pushLine(x0, zBack, x1, zBack, c);
      pushLine(x0, zFront, x0, zBack, c);
      pushLine(x1, zFront, x1, zBack, c);

      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 1.7);
      sprite.position.set((x0 + x1) / 2, GD_H + 3.2, zBack - 1.5);
      cityGroup.add(sprite);
    });
    const furrow = srgb(40, 37, 30);
    for (let t = 0; t < nT; t++) pushLine(0, gdLaneZ(t), width, gdLaneZ(t), furrow);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.3);
      sprite.position.set(-2.2, 1.1, gdLaneZ(t));
      cityGroup.add(sprite);
    }

    // Recapitulación por paso (atributo iAmber)
    const recapAt = new Uint8Array(piece.totalSteps);
    piece.sections.forEach(section => {
      if (!section.recap) return;
      const end = Math.min(section.startStep + section.lengthSteps, piece.totalSteps);
      for (let s = section.startStep; s < end; s++) recapAt[s] = 1;
    });

    // Materiales: uno por parte (cada una abre en XZ a su ritmo); la corola
    // es abierta (campana) y la hoja plana: se ven por las dos caras
    const makeMat = (xzMin, xzFrom, side) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uFogColor: { value: scene.fog.color.clone() },
          uFogDensity: { value: scene.fog.density },
          uAmber: { value: srgb(255, 181, 71) },
          uCursorX: { value: 0 },
          uCursorOn: { value: 0 },
          uBaseY: { value: GD_BASE_Y },
          uXZMin: { value: xzMin },
          uXZFrom: { value: xzFrom }
        },
        vertexShader: GD_VERTEX,
        fragmentShader: GD_FRAGMENT,
        side
      });
      shaderMats.push(mat);
      return mat;
    };
    const stemMat = makeMat(0.5, 0.0, THREE.FrontSide);
    const corollaMat = makeMat(0.0, 0.4, THREE.DoubleSide);
    const leafMat = makeMat(0.0, 0.2, THREE.DoubleSide);
    gd = { mats: [stemMat, corollaMat, leafMat] };

    let count = 0;
    for (const row of piece.grid) for (const cell of row) if (cell) count++;

    if (count > 0) {
      // Geometrías con origen en su pivote: tallo y hoja en la base de la
      // flor, la corola en la punta del tallo
      const stemGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 5);
      stemGeo.translate(0, 0.5, 0);
      const bellGeo = new THREE.ConeGeometry(1, 1.2, 7, 1, true);
      bellGeo.rotateX(Math.PI);
      bellGeo.translate(0, 0.6, 0);
      const budGeo = new THREE.SphereGeometry(1, 10, 8);
      budGeo.scale(1, 0.55, 1);
      budGeo.translate(0, 0.35, 0);
      const ringGeo = new THREE.TorusGeometry(0.75, 0.22, 6, 5);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.translate(0, 0.15, 0);
      // Hoja: rombo plano que nace en el tallo y se extiende hacia +X
      const leafGeo = new THREE.BufferGeometry();
      leafGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.06, 0, 0.4, 0.06, GD_LEAF_W / 2, 1, 0.06, 0, 0.4, 0.06, -GD_LEAF_W / 2
      ], 3));
      leafGeo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      leafGeo.setIndex([0, 1, 2, 0, 2, 3]);

      // Todas las partes tienen una instancia por nota con el mismo índice:
      // así comparten iHit (un estampado hace destellar la flor entera), iX e
      // iAmber. Las corolas de otra forma quedan con escala 0
      const stems = new THREE.InstancedMesh(stemGeo, stemMat, count);
      const corollas = [bellGeo, budGeo, ringGeo].map(g => new THREE.InstancedMesh(g, corollaMat, count));
      const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count);
      const stemColor = new Float32Array(count * 3);
      const corollaColor = new Float32Array(count * 3);
      const leafColor = new Float32Array(count * 3);
      const iX = new Float32Array(count);
      const iAmber = new Float32Array(count);
      hitAttr = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1000), 1);

      const stemGreen = srgb(46, 70, 40);
      const leafGreen = srgb(64, 92, 52);
      const tmp = new THREE.Color();
      const dummy = new THREE.Object3D();
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const putColor = (arr, i, c) => {
        arr[i * 3] = c.r;
        arr[i * 3 + 1] = c.g;
        arr[i * 3 + 2] = c.b;
      };
      let i = 0;
      for (let t = 0; t < nT; t++) {
        const row = piece.grid[t];
        for (let s = 0; s < piece.totalSteps; s++) {
          const cell = row[s];
          if (!cell) continue;
          const motif = cell.motifIndex || 0;
          const norm = (cell.midi - range.min) / (range.max - range.min);
          const h = 0.8 + norm * GD_H;
          // El desorden depende del paso dentro de la célula: las
          // repeticiones de una célula son hileras idénticas
          const sc = s % piece.cellLength;
          const x = (s + 0.5) * STEP + (hash2(sc, t) - 0.5) * 2 * GD_JITTER_X;
          const z = gdLaneZ(t) + (hash2(t + 17, sc) - 0.5) * 2 * GD_JITTER_Z;
          iX[i] = x;
          iAmber[i] = recapAt[s];

          dummy.rotation.set(0, 0, 0);
          dummy.position.set(x, GD_BASE_Y, z);
          dummy.scale.set(1, h, 1);
          dummy.updateMatrix();
          stems.setMatrixAt(i, dummy.matrix);

          const r = 0.25 + 0.45 * cell.velocity;
          dummy.position.set(x, GD_BASE_Y + h, z);
          dummy.rotation.set(0, hash2(sc + 31, t) * Math.PI * 2, 0);
          dummy.scale.set(r, r, r);
          dummy.updateMatrix();
          corollas.forEach((mesh, k) => mesh.setMatrixAt(i, k === motif % 3 ? dummy.matrix : zero));

          // la duración se ve como el largo de la hoja, no de la flor
          dummy.position.set(x, GD_BASE_Y, z);
          dummy.rotation.set(0, (hash2(t + 5, sc + 3) - 0.5) * 0.6, 0);
          dummy.scale.set(Math.max((cell.durationSteps || 1) * STEP - 0.2, 0.3), 1, 1);
          dummy.updateMatrix();
          leaves.setMatrixAt(i, dummy.matrix);

          const mc = colors[motif % colors.length];
          const motifCol = srgb(mc[0], mc[1], mc[2]);
          putColor(corollaColor, i, tmp.copy(motifCol).multiplyScalar(0.55 + 0.45 * cell.velocity));
          putColor(stemColor, i, tmp.copy(stemGreen).lerp(motifCol, 0.2));
          putColor(leafColor, i, tmp.copy(leafGreen).lerp(motifCol, 0.15).multiplyScalar(0.8));

          if (!hitIndex.has(s)) hitIndex.set(s, []);
          hitIndex.get(s).push(i);
          i++;
        }
      }
      const xAttr = new THREE.InstancedBufferAttribute(iX, 1);
      const amberAttr = new THREE.InstancedBufferAttribute(iAmber, 1);
      const corollaAttr = new THREE.InstancedBufferAttribute(corollaColor, 3);
      const parts = [
        [stems, new THREE.InstancedBufferAttribute(stemColor, 3)],
        ...corollas.map(mesh => [mesh, corollaAttr]),
        [leaves, new THREE.InstancedBufferAttribute(leafColor, 3)]
      ];
      for (const [mesh, colorAttr] of parts) {
        mesh.geometry.setAttribute('iColor', colorAttr);
        mesh.geometry.setAttribute('iHit', hitAttr);
        mesh.geometry.setAttribute('iX', xAttr);
        mesh.geometry.setAttribute('iAmber', amberAttr);
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        cityGroup.add(mesh);
      }
    }

    // Cursor: regadera de luz — lámina vertical cálida a lo alto del jardín y
    // un núcleo rojo; el brote de las flores lo hace su shader con uCursorX
    cursorGroup = new THREE.Group();
    const cursorH = GD_H + 2.5;
    const sheet = new THREE.Mesh(
      new THREE.BoxGeometry(STEP, cursorH, zFront - zBack),
      new THREE.MeshBasicMaterial({
        color: 0xffb547, transparent: true, opacity: 0.06,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, cursorH, zFront - zBack),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(sheet);
    cursorGroup.add(core);
    cursorGroup.position.set(0.5 * STEP, cursorH / 2, (zFront + zBack) / 2);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // ---- Modo enjambre ----

  // X de un paso: la regla de tiempo y el avance de las bandadas comparten
  // escala, del 15% al 85% del ancho de la caja
  function swX(step) {
    return SW_W * (0.15 + 0.7 * step / piece.totalSteps);
  }

  function buildSwarm(prev) {
    const nT = Math.min(piece.numTracks, SW_MAX);
    const P = SW_PER_TRACK;
    const n = nT * P;
    const colors = motifColors();

    // Suelo tenue con rejilla para dar escala al vuelo
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(SW_W + 12, SW_D + 16),
      new THREE.MeshBasicMaterial({ color: 0x101012 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(SW_W / 2, -0.05, -SW_D / 2 + 3);
    cityGroup.add(floor);

    const linePos = [];
    const lineCol = [];
    const pushLine = (x0, z0, x1, z1, c, y = 0.02) => {
      linePos.push(x0, y, z0, x1, y, z1);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const gridColor = srgb(24, 24, 28);
    for (let x = 0; x <= SW_W; x += 4) pushLine(x, -SW_D, x, 0, gridColor);
    for (let z = 0; z <= SW_D; z += 4) pushLine(0, -z, SW_W, -z, gridColor);

    // Regla de tiempo delante de la caja: tramo por sección (ámbar si
    // recapitula), marca por célula si caben, fronteras de sección y etiquetas
    const sectionColor = srgb(200, 198, 192).multiplyScalar(0.45);
    const recapColor = srgb(255, 181, 71).multiplyScalar(0.8);
    const baseColor = srgb(60, 60, 66);
    const tickColor = srgb(44, 44, 50);
    const rz = SW_RULER_Z;
    const cells = piece.totalSteps / piece.cellLength;
    if (cells <= 256) {
      for (let s = piece.cellLength; s < piece.totalSteps; s += piece.cellLength) {
        pushLine(swX(s), rz - 0.15, swX(s), rz + 0.15, tickColor, 0.03);
      }
    }
    piece.sections.forEach((section, i) => {
      const x0 = swX(section.startStep);
      const x1 = swX(section.startStep + section.lengthSteps);
      pushLine(x0, rz, x1, rz, section.recap ? recapColor : baseColor, 0.03);
      pushLine(x0, rz - 0.45, x0, rz + 0.45, section.recap ? recapColor : sectionColor, 0.03);
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 0.9);
      // alternadas en dos filas para que no se pisen con secciones cortas
      sprite.position.set((x0 + x1) / 2, 0.6, rz + 1.3 + (i % 2) * 1.0);
      cityGroup.add(sprite);
    });
    pushLine(swX(piece.totalSteps), rz - 0.45, swX(piece.totalSteps), rz + 0.45, sectionColor, 0.03);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Colores lineales precalculados: el bucle por frame no crea THREE.Color
    const motifLin = new Float32Array(colors.length * 3);
    colors.forEach((mc, m) => {
      const c = srgb(mc[0], mc[1], mc[2]);
      motifLin[m * 3] = c.r;
      motifLin[m * 3 + 1] = c.g;
      motifLin[m * 3 + 2] = c.b;
    });
    const amber = srgb(255, 181, 71);

    // Estado: se hereda del enjambre anterior si tiene las mismas bandadas
    const keep = prev && prev.nT === nT;
    const pos = keep ? prev.pos : new Float32Array(n * 3);
    const vel = keep ? prev.vel : new Float32Array(n * 3);
    const target = keep ? prev.target : new Float32Array(nT * 3);
    const density = keep ? prev.density : new Float32Array(nT);
    const motif = keep ? prev.motif : new Int32Array(nT);
    const colorTarget = new Float32Array(nT * 3);
    const uniforms = {
      uTime: { value: 0 },
      uHit: { value: new Float32Array(SW_MAX).fill(-1000) },
      uSize: { value: new Float32Array(SW_MAX) },
      uColor: { value: new Float32Array(SW_MAX * 3) }
    };
    for (let t = 0; t < nT; t++) {
      if (!keep) {
        target[t * 3] = swX(0);
        target[t * 3 + 1] = SW_H * 0.5;
        target[t * 3 + 2] = -(t + 0.5) * SW_D / nT;
        motif[t] = t % colors.length;
      }
      const m = motif[t] % colors.length;
      for (let c = 0; c < 3; c++) {
        colorTarget[t * 3 + c] = motifLin[m * 3 + c];
        uniforms.uColor.value[t * 3 + c] = keep ? prev.uniforms.uColor.value[t * 3 + c] : motifLin[m * 3 + c];
      }
    }
    if (!keep) {
      // nube inicial determinista alrededor del objetivo de cada bandada
      for (let i = 0; i < n; i++) {
        const t = Math.floor(i / P);
        pos[i * 3] = target[t * 3] + (hash2(i, 1) - 0.5) * 10;
        pos[i * 3 + 1] = target[t * 3 + 1] + (hash2(i, 2) - 0.5) * 8;
        pos[i * 3 + 2] = target[t * 3 + 2] + (hash2(i, 3) - 0.5) * 8;
        vel[i * 3] = (hash2(i, 4) - 0.5) * 4;
        vel[i * 3 + 1] = (hash2(i, 5) - 0.5) * 2;
        vel[i * 3 + 2] = (hash2(i, 6) - 0.5) * 4;
      }
    }

    // Boids: un único Points cuyas posiciones reescribe tickSwarm
    const aTrack = new Float32Array(n);
    const aSeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      aTrack[i] = Math.floor(i / P);
      aSeed[i] = hash2(i, 7);
    }
    // el atributo usa el array de la simulación: tickSwarm escribe ahí directamente
    const posAttr = new THREE.BufferAttribute(pos, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const boidGeo = new THREE.BufferGeometry();
    boidGeo.setAttribute('position', posAttr);
    boidGeo.setAttribute('aTrack', new THREE.BufferAttribute(aTrack, 1));
    boidGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 1));
    // uniforms compartidos con las estelas: un solo objeto, actualizado una vez
    const boidMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SW_VERTEX,
      fragmentShader: SW_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    shaderMats.push(boidMat);
    const boids = new THREE.Points(boidGeo, boidMat);
    boids.frustumCulled = false;
    cityGroup.add(boids);

    // Estelas: un segmento por boid (cabeza, cola)
    const trailPos = new Float32Array(n * 2 * 3);
    const tTrack = new Float32Array(n * 2);
    const tTail = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      tTrack[i * 2] = tTrack[i * 2 + 1] = aTrack[i];
      tTail[i * 2 + 1] = 1;
      for (let c = 0; c < 3; c++) trailPos[i * 6 + c] = trailPos[i * 6 + 3 + c] = pos[i * 3 + c];
    }
    const trailAttr = new THREE.BufferAttribute(trailPos, 3);
    trailAttr.setUsage(THREE.DynamicDrawUsage);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', trailAttr);
    trailGeo.setAttribute('aTrack', new THREE.BufferAttribute(tTrack, 1));
    trailGeo.setAttribute('aTail', new THREE.BufferAttribute(tTail, 1));
    const trails = new THREE.LineSegments(trailGeo, new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SW_TRAIL_VERTEX,
      fragmentShader: SW_TRAIL_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    }));
    trails.frustumCulled = false;
    cityGroup.add(trails);

    // Etiquetas de pista: siguen el centro de masas de su bandada
    const labels = [];
    for (let t = 0; t < nT; t++) {
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.1);
      sprite.position.set(target[t * 3], target[t * 3 + 1] + 2.5, target[t * 3 + 2]);
      cityGroup.add(sprite);
      labels.push(sprite);
    }

    // Cursor: aro ámbar aditivo tendido sobre la regla, con núcleo
    cursorGroup = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.07, 8, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffb547, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI / 2;
    cursorGroup.add(ring);
    cursorGroup.add(new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    ));
    cursorGroup.position.set(swX(0), 0.1, rz);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);

    sw = {
      nT, n, pos, vel, target, density, motif, colorTarget, uniforms,
      posAttr, trailPos, trailAttr, labels, motifLin,
      amberLin: [amber.r, amber.g, amber.b],
      pulse: new Float32Array(nT),
      cent: target.slice(),
      wander: new Float32Array(n * 3),
      epoch: NaN,
      acc: 0,
      range: midiRange(piece.grid),
      ghost: (typeof Generator !== 'undefined' && Generator.GHOST_VELOCITY) || 0.18
    };
  }

  // Un paso nuevo: decae la densidad, la bandada avanza en X, sube o baja con
  // la altura de su nota, y cada ataque audible la sacude, la hace destellar y
  // la engorda. El color apunta al motivo de la última nota (ámbar en la
  // pista que recapitula); tickSwarm lo funde
  function swarmStep(step) {
    const now = clock.elapsedTime;
    const u = sw.uniforms;
    const P = SW_PER_TRACK;
    let sec = null;
    for (const s of piece.sections) {
      if (step >= s.startStep && step < s.startStep + s.lengthSteps) { sec = s; break; }
    }
    const tx = swX(step + 0.5);
    for (let t = 0; t < sw.nT; t++) {
      sw.density[t] *= SW_DENSITY_DECAY;
      sw.target[t * 3] = tx;
      const cell = piece.grid[t][step];
      if (cell) {
        const norm = Math.min(Math.max((cell.midi - sw.range.min) / (sw.range.max - sw.range.min), 0), 1);
        sw.target[t * 3 + 1] = 0.15 * SW_H + norm * 0.7 * SW_H;
        sw.motif[t] = cell.motifIndex || 0;
        if (cell.velocity > sw.ghost) {
          sw.density[t] += 1;
          sw.pulse[t] = Math.max(sw.pulse[t], cell.velocity);
          u.uHit.value[t] = now;
          // empujón radial desde el centro de la bandada hacia fuera (si fuera
          // desde el objetivo, con la bandada aún lejos la alejaría de él)
          const kick = SW_KICK * cell.velocity;
          const gx = sw.cent[t * 3];
          const gy = sw.cent[t * 3 + 1];
          const gz = sw.cent[t * 3 + 2];
          for (let i = t * P; i < (t + 1) * P; i++) {
            const dx = sw.pos[i * 3] - gx;
            const dy = sw.pos[i * 3 + 1] - gy;
            const dz = sw.pos[i * 3 + 2] - gz;
            const inv = kick / (Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.5);
            sw.vel[i * 3] += dx * inv;
            sw.vel[i * 3 + 1] += dy * inv;
            sw.vel[i * 3 + 2] += dz * inv;
          }
        }
      }
      const recap = sec && sec.recap && sec.recapTrack === t;
      const m = sw.motif[t] % (sw.motifLin.length / 3);
      for (let c = 0; c < 3; c++) {
        sw.colorTarget[t * 3 + c] = recap ? sw.amberLin[c] : sw.motifLin[m * 3 + c];
      }
    }
    dirty = true;
  }

  // Simulación por CPU de todas las bandadas. Reglas por boid: cohesión hacia
  // el centro de su bandada y atracción al objetivo (ambas escalan con la
  // densidad de ataques), alineación y separación con SW_NEIGHBORS vecinos
  // por índice a cada lado (vecindad barata, visualmente suficiente), giro
  // alrededor del objetivo, deriva aleatoria determinista que gana en el
  // silencio (con el radio de separación) y paredes blandas. Todo en arrays
  // tipados preasignados y escalares: ninguna asignación por frame.
  //
  // Tasa: con el cursor visible (en marcha o en pausa) tick marca animating y
  // el render va a plena tasa: la bandada sigue viva en pausa. Parada, sigue
  // volando pero a la tasa de reposo (~30 fps): solo se simula en los frames
  // que se van a pintar, acumulando el dt, y no se marca dirty (forzaría plena
  // tasa; el render de reposo repinta igualmente cada IDLE_FRAME_MS)
  function tickSwarm(dt) {
    const nowMs = performance.now();
    const visible = cursorGroup && cursorGroup.visible;
    sw.acc += dt;
    const idle = !visible && !dirty && !interacting
      && nowMs - lastStepAt >= PLAY_HOLD_MS && nowMs - lastMotionAt >= SETTLE_HOLD_MS;
    if (idle && nowMs - lastRenderAt < IDLE_FRAME_MS) return;
    const h = Math.min(sw.acc, 0.05);   // pestaña oculta: sin saltos
    sw.acc = 0;
    if (h <= 0) return;

    const time = clock.elapsedTime;
    const { nT, pos, vel, target, density, wander, uniforms } = sw;
    const P = SW_PER_TRACK;
    const K = SW_NEIGHBORS;
    const sizes = uniforms.uSize.value;
    const cols = uniforms.uColor.value;
    const tr = sw.trailPos;

    // Sin pasos (pausa o parada) la música calla: las bandadas se deshacen
    if (nowMs - lastStepAt > 600) {
      const f = Math.exp(-h * 0.8);
      for (let t = 0; t < nT; t++) density[t] *= f;
    }
    // Rumbo de deriva por boid, nuevo cada segundo
    const epoch = Math.floor(time);
    if (epoch !== sw.epoch) {
      sw.epoch = epoch;
      for (let i = 0; i < sw.n; i++) {
        wander[i * 3] = hash2(i, epoch) - 0.5;
        wander[i * 3 + 1] = (hash2(i + 7919, epoch) - 0.5) * 0.6;
        wander[i * 3 + 2] = hash2(i + 15887, epoch) - 0.5;
      }
    }
    const kc = 1 - Math.exp(-h * 2);
    const kp = Math.exp(-h * 3);

    for (let t = 0; t < nT; t++) {
      // franja de profundidad propia con deriva lenta: a veces se cruzan
      const tz = Math.min(-1, Math.max(-SW_D + 1,
        -(t + 0.5) * SW_D / nT + Math.sin(time * 0.11 + t * 2.3) * SW_D * 0.2));
      target[t * 3 + 2] = tz;
      const tx = target[t * 3];
      const ty = target[t * 3 + 1];
      for (let c = 0; c < 3; c++) cols[t * 3 + c] += (sw.colorTarget[t * 3 + c] - cols[t * 3 + c]) * kc;
      sw.pulse[t] *= kp;
      const dens = Math.min(density[t] / SW_DENSITY_REF, 1);
      sizes[t] = 0.3 + 0.3 * dens + 0.7 * sw.pulse[t];

      const base = t * P;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let i = base; i < base + P; i++) {
        cx += pos[i * 3];
        cy += pos[i * 3 + 1];
        cz += pos[i * 3 + 2];
      }
      cx /= P;
      cy /= P;
      cz /= P;
      sw.cent[t * 3] = cx;
      sw.cent[t * 3 + 1] = cy;
      sw.cent[t * 3 + 2] = cz;
      sw.labels[t].position.set(cx, cy + 2.5, cz);

      const coh = 0.7 * dens;
      const att = 0.3 + 1.2 * dens;
      const sep = SW_SEP * (1 + 2.5 * (1 - dens));
      const sep2 = sep * sep;
      const wand = 3 + 12 * (1 - dens);
      const swirl = (t % 2 ? 1 : -1) * (1 + 2 * dens);
      const vmax = SW_VMAX * (0.5 + 0.5 * dens);

      for (let l = 0; l < P; l++) {
        const i = base + l;
        const px = pos[i * 3];
        const py = pos[i * 3 + 1];
        const pz = pos[i * 3 + 2];
        let vx = vel[i * 3];
        let vy = vel[i * 3 + 1];
        let vz = vel[i * 3 + 2];

        let ax = (cx - px) * coh;
        let ay = (cy - py) * coh;
        let az = (cz - pz) * coh;
        // atracción al objetivo, que deja de crecer lejos (llegada sin latigazo)
        const gx = tx - px;
        const gy = ty - py;
        const gz = tz - pz;
        const gd = Math.sqrt(gx * gx + gy * gy + gz * gz) + 1e-3;
        const pull = att * Math.min(gd, SW_PULL_MAX) / gd;
        ax += gx * pull;
        ay += gy * pull;
        az += gz * pull;
        // giro alrededor del eje vertical del objetivo
        const rh = Math.sqrt(gx * gx + gz * gz) + 1;
        ax += gz / rh * swirl;
        az -= gx / rh * swirl;

        let avx = 0;
        let avy = 0;
        let avz = 0;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (let k = -K; k <= K; k++) {
          if (k === 0) continue;
          const j = base + (l + k + P) % P;
          avx += vel[j * 3];
          avy += vel[j * 3 + 1];
          avz += vel[j * 3 + 2];
          const dx = px - pos[j * 3];
          const dy = py - pos[j * 3 + 1];
          const dz = pz - pos[j * 3 + 2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < sep2 && d2 > 1e-6) {
            sx += dx / d2;
            sy += dy / d2;
            sz += dz / d2;
          }
        }
        const inv = 1 / (2 * K);
        ax += (avx * inv - vx) * 1.2 + sx * 3;
        ay += (avy * inv - vy) * 1.2 + sy * 3;
        az += (avz * inv - vz) * 1.2 + sz * 3;
        ax += wander[i * 3] * wand;
        ay += wander[i * 3 + 1] * wand;
        az += wander[i * 3 + 2] * wand;

        // paredes blandas de la caja
        if (px < 0) ax -= px * 6; else if (px > SW_W) ax += (SW_W - px) * 6;
        if (py < 0.5) ay += (0.5 - py) * 8; else if (py > SW_H) ay += (SW_H - py) * 6;
        if (pz < -SW_D) az += (-SW_D - pz) * 6; else if (pz > 0) az -= pz * 6;

        vx += ax * h;
        vy += ay * h;
        vz += az * h;
        const sp = Math.sqrt(vx * vx + vy * vy + vz * vz);
        if (sp > vmax) {
          const f = vmax / sp;
          vx *= f; vy *= f; vz *= f;
        } else if (sp < SW_VMIN && sp > 1e-6) {
          const f = SW_VMIN / sp;
          vx *= f; vy *= f; vz *= f;
        }
        const nx = px + vx * h;
        const ny = py + vy * h;
        const nz = pz + vz * h;
        pos[i * 3] = nx;
        pos[i * 3 + 1] = ny;
        pos[i * 3 + 2] = nz;
        vel[i * 3] = vx;
        vel[i * 3 + 1] = vy;
        vel[i * 3 + 2] = vz;

        const o = i * 6;
        tr[o] = nx;
        tr[o + 1] = ny;
        tr[o + 2] = nz;
        tr[o + 3] = nx - vx * SW_TRAIL;
        tr[o + 4] = ny - vy * SW_TRAIL;
        tr[o + 5] = nz - vz * SW_TRAIL;
      }
    }
    sw.posAttr.needsUpdate = true;
    sw.trailAttr.needsUpdate = true;
  }

  // ---- Modo cinta de Möbius ----

  // Parametrización estándar: u ∈ [0, 2π) a lo largo, v ∈ [−1, 1] a lo ancho.
  // P(u + 2π, v) = P(u, −v): al dar la vuelta se vuelve al mismo punto por la
  // otra cara, y la normal llega invertida
  const moA = new THREE.Vector3();
  const moB = new THREE.Vector3();
  const moC = new THREE.Vector3();

  function mobiusU(step) {
    return 2 * Math.PI * step / piece.totalSteps;
  }

  // Centro del carril de la pista t (en v)
  function mobiusLaneV(t) {
    return -1 + (t + 0.5) * 2 / piece.numTracks;
  }

  function mobiusPos(u, v, out) {
    const h = v * mo.W / 2;
    const r = mo.R + h * Math.cos(u / 2);
    return (out || new THREE.Vector3()).set(r * Math.cos(u), h * Math.sin(u / 2), r * Math.sin(u));
  }

  // Base local en (u, v): T = ∂P/∂u, B = ∂P/∂v ortogonalizada contra T y
  // N = T × B, por diferencias centrales. En u = 0, N apunta hacia +Y
  function mobiusFrame(u, v, out) {
    const f = out || { p: new THREE.Vector3(), T: new THREE.Vector3(), B: new THREE.Vector3(), N: new THREE.Vector3() };
    mobiusPos(u, v, f.p);
    f.T.subVectors(mobiusPos(u + MO_EPS, v, moA), mobiusPos(u - MO_EPS, v, moB)).normalize();
    f.B.subVectors(mobiusPos(u, v + MO_EPS, moA), mobiusPos(u, v - MO_EPS, moB));
    f.B.addScaledVector(f.T, -f.B.dot(f.T)).normalize();
    f.N.crossVectors(f.T, f.B).normalize();
    return f;
  }

  // Rotación que lleva X → tangente, Y → normal, Z → −binormal (T × N = −B:
  // base dextrógira; con +B saldría una reflexión y el cuaternión no valdría)
  function mobiusBasis(f, m) {
    return m.makeBasis(f.T, f.N, moC.copy(f.B).negate());
  }

  function buildMobius() {
    const nT = piece.numTracks;
    const total = piece.totalSteps;
    const R = Math.min(MO_R_MAX, Math.max(MO_R_MIN, total * STEP / (2 * Math.PI) * MO_SCALE));
    const W = nT * MO_LANE + 2;
    // el cursor de la vista anterior (aún sin reemplazar) dice si se estaba
    // reproduciendo o en pausa: entonces se empieza en raíl
    const hadCursor = !!(cursorGroup && cursorGroup.visible);
    mo = {
      R, W, hadCursor,
      arcLen: 2 * Math.PI * R / total,
      ahead: MO_LOOK_AHEAD / R,
      back: MO_CAM_BACK / R,
      mat: null,
      frame: null,
      basis: new THREE.Matrix4(),
      railPos: new THREE.Vector3(),
      railSnap: false
    };
    const f = mo.frame = mobiusFrame(0, 0);
    const colors = motifColors();
    const amber = srgb(255, 181, 71);

    // Sección de cada paso, para teñir la cinta
    const stepSection = new Int16Array(total);
    piece.sections.forEach((section, i) => {
      const end = Math.min(section.startStep + section.lengthSteps, total);
      for (let s = section.startStep; s < end; s++) stepSection[s] = i;
    });

    // Cinta: franjas alternadas por sección, ámbar tenue en la recapitulación.
    // La columna u = 2π duplica la u = 0 con v invertido: ningún triángulo
    // cruza la costura, así que aU no salta dentro de un triángulo
    const segU = Math.min(total, MO_SEG_U_MAX);
    const cols = segU + 1;
    const rows = MO_SEG_V + 1;
    const positions = new Float32Array(cols * rows * 3);
    const normals = new Float32Array(cols * rows * 3);
    const aColor = new Float32Array(cols * rows * 3);
    const aU = new Float32Array(cols * rows);
    const base = srgb(46, 46, 54);
    const tmp = new THREE.Color();
    let k = 0;
    for (let i = 0; i < cols; i++) {
      const u = 2 * Math.PI * i / segU;
      const sec = stepSection[Math.min(Math.floor(i * total / segU), total - 1)];
      const section = piece.sections[sec];
      tmp.copy(base);
      if (section && section.recap) tmp.lerp(amber, 0.22);
      else if (sec % 2 === 1) tmp.multiplyScalar(0.72);
      for (let j = 0; j < rows; j++) {
        mobiusFrame(u, -1 + 2 * j / MO_SEG_V, f);
        positions[k * 3] = f.p.x;
        positions[k * 3 + 1] = f.p.y;
        positions[k * 3 + 2] = f.p.z;
        normals[k * 3] = f.N.x;
        normals[k * 3 + 1] = f.N.y;
        normals[k * 3 + 2] = f.N.z;
        // los bordes de la cinta, algo más claros
        const edge = (j === 0 || j === rows - 1) ? 1.35 : 1;
        aColor[k * 3] = tmp.r * edge;
        aColor[k * 3 + 1] = tmp.g * edge;
        aColor[k * 3 + 2] = tmp.b * edge;
        aU[k] = u;
        k++;
      }
    }
    const IndexArray = cols * rows > 65535 ? Uint32Array : Uint16Array;
    const index = new IndexArray(segU * MO_SEG_V * 6);
    let q = 0;
    for (let i = 0; i < segU; i++) {
      for (let j = 0; j < MO_SEG_V; j++) {
        const a = i * rows + j;
        const b = a + 1;
        const c = a + rows;
        const d = c + 1;
        index[q++] = a; index[q++] = c; index[q++] = b;
        index[q++] = b; index[q++] = c; index[q++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aU', new THREE.BufferAttribute(aU, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));

    mo.mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogColor: { value: scene.fog.color.clone() },
        uFogDensity: { value: scene.fog.density },
        uCursorU: { value: 0 },
        uCursorOn: { value: 0 },
        // caída del resplandor: ~0.3 por unidad de arco, como el frente del terreno
        uGlowK: { value: 0.3 * R }
      },
      vertexShader: MOBIUS_VERTEX,
      fragmentShader: MOBIUS_FRAGMENT,
      side: THREE.DoubleSide,
      // la cinta cede en profundidad: las líneas, coplanarias, se ven desde
      // las dos caras
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
    shaderMats.push(mo.mat);
    cityGroup.add(new THREE.Mesh(geo, mo.mat));

    // Carriles (fronteras entre pistas y bordes) a lo largo, fronteras de
    // sección y arranques de bloque a lo ancho, sobre la propia superficie
    const linePos = [];
    const lineCol = [];
    const pushLine = (a, b, c) => {
      linePos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      lineCol.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const laneColor = srgb(60, 60, 92);
    const edgeColor = srgb(110, 108, 104);
    for (let b = 0; b <= nT; b++) {
      const v = -1 + 2 * b / nT;
      const c = (b === 0 || b === nT) ? edgeColor : laneColor;
      mobiusPos(0, v, moA);
      for (let i = 1; i <= segU; i++) {
        mobiusPos(2 * Math.PI * i / segU, v, moB);
        pushLine(moA, moB, c);
        moA.copy(moB);
      }
    }
    const sectionColor = srgb(200, 198, 192).multiplyScalar(0.45);
    const recapColor = amber.clone().multiplyScalar(0.7);
    piece.sections.forEach(section => {
      const u = mobiusU(section.startStep);
      pushLine(mobiusPos(u, -1, moA), mobiusPos(u, 1, moB), section.recap ? recapColor : sectionColor);
    });
    if (piece.blockMarkers) {
      for (const block of piece.blockMarkers) {
        const color = colors[block.motifIndex % colors.length];
        const u = mobiusU(block.startStep);
        const v0 = -1 + 2 * block.trackIndex / nT;
        pushLine(mobiusPos(u, v0, moA), mobiusPos(u, v0 + 2 / nT, moB),
          srgb(color[0], color[1], color[2]).multiplyScalar(0.5));
      }
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.Float32BufferAttribute(lineCol, 3));
    cityGroup.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true })));

    // Etiquetas de sección pasado el borde +v de su arranque y de pista al
    // principio de su carril, levantadas sobre la cara +N
    piece.sections.forEach(section => {
      mobiusFrame(mobiusU(section.startStep), 1.25, f);
      const sprite = makeTextSprite(sectionLabel(section), section.recap ? '#ffb547' : '#a3a19b', 2.0);
      sprite.position.copy(f.p).addScaledVector(f.N, 1.5);
      cityGroup.add(sprite);
    });
    for (let t = 0; t < nT; t++) {
      mobiusFrame(0.02, mobiusLaneV(t), f);
      const sprite = makeTextSprite(String(t + 1).padStart(2, '0'), '#6f6d68', 1.0);
      sprite.position.copy(f.p).addScaledVector(f.N, 1.6);
      cityGroup.add(sprite);
    }

    // Notas: cajas de pie sobre la cara +N, orientadas con la base local para
    // seguir la torsión (largo = duración en arco, alto = velocity). La altura
    // tonal desplaza la nota dentro de su carril: aguda hacia +v, que al
    // principio de la pieza es el borde exterior del anillo
    const laneSpan = 2 / nT * MO_PITCH_SPAN;
    buildNotes((dummy, cell, t, s, durationSteps, norm) => {
      mobiusFrame(mobiusU(s + durationSteps / 2), mobiusLaneV(t) + (norm - 0.5) * laneSpan, f);
      const h = 0.3 + 0.5 * cell.velocity;
      dummy.position.copy(f.p).addScaledVector(f.N, h / 2);
      dummy.quaternion.setFromRotationMatrix(mobiusBasis(f, mo.basis));
      dummy.scale.set(Math.max(durationSteps * mo.arcLen - 0.15, 0.25), h, MO_LANE * 0.6);
    });

    // Cursor: un aro transversal que atraviesa la cinta (visible desde las dos
    // caras); tick lo coloca y orienta con la base local en cursorCur.th
    cursorGroup = new THREE.Group();
    const hoop = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 1.2, W + 1),
      new THREE.MeshBasicMaterial({
        color: 0xff5a4e, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 1.3, W + 1.3),
      new THREE.MeshBasicMaterial({
        color: 0xff8a80, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    );
    cursorGroup.add(hoop);
    cursorGroup.add(core);
    cursorGroup.visible = false;
    cityGroup.add(cursorGroup);
  }

  // Raíl: el objetivo un poco por delante del cursor y la cámara detrás y por
  // encima de la cara actual. N cambia de signo con la torsión, así que al dar
  // la vuelta la cámara ha pasado sola a la otra cara. k = 1 coloca en el acto
  function mobiusRail(u, k) {
    const f = mobiusFrame(u + mo.ahead, 0, mo.frame);
    mo.railPos.copy(f.p).addScaledVector(f.N, 2);
    controls.target.lerp(mo.railPos, k);
    mobiusFrame(u - mo.back, 0, f);
    mo.railPos.copy(f.p).addScaledVector(f.N, MO_CAM_H);
    camera.position.lerp(mo.railPos, k);
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
    if (mode === 'musicbox') {
      const depth = (piece.numTracks - 1) * MB_GAP + 2 * MB_R + 3;
      return { depth, midY: 0.5, centerZ: -(piece.numTracks - 1) * MB_GAP / 2, vertical: 2 * MB_R + 3 };
    }
    if (mode === 'pianola') {
      const depth = piece.numTracks * PL_BAND + 2;
      return { depth, midY: PL_Y, centerZ: -piece.numTracks * PL_BAND / 2, vertical: 6 };
    }
    if (mode === 'loom') {
      const depth = (piece.numTracks - 1) * LM_LANE + 2;
      return { depth, midY: LM_H / 2, centerZ: -(piece.numTracks - 1) * LM_LANE / 2, vertical: LM_H + 3 };
    }
    if (mode === 'garden') {
      const depth = (piece.numTracks - 1) * GD_LANE + 3;
      return { depth, midY: GD_H * 0.45, centerZ: gdLaneZ(piece.numTracks - 1) / 2, vertical: GD_H + 2 };
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
    // el rollo de pianola es plano: se lee mejor desde más arriba; el tapiz
    // del telar es vertical: se mira de frente, apenas oblicuo; el jardín,
    // bajo y oblicuo, como paseando entre los parterres
    const dir = mode === 'pianola' ? new THREE.Vector3(0.15, 0.95, 0.7)
      : mode === 'loom' ? new THREE.Vector3(0.25, 0.3, 1)
      : mode === 'garden' ? new THREE.Vector3(0.3, 0.35, 1)
      : new THREE.Vector3(0.25, 0.42, 1);
    frameSphere(center, radius, dir);
    camera.far = Math.max(camera.far, piece.totalSteps * STEP * 3);
    camera.updateProjectionMatrix();
  }

  function frameFull() {
    if (!piece) return;
    const width = mode === 'musicbox' ? MB_LENGTH_X : piece.totalSteps * STEP;
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

  // Órbita de quintas: vista cenital-oblicua para que el círculo de faros se lea
  function frameFifths() {
    if (!piece || !camera || !fif) return;
    let rMax = F_ORBIT_R;
    for (const sec of fif.sections) rMax = Math.max(rMax, sec.radius + (piece.numTracks - 1) * F_TRACK_GAP);
    frameSphere(new THREE.Vector3(0, F_H / 2, 0), F_R + rMax + 6, new THREE.Vector3(0.2, 0.9, 0.6));
  }

  // Arpa: vista frontal; el arpa entera (cuerdas y regla) cabe en pantalla
  function frameStrings() {
    if (!piece || !camera) return;
    const top = ST_GAP * (Math.min(piece.numTracks, ST_MAX) - 1);
    const height = top - ST_RULER_Y;
    const center = new THREE.Vector3(ST_LEN / 2, (top + ST_RULER_Y) / 2, 0);
    const radius = Math.sqrt((ST_LEN / 2) ** 2 + (height / 2) ** 2) + 2;
    frameSphere(center, radius, new THREE.Vector3(0.05, 0.15, 1));
  }

  // Galaxia: cenital-oblicua; la espiral entera cabe, no hay seguimiento
  function frameGalaxy() {
    if (!piece || !camera || !gal) return;
    frameSphere(new THREE.Vector3(0, G_H / 2, 0), gal.rOuter + 4, new THREE.Vector3(0.15, 1.0, 0.45));
  }

  // Enjambre: la caja entera (y la regla de delante) en pantalla, sin seguimiento
  function frameSwarm() {
    if (!piece || !camera) return;
    const radius = Math.sqrt((SW_W / 2) ** 2 + (SW_H / 2) ** 2 + (SW_D / 2) ** 2) + 2;
    frameSphere(new THREE.Vector3(SW_W / 2, SW_H / 2, -SW_D / 2 + 2), radius, new THREE.Vector3(0.2, 0.35, 1));
  }

  // Cinta de Möbius, vista general: la cinta entera, cenital-oblicua
  function frameMobius() {
    if (!piece || !camera || !mo) return;
    frameSphere(new THREE.Vector3(0, 0, 0), mo.R + mo.W, new THREE.Vector3(0.3, 0.8, 0.6));
  }

  // En raíl: la cámara se coloca en el acto en la posición de seguimiento del
  // cursor (o del principio); la neblina vela el fondo de la cinta
  function frameMobiusRail() {
    if (!piece || !camera || !mo) return;
    mobiusRail(cursorStepLast >= 0 ? cursorCur.th : 0, 1);
    camera.near = 0.1;
    camera.far = (mo.R + mo.W) * 4 + 100;
    camera.updateProjectionMatrix();
    controls.update();
    setFogDensity(0.5 / (mo.R * 0.6));
  }

  // ---- Interfaz común ----

  function setMode(m) {
    if (!['city', 'tunnel', 'terrain', 'stars', 'musicbox', 'fifths', 'pianola', 'loom', 'strings', 'galaxy', 'garden', 'swarm', 'mobius'].includes(m)) return;
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
    } else if (mode === 'musicbox') {
      cursorTarget.x = mbX(step + 0.5);
      cursorTarget.th = 2 * Math.PI * (step + 0.5) / piece.cellLength;
    } else if (mode === 'fifths' && fif) {
      // la nave vuela por el radio medio de la órbita, a media altura tonal
      const p = fifthsPos(step + 0.5, -1);
      cursorTarget.x = p.x;
      cursorTarget.y = 0.6 + F_H / 2;
      cursorTarget.z = p.z;
    } else if (mode === 'strings') {
      // la regla de tiempo mide ST_LEN para toda la pieza: otra escala de X
      cursorTarget.x = ST_LEN * (step + 0.5) / piece.totalSteps;
    } else if (mode === 'galaxy' && gal) {
      // x = largo del brazo de radar (hasta el brazo de la última pista);
      // th crece sin módulo, como en el túnel, para que la interpolación no salte
      cursorTarget.x = galaxyR(step + 0.5) + (piece.numTracks - 1) * gal.laneGap;
      cursorTarget.th = galaxyTheta(step + 0.5);
      gal.mat.uniforms.uCursorStep.value = step;
    } else if (mode === 'swarm') {
      // indicador sobre la regla de tiempo, en la misma escala que el avance
      // de las bandadas
      cursorTarget.x = swX(step + 0.5);
    } else if (mode === 'mobius' && mo) {
      // th continuo, sin módulo, como en el túnel: la pieza da una sola vuelta
      cursorTarget.th = mobiusU(step + 0.5);
      // tras un rebuild en raíl, la cámara salta con el cursor en vez de
      // cruzar el anillo desde el principio
      if (cursorSnap && insideView) mo.railSnap = true;
    } else {
      cursorTarget.x = (step + 0.5) * STEP;
    }
    if (cursorSnap) {
      cursorCur.x = cursorTarget.x;
      cursorCur.th = cursorTarget.th;
      cursorCur.y = cursorTarget.y;
      cursorCur.z = cursorTarget.z;
      cursorSnap = false;
    }
    cursorGroup.visible = true;
    if (terrainMat) terrainMat.uniforms.uCursorOn.value = 1;
    if (loomMat) loomMat.uniforms.uCursorOn.value = 1;
    if (gal) gal.mat.uniforms.uCursorOn.value = 1;
    if (gd) for (const m of gd.mats) m.uniforms.uCursorOn.value = 1;
    if (mo) mo.mat.uniforms.uCursorOn.value = 1;
    dirty = true;
    if (step === cursorStepLast) return;
    // Duración real de un paso, suavizada entre pasos consecutivos: la pianola
    // mantiene encendido cada agujero mientras dura su nota
    const nowMs = performance.now();
    if (step === cursorStepLast + 1 && nowMs - lastStepAt < 2000) {
      stepSec += ((nowMs - lastStepAt) / 1000 - stepSec) * 0.25;
      if (pl) {
        pl.holeMat.uniforms.uStepSec.value = stepSec;
        pl.spotMat.uniforms.uStepSec.value = stepSec;
      }
    }
    cursorStepLast = step;
    lastStepAt = nowMs;
    if (st) pluckStrings(step);
    if (sw) swarmStep(step);
    const hits = hitIndex.get(step);
    if (hits && hitAttr) {
      const now = clock.elapsedTime;
      // Subida parcial: three fusiona los rangos y los limpia al subir, así que
      // se acumulan entre renders (no limpiar aquí: se perderían disparos). Sin
      // render (pestaña oculta) se colapsan en uno que cubre todo el atributo
      if (hitAttr.updateRanges.length > MAX_HIT_RANGES) {
        hitAttr.clearUpdateRanges();
        hitAttr.addUpdateRange(0, hitAttr.array.length);
      }
      for (const i of hits) {
        hitAttr.setX(i, now);
        hitAttr.addUpdateRange(i, 1);
      }
      hitAttr.needsUpdate = true;
    }
  }

  function clearCursor() {
    cursorStepLast = -1;
    if (cursorGroup) cursorGroup.visible = false;
    if (terrainMat) terrainMat.uniforms.uCursorOn.value = 0;
    if (loomMat) loomMat.uniforms.uCursorOn.value = 0;
    if (gal) gal.mat.uniforms.uCursorOn.value = 0;
    if (gd) for (const m of gd.mats) m.uniforms.uCursorOn.value = 0;
    if (mo) mo.mat.uniforms.uCursorOn.value = 0;
    dirty = true;
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
    let animating = false;

    if (cursorGroup && cursorGroup.visible) {
      animating = Math.abs(cursorTarget.x - cursorCur.x) > 1e-3
        || Math.abs(cursorTarget.th - cursorCur.th) > 1e-4
        || Math.abs(cursorTarget.y - cursorCur.y) > 1e-3
        || Math.abs(cursorTarget.z - cursorCur.z) > 1e-3;
      const k = 1 - Math.exp(-dt * 14);
      cursorCur.x += (cursorTarget.x - cursorCur.x) * k;
      cursorCur.th += (cursorTarget.th - cursorCur.th) * k;
      cursorCur.y += (cursorTarget.y - cursorCur.y) * k;
      cursorCur.z += (cursorTarget.z - cursorCur.z) * k;

      let followX = null;
      if (mode === 'fifths' && fif) {
        cursorGroup.position.set(cursorCur.x, cursorCur.y, cursorCur.z);
        // la cámara orbita con la nave: objetivo y cámara se deslizan en el
        // plano XZ hacia ella, conservando el ángulo y la distancia del usuario
        if (follow && cursorStepLast >= 0) {
          const kf = 1 - Math.exp(-dt * 3);
          const dx = (cursorCur.x - controls.target.x) * kf;
          const dz = (cursorCur.z - controls.target.z) * kf;
          controls.target.x += dx;
          controls.target.z += dz;
          camera.position.x += dx;
          camera.position.z += dz;
        }
      } else if (mode === 'tunnel' && spokeGroup && tun) {
        spokeGroup.rotation.x = cursorCur.th;
        spokeGroup.position.set(cursorCur.x, tun.rMid * Math.cos(cursorCur.th), tun.rMid * Math.sin(cursorCur.th));
        ringMesh.position.x = cursorCur.x;
        followX = cursorCur.x + TURN_PITCH * 0.4;
      } else if (mode === 'musicbox' && mb) {
        // los rodillos giran (pinos en shader, cilindros por rotación) y el
        // aro marcador avanza por el eje
        mb.pinMat.uniforms.uRoll.value = -cursorCur.th;
        for (const roller of mb.rollers) roller.rotation.x = -cursorCur.th;
        mb.marker.position.x = cursorCur.x;
        followX = cursorCur.x;
      } else if (mode === 'strings') {
        // la cámara no sigue: el arpa entera cabe en pantalla
        cursorGroup.position.x = cursorCur.x;
      } else if (mode === 'galaxy') {
        // sin seguimiento: la galaxia entera cabe; el radar lo coloca tickGalaxy
      } else if (mode === 'swarm') {
        // sin seguimiento: la caja entera cabe. La bandada vive mientras haya
        // cursor (también en pausa): plena tasa
        cursorGroup.position.x = cursorCur.x;
        animating = true;
      } else if (mode === 'mobius' && mo) {
        const u = cursorCur.th;
        const f = mobiusFrame(u, 0, mo.frame);
        cursorGroup.position.copy(f.p);
        cursorGroup.quaternion.setFromRotationMatrix(mobiusBasis(f, mo.basis));
        mo.mat.uniforms.uCursorU.value = u;
        // A diferencia de los modos axiales (que conservan el ángulo del
        // usuario), con «Seguir» en la vista en raíl la cámara va en raíl:
        // posición y objetivo los dicta la cinta. En la vista general no sigue
        if (follow && insideView && cursorStepLast >= 0) {
          mobiusRail(u, mo.railSnap ? 1 : 1 - Math.exp(-dt * 2.5));
          mo.railSnap = false;
        }
      } else {
        cursorGroup.position.x = cursorCur.x;
        if (terrainMat) terrainMat.uniforms.uCursorX.value = cursorCur.x;
        if (loomMat) loomMat.uniforms.uCursorX.value = cursorCur.x;
        if (gd) for (const m of gd.mats) m.uniforms.uCursorX.value = cursorCur.x;
        followX = cursorCur.x;
      }

      // Seguimiento: cámara y objetivo se deslizan por el eje del tiempo con el
      // cursor, conservando el ángulo y la distancia que haya elegido el usuario
      if (follow && cursorStepLast >= 0 && followX !== null) {
        const shift = (followX - controls.target.x) * (1 - Math.exp(-dt * 3));
        controls.target.x += shift;
        camera.position.x += shift;
      }
    }
    if (mode === 'fifths' && fif) tickFifths();
    if (mode === 'galaxy' && gal) tickGalaxy();
    if (mode === 'swarm' && sw) tickSwarm(dt);

    // Damping y seguimiento avanzan en cada frame; el render baja a
    // ~30 fps en reposo. Las animaciones de reposo dependen de uTime, que sigue
    // el reloj real, así que solo pierden fluidez
    controls.update();
    const now = performance.now();
    const fullRate = dirty || animating || interacting
      || now - lastStepAt < PLAY_HOLD_MS
      || now - lastMotionAt < SETTLE_HOLD_MS;
    if (!fullRate && now - lastRenderAt < IDLE_FRAME_MS) return;
    lastRenderAt = now;
    dirty = false;

    for (const m of shaderMats) {
      if (m.uniforms.uTime) m.uniforms.uTime.value = clock.elapsedTime;
    }
    renderer.render(scene, camera);
  }

  return { init, renderPiece, setCursor, clearCursor, setActive, setMode };
})();
