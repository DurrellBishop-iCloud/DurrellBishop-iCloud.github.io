import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ROBOT_COLORS = {
  white: "#ffffff",
  black: "#111318",
  red: "#c71924",
  yellow: "#f0bf1f",
  navy: "#10284c",
  grey: "#d8d6cd",
  coral: "#e95542",
  mint: "#53a889",
  pink: "#e784a7",
  cobalt: "#324f9f",
  lilac: "#9c8fd1",
  ochre: "#c78f21"
};

const COLOR_PALETTES = [
  {
    name: "Robot classic",
    paper: ROBOT_COLORS.white,
    ink: ROBOT_COLORS.black,
    colors: [
      ROBOT_COLORS.white,
      ROBOT_COLORS.black,
      ROBOT_COLORS.red,
      ROBOT_COLORS.yellow,
      ROBOT_COLORS.navy,
      ROBOT_COLORS.grey
    ]
  },
  {
    name: "Milan blocks",
    paper: "#f8efd9",
    ink: "#171415",
    colors: ["#f8efd9", "#171415", "#e14f37", "#f2c542", "#2d766b", "#e787a8", "#4257a6", "#8fb35f"]
  },
  {
    name: "Cut paper acid",
    paper: "#fff7e7",
    ink: "#111318",
    colors: ["#fff7e7", "#111318", "#ff5d53", "#ffd642", "#27a7a0", "#ff8ab3", "#5b64bf", "#f07b2f"]
  },
  {
    name: "Painted wood",
    paper: "#efe6d1",
    ink: "#1e1b19",
    colors: ["#efe6d1", "#1e1b19", "#be342c", "#d9a62f", "#416c4f", "#d9866f", "#2e5c94", "#c8c5b4"]
  },
  {
    name: "Studio night",
    paper: "#f4ead5",
    ink: "#0f1525",
    colors: ["#f4ead5", "#0f1525", "#e63f5a", "#f0c51f", "#168b89", "#8f78c8", "#f18a3b", "#b9d77a"]
  },
  {
    name: "Soft construction",
    paper: "#f7f0e8",
    ink: "#232426",
    colors: ["#f7f0e8", "#232426", "#d84a40", "#e6b949", "#7896b8", "#e3a0bc", "#637d4f", "#c96f4d"]
  }
];

const DEFAULT_PALETTE = COLOR_PALETTES[0];
const HOLD_START_DELAY_MS = 220;
const LIVE_VERSION_INTERVAL_MS = 1000;
const textureCache = new Map();

const els = {
  video: document.querySelector("#cameraVideo"),
  robotCanvas: document.querySelector("#robotCanvas"),
  captureCanvas: document.querySelector("#captureCanvas"),
  shutter: document.querySelector("#shutterButton"),
  status: document.querySelector("#appStatus")
};

const state = {
  mode: "camera",
  stream: null,
  starting: false,
  processing: false,
  lastSilhouettes: [],
  buildSerial: 0,
  lastBuildOptions: null,
  pointerDown: false,
  holdStartTimer: null,
  liveTimer: null,
  liveActive: false,
  ignoreNextClick: false,
  ignoreClickTimer: null
};

let renderer;
let scene;
let camera;
let controls;
let shapeGroup;

const params = new URLSearchParams(window.location.search);

initScene();
bindEvents();
startCamera();

if (params.has("testImage")) {
  window.setTimeout(() => runImageTest(params.get("testImage")), 500);
} else if (params.has("test")) {
  window.setTimeout(runTestCapture, 500);
}

if (params.has("autohold")) {
  window.setTimeout(runAutoHoldTest, 900);
}

animate();

function bindEvents() {
  els.shutter.addEventListener("pointerdown", onShutterPointerDown);
  els.shutter.addEventListener("pointerup", onShutterPointerUp);
  els.shutter.addEventListener("pointercancel", stopLiveGeneration);
  els.shutter.addEventListener("lostpointercapture", stopLiveGeneration);
  els.shutter.addEventListener("contextmenu", (event) => event.preventDefault());
  els.shutter.addEventListener("click", (event) => {
    if (state.ignoreNextClick) {
      state.ignoreNextClick = false;
      if (state.ignoreClickTimer) {
        window.clearTimeout(state.ignoreClickTimer);
        state.ignoreClickTimer = null;
      }
      event.preventDefault();
      return;
    }
    runSingleShutterAction();
  });

  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("orientationchange", () => window.setTimeout(resizeRenderer, 250));
}

function onShutterPointerDown(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;

  event.preventDefault();
  state.pointerDown = true;
  ignoreUpcomingClick();
  els.shutter.setPointerCapture?.(event.pointerId);
  clearHoldStartTimer();
  state.holdStartTimer = window.setTimeout(beginLiveGeneration, HOLD_START_DELAY_MS);
}

function onShutterPointerUp(event) {
  if (!state.pointerDown) return;

  event.preventDefault();
  state.pointerDown = false;
  clearHoldStartTimer();

  if (state.liveActive) {
    stopLiveGeneration();
    return;
  }

  runSingleShutterAction();
}

async function runSingleShutterAction() {
  if (state.processing || state.starting) return;

  if (!state.stream) {
    if (params.has("test")) {
      runTestCapture();
      return;
    }
    await startCamera();
    return;
  }

  if (state.mode === "result") {
    showCamera();
    return;
  }

  captureAndBuild();
}

async function beginLiveGeneration() {
  if (!state.pointerDown || state.liveActive) return;

  state.liveActive = true;
  setStateClass("is-live-cycling", true);
  els.shutter.setAttribute("aria-label", "Generating robot versions");

  if (!state.stream && !params.has("test")) {
    await startCamera();
  }

  if (!state.pointerDown || (!state.stream && !params.has("test"))) {
    stopLiveGeneration();
    return;
  }

  captureLiveVersion();
}

function captureLiveVersion() {
  if (!state.liveActive) return;

  if (!state.processing) {
    if (state.stream) {
      captureAndBuild({ live: true });
    } else if (params.has("test")) {
      runTestCapture({ live: true });
    }
  }

  state.liveTimer = window.setTimeout(captureLiveVersion, LIVE_VERSION_INTERVAL_MS);
}

function stopLiveGeneration() {
  state.pointerDown = false;
  state.liveActive = false;
  clearHoldStartTimer();
  if (state.liveTimer) {
    window.clearTimeout(state.liveTimer);
    state.liveTimer = null;
  }
  setStateClass("is-live-cycling", false);

  if (state.mode === "result") {
    els.shutter.setAttribute("aria-label", "Take another photo");
  } else {
    els.shutter.setAttribute("aria-label", "Take photo");
  }
}

function clearHoldStartTimer() {
  if (!state.holdStartTimer) return;
  window.clearTimeout(state.holdStartTimer);
  state.holdStartTimer = null;
}

function ignoreUpcomingClick() {
  state.ignoreNextClick = true;
  if (state.ignoreClickTimer) window.clearTimeout(state.ignoreClickTimer);
  state.ignoreClickTimer = window.setTimeout(() => {
    state.ignoreNextClick = false;
    state.ignoreClickTimer = null;
  }, 500);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia || state.starting) return;

  setStateClass("is-starting", true);
  state.starting = true;
  setStatus("Starting camera");

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1440 }
      }
    });
    state.stream = stream;
    els.video.srcObject = stream;
    await els.video.play();
    showCamera();
    setStatus("Camera ready");
  } catch (error) {
    console.error(error);
    setStatus("Camera unavailable");
    setStateClass("is-error", true);
  } finally {
    state.starting = false;
    setStateClass("is-starting", false);
  }
}

function showCamera() {
  state.mode = "camera";
  document.body.classList.remove("is-error", "is-result");
  els.shutter.setAttribute("aria-label", "Take photo");
  setStatus("Camera ready");
}

function showResult() {
  state.mode = "result";
  document.body.classList.remove("is-error");
  document.body.classList.add("is-result");
  if (!state.liveActive) {
    els.shutter.setAttribute("aria-label", "Take another photo");
  }
  const paletteName = state.lastBuildOptions?.palette?.name;
  setStatus(`${state.lastSilhouettes.length} shapes converted${paletteName ? ` in ${paletteName}` : ""}`);
}

function setStateClass(className, enabled) {
  document.body.classList.toggle(className, enabled);
}

function setStatus(message) {
  els.status.textContent = message;
}

function resolveBuildOptions(options = {}) {
  if (options.palette) return options;

  const variant = Number.isFinite(options.variant) ? options.variant : state.buildSerial++;
  const paletteIndex = positiveMod(
    Number.isFinite(options.paletteIndex) ? options.paletteIndex : variant,
    COLOR_PALETTES.length
  );

  return {
    ...options,
    variant,
    paletteIndex,
    palette: COLOR_PALETTES[paletteIndex]
  };
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function initScene() {
  renderer = new THREE.WebGLRenderer({
    canvas: els.robotCanvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7d4ca);

  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.2, 7.5);

  controls = new OrbitControls(camera, els.robotCanvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.enablePan = false;
  controls.target.set(0, 0, 0);
  controls.minDistance = 3.4;
  controls.maxDistance = 12;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a867b, 1.25);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3.2, 5.8, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 18;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.035;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xdceaff, 1.05);
  fill.position.set(-4.8, 2.4, 4.5);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xfff4dd, 1.65);
  rim.position.set(-5, 3.2, -6);
  scene.add(rim);

  const gloss = new THREE.PointLight(0xffffff, 1.05, 10);
  gloss.position.set(0.8, 2.6, 3.2);
  scene.add(gloss);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 10),
    new THREE.ShadowMaterial({ color: 0x111318, opacity: 0.14 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.85;
  floor.receiveShadow = true;
  scene.add(floor);

  shapeGroup = new THREE.Group();
  scene.add(shapeGroup);

  resizeRenderer();
}

function resizeRenderer() {
  const rect = els.robotCanvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  requestAnimationFrame(animate);
  if (state.mode === "result") {
    shapeGroup.rotation.y += 0.0035;
  }
  controls.update();
  renderer.render(scene, camera);
}

function captureAndBuild(options = {}) {
  if (state.processing) return false;

  if (!els.video.videoWidth || !els.video.videoHeight) {
    setStatus("Camera not ready");
    return false;
  }

  const buildOptions = resolveBuildOptions(options);
  state.processing = true;
  setStateClass("is-processing", true);
  setStatus(buildOptions.live ? `Reading ${buildOptions.palette.name}` : "Reading shapes");

  window.requestAnimationFrame(() => {
    const canvas = els.captureCanvas;
    const maxSide = 1440;
    const videoWidth = els.video.videoWidth;
    const videoHeight = els.video.videoHeight;
    const scale = Math.min(1, maxSide / Math.max(videoWidth, videoHeight));
    canvas.width = Math.round(videoWidth * scale);
    canvas.height = Math.round(videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(els.video, 0, 0, canvas.width, canvas.height);
    buildFromCanvas(canvas, buildOptions);
  });

  return true;
}

function buildFromCanvas(canvas, options = {}) {
  const buildOptions = resolveBuildOptions(options);

  try {
    const silhouettes = detectWhiteSilhouettes(canvas, buildOptions);
    state.lastSilhouettes = silhouettes;
    state.lastBuildOptions = buildOptions;
    rebuildScene(silhouettes);
    resetView(silhouettes);
    showResult();
  } catch (error) {
    console.error(error);
    setStatus("Could not read shapes");
    setStateClass("is-error", true);
  } finally {
    state.processing = false;
    setStateClass("is-processing", false);
  }
}

function detectWhiteSilhouettes(sourceCanvas, options = {}) {
  const processCanvas = document.createElement("canvas");
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  processCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  processCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));

  const ctx = processCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, processCanvas.width, processCanvas.height);

  const image = ctx.getImageData(0, 0, processCanvas.width, processCanvas.height);
  const metrics = getPixelMetrics(image.data);
  const mask = makeWhiteMask(metrics, image.width, image.height);
  const components = findComponents(mask, image.width, image.height);
  const rawSilhouettes = components
    .map((component) => componentToSilhouette(component, mask, image.width, image.height))
    .filter(Boolean);

  return normalizeSilhouettes(rawSilhouettes, image.width, image.height, options);
}

function getPixelMetrics(data) {
  const length = data.length / 4;
  const luminance = new Uint8Array(length);
  const minChannel = new Uint8Array(length);
  const chroma = new Uint8Array(length);
  const whiteScore = new Uint8Array(length);

  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const low = Math.min(r, g, b);
    const high = Math.max(r, g, b);
    const spread = high - low;

    luminance[p] = y;
    minChannel[p] = low;
    chroma[p] = spread;
    whiteScore[p] = clampByte(y * 0.58 + low * 0.62 - spread * 1.25);
  }

  return { luminance, minChannel, chroma, whiteScore };
}

function makeWhiteMask(metrics, width, height) {
  const { luminance, minChannel, chroma, whiteScore } = metrics;
  const scoreHistogram = valueHistogram(whiteScore);
  const lumaHistogram = valueHistogram(luminance);
  const backgroundScore = percentileFromHistogram(scoreHistogram, 0.58, whiteScore.length);
  const highScore = percentileFromHistogram(scoreHistogram, 0.985, whiteScore.length);
  const backgroundLuma = percentileFromHistogram(lumaHistogram, 0.58, luminance.length);
  const highLuma = percentileFromHistogram(lumaHistogram, 0.985, luminance.length);
  const scoreThreshold = clamp(backgroundScore + (highScore - backgroundScore) * 0.52, 132, 212);
  const lumaThreshold = clamp(backgroundLuma + (highLuma - backgroundLuma) * 0.48, 118, 205);
  const minChannelThreshold = clamp(backgroundLuma + (highLuma - backgroundLuma) * 0.34, 92, 182);
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < whiteScore.length; i += 1) {
    const y = luminance[i];
    const score = whiteScore[i];
    const maxChroma = y > 188 ? 64 : 48;
    const isPaperWhite =
      score >= scoreThreshold &&
      y >= lumaThreshold &&
      minChannel[i] >= minChannelThreshold &&
      chroma[i] <= maxChroma;
    const isVeryBrightNeutral =
      score >= scoreThreshold + 24 &&
      y >= lumaThreshold + 8 &&
      minChannel[i] >= minChannelThreshold + 8 &&
      chroma[i] <= maxChroma + 10;

    mask[i] = isPaperWhite || isVeryBrightNeutral ? 1 : 0;
  }

  return closeMask(openMask(mask, width, height), width, height);
}

function valueHistogram(values) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;
  return histogram;
}

function percentileFromHistogram(histogram, percentile, total) {
  const target = Math.max(0, Math.min(total - 1, Math.floor(total * percentile)));
  let count = 0;

  for (let value = 0; value < histogram.length; value += 1) {
    count += histogram[value];
    if (count > target) return value;
  }

  return histogram.length - 1;
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function openMask(mask, width, height) {
  return dilateMask(erodeMask(mask, width, height), width, height);
}

function closeMask(mask, width, height) {
  return erodeMask(dilateMask(mask, width, height), width, height);
}

function erodeMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      next[i] =
        mask[i] &&
        mask[i - 1] &&
        mask[i + 1] &&
        mask[i - width] &&
        mask[i + width]
          ? 1
          : 0;
    }
  }
  return next;
}

function dilateMask(mask, width, height) {
  const next = new Uint8Array(mask.length);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      next[i] =
        mask[i] ||
        mask[i - 1] ||
        mask[i + 1] ||
        mask[i - width] ||
        mask[i + width]
          ? 1
          : 0;
    }
  }
  return next;
}

function findComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const components = [];
  const minArea = Math.max(32, Math.floor(width * height * 0.0015));
  const maxArea = Math.floor(width * height * 0.88);

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    const pixels = [];

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      const y = Math.floor(index / width);

      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      pixels.push(index);

      const neighbors = [index - 1, index + 1, index - width, index + width];
      for (const next of neighbors) {
        if (next < 0 || next >= mask.length || visited[next] || !mask[next]) continue;
        const nx = next % width;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    const componentWidth = maxX - minX + 1;
    const componentHeight = maxY - minY + 1;
    const fill = area / (componentWidth * componentHeight);

    if (area < minArea || area > maxArea) continue;
    if (componentWidth < 5 || componentHeight < 5) continue;
    if (fill < 0.18 && area < width * height * 0.035) continue;

    components.push({
      area,
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      width: componentWidth,
      height: componentHeight,
      fill,
      cx: sumX / area,
      cy: sumY / area
    });
  }

  return components.sort((a, b) => b.area - a.area).slice(0, 18);
}

function componentToSilhouette(component, mask, width, height) {
  const boundary = [];

  for (const index of component.pixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    if (
      x === 0 ||
      y === 0 ||
      x === width - 1 ||
      y === height - 1 ||
      !mask[index - 1] ||
      !mask[index + 1] ||
      !mask[index - width] ||
      !mask[index + width]
    ) {
      boundary.push({ x, y });
    }
  }

  if (boundary.length < 8) return null;

  const ordered = radialBoundary(boundary, component.cx, component.cy, Math.max(36, Math.min(112, Math.round(Math.sqrt(boundary.length) * 3))));

  const simplified = simplifyClosedPath(ordered, Math.max(1.2, Math.min(component.width, component.height) * 0.018));
  if (simplified.length < 3) return null;

  const holes = findComponentHoles(component, mask, width, height);
  const fill = component.area / (component.width * component.height);
  const aspect = component.width / component.height;
  const outerLooksCurved = isCurvedClosedPath(simplified, {
    aspect,
    fill,
    minPoints: 14,
    maxRadialVariance: 0.18
  });

  return {
    points: simplified,
    holes,
    smoothOuter: outerLooksCurved,
    edgeMode: outerLooksCurved && holes.length === 0 ? "round" : "sharp",
    fill,
    aspect,
    radialVariance: radialVarianceRatio(simplified),
    area: component.area,
    bounds: {
      minX: component.minX,
      minY: component.minY,
      maxX: component.maxX,
      maxY: component.maxY,
      width: component.width,
      height: component.height
    }
  };
}

function radialBoundary(boundary, cx, cy, bins) {
  const radial = new Array(bins);

  for (const point of boundary) {
    let angle = Math.atan2(point.y - cy, point.x - cx);
    if (angle < 0) angle += Math.PI * 2;
    const bin = Math.min(bins - 1, Math.floor((angle / (Math.PI * 2)) * bins));
    const distance = (point.x - cx) ** 2 + (point.y - cy) ** 2;
    if (!radial[bin] || distance > radial[bin].distance) {
      radial[bin] = { ...point, distance, angle };
    }
  }

  return radial
    .filter(Boolean)
    .sort((a, b) => a.angle - b.angle)
    .map(({ x, y }) => ({ x, y }));
}

function findComponentHoles(component, mask, width, height) {
  const pad = 2;
  const localWidth = component.width + pad * 2;
  const localHeight = component.height + pad * 2;
  const local = new Uint8Array(localWidth * localHeight);

  for (const index of component.pixels) {
    const x = index % width;
    const y = Math.floor(index / width);
    const lx = x - component.minX + pad;
    const ly = y - component.minY + pad;
    local[ly * localWidth + lx] = 1;
  }

  const outside = floodLocalOutside(local, localWidth, localHeight);
  const visited = new Uint8Array(local.length);
  const queue = new Int32Array(local.length);
  const holes = [];
  const minHoleArea = Math.max(22, Math.floor(component.area * 0.025));

  for (let start = 0; start < local.length; start += 1) {
    if (local[start] || outside[start] || visited[start]) continue;

    let head = 0;
    let tail = 0;
    let area = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = localWidth;
    let minY = localHeight;
    let maxX = 0;
    let maxY = 0;
    const pixels = [];

    queue[tail++] = start;
    visited[start] = 1;

    while (head < tail) {
      const index = queue[head++];
      const x = index % localWidth;
      const y = Math.floor(index / localWidth);
      area += 1;
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      pixels.push(index);

      const neighbors = [index - 1, index + 1, index - localWidth, index + localWidth];
      for (const next of neighbors) {
        if (next < 0 || next >= local.length || visited[next] || local[next] || outside[next]) continue;
        const nx = next % localWidth;
        if (Math.abs(nx - x) > 1) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }

    const holeWidth = maxX - minX + 1;
    const holeHeight = maxY - minY + 1;
    if (area < minHoleArea || holeWidth < 6 || holeHeight < 6) continue;

    const cx = sumX / area;
    const cy = sumY / area;
    const boundary = [];
    for (const index of pixels) {
      const x = index % localWidth;
      const y = Math.floor(index / localWidth);
      if (
        x === 0 ||
        y === 0 ||
        x === localWidth - 1 ||
        y === localHeight - 1 ||
        local[index - 1] ||
        local[index + 1] ||
        local[index - localWidth] ||
        local[index + localWidth]
      ) {
        boundary.push({ x, y });
      }
    }

    const points = radialBoundary(boundary, cx, cy, Math.max(24, Math.min(64, Math.round(Math.sqrt(boundary.length) * 2.4))));
    const simplified = simplifyClosedPath(points, Math.max(1, Math.min(holeWidth, holeHeight) * 0.018));
    if (simplified.length >= 3) {
      holes.push(simplified.map((point) => ({
        x: point.x + component.minX - pad,
        y: point.y + component.minY - pad
      })));
    }
  }

  return holes;
}

function floodLocalOutside(local, width, height) {
  const outside = new Uint8Array(local.length);
  const queue = new Int32Array(local.length);
  let head = 0;
  let tail = 0;

  function add(index) {
    if (index < 0 || index >= local.length || local[index] || outside[index]) return;
    outside[index] = 1;
    queue[tail++] = index;
  }

  for (let x = 0; x < width; x += 1) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    add(y * width);
    add(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    const neighbors = [index - 1, index + 1, index - width, index + width];
    for (const next of neighbors) {
      if (next < 0 || next >= local.length || local[next] || outside[next]) continue;
      const nx = next % width;
      if (Math.abs(nx - x) > 1) continue;
      outside[next] = 1;
      queue[tail++] = next;
    }
  }

  return outside;
}

function simplifyClosedPath(points, epsilon) {
  if (points.length <= 10) return points;
  const open = [...points, points[0]];
  const simplified = simplifyPath(open, epsilon);
  simplified.pop();
  return simplified;
}

function simplifyPath(points, epsilon) {
  if (points.length < 3) return points;

  let index = 0;
  let maxDistance = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i += 1) {
    const distance = pointLineDistance(points[i], points[0], points[end]);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }

  if (maxDistance > epsilon) {
    const left = simplifyPath(points.slice(0, index + 1), epsilon);
    const right = simplifyPath(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }

  return [points[0], points[end]];
}

function pointLineDistance(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

function isCurvedClosedPath(points, options = {}) {
  const {
    aspect = pathAspect(points),
    fill = 1,
    minPoints = 12,
    maxRadialVariance = 0.22
  } = options;

  if (points.length < minPoints) return false;
  if (aspect < 0.52 || aspect > 1.92) return false;
  if (fill < 0.42) return false;

  return radialVarianceRatio(points) < maxRadialVariance;
}

function radialVarianceRatio(points) {
  const center = pathCentroid(points);
  const distances = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const mean = distances.reduce((total, distance) => total + distance, 0) / distances.length;
  if (mean <= 0) return Infinity;
  const variance = distances.reduce((total, distance) => total + (distance - mean) ** 2, 0) / distances.length;
  return Math.sqrt(variance) / mean;
}

function pathAspect(points) {
  const bounds = pathBounds(points);
  return bounds.width / Math.max(1, bounds.height);
}

function pathBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function pathCentroid(points) {
  const total = points.reduce((sum, point) => ({
    x: sum.x + point.x,
    y: sum.y + point.y
  }), { x: 0, y: 0 });
  return {
    x: total.x / points.length,
    y: total.y / points.length
  };
}

function smoothClosedCurve(points, iterations = 2) {
  let current = points;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 1) {
      const a = current[i];
      const b = current[(i + 1) % current.length];
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75
      });
    }
    current = next;
  }
  return sampleClosedPath(current, 140);
}

function sampleClosedPath(points, maxPoints) {
  if (points.length <= maxPoints) return points;
  const sampled = [];
  const step = points.length / maxPoints;
  for (let i = 0; i < maxPoints; i += 1) {
    sampled.push(points[Math.floor(i * step)]);
  }
  return sampled;
}

function normalizeSilhouettes(silhouettes, width, height, options = {}) {
  if (silhouettes.length === 0) return [];

  const buildOptions = resolveBuildOptions(options);

  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (const silhouette of silhouettes) {
    minX = Math.min(minX, silhouette.bounds.minX);
    minY = Math.min(minY, silhouette.bounds.minY);
    maxX = Math.max(maxX, silhouette.bounds.maxX);
    maxY = Math.max(maxY, silhouette.bounds.maxY);
  }

  const modelWidth = maxX - minX || width;
  const modelHeight = maxY - minY || height;
  const scale = 5.3 / Math.max(modelWidth, modelHeight);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const normalized = silhouettes.map((silhouette, index) => {
    const outerPoints = sampleClosedPath(
      silhouette.smoothOuter ? smoothClosedCurve(silhouette.points, 2) : silhouette.points,
      silhouette.smoothOuter ? 90 : 70
    );
    const points = outerPoints.map((point) => ({
      x: (point.x - centerX) * scale,
      y: (centerY - point.y) * scale
    }));
    const bounds = pathBounds(points);

    return {
      points,
      holes: silhouette.holes.map((hole) => {
        const source = isCurvedClosedPath(hole, { minPoints: 10, maxRadialVariance: 0.32 })
          ? smoothClosedCurve(hole, 2)
          : hole;
        return sampleClosedPath(source, 64).map((point) => ({
          x: (point.x - centerX) * scale,
          y: (centerY - point.y) * scale
        }));
      }),
      depth: clamp(Math.min(bounds.width, bounds.height) * 0.2, 0.14, 0.72),
      z: 0,
      area: silhouette.area,
      edgeMode: silhouette.edgeMode,
      smoothOuter: silhouette.smoothOuter,
      fill: silhouette.fill,
      sourceAspect: silhouette.aspect,
      aspect: bounds.width / Math.max(0.001, bounds.height),
      radialVariance: silhouette.radialVariance,
      buildVariant: buildOptions.variant,
      paletteIndex: buildOptions.paletteIndex,
      palette: buildOptions.palette
    };
  });

  return assignSurfaceStyles(
    assignVolumeStyles(
      colorizeSilhouettes(magnetizeSilhouettes(normalized), buildOptions),
      buildOptions
    ),
    buildOptions
  );
}

function magnetizeSilhouettes(silhouettes) {
  const range = 0.68;
  const snapRange = 0.22;
  const contactGap = 0.006;
  const maxStep = 0.085;
  const iterations = 30;
  const damping = 0.74;
  const bodies = silhouettes.map((silhouette) => ({
    silhouette,
    mass: Math.max(1, Math.sqrt(silhouette.area)),
    velocity: { x: 0, y: 0 }
  }));

  flatEdgeMagnetizeSilhouettes(silhouettes, {
    range: 0.74,
    contactGap,
    iterations: 14,
    strength: 0.86,
    slideStrength: 0.32
  });

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let aIndex = 0; aIndex < bodies.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < bodies.length; bIndex += 1) {
        applySurfaceMagnetism(bodies[aIndex], bodies[bIndex], {
          range,
          snapRange,
          contactGap
        });
      }
    }

    bodies.forEach((body) => {
      const dx = clamp(body.velocity.x, -maxStep, maxStep);
      const dy = clamp(body.velocity.y, -maxStep, maxStep);
      translateSilhouette(body.silhouette, dx, dy);
      body.velocity.x = (body.velocity.x - dx) * damping;
      body.velocity.y = (body.velocity.y - dy) * damping;
    });
  }

  flatEdgeMagnetizeSilhouettes(silhouettes, {
    range: 0.48,
    contactGap,
    iterations: 10,
    strength: 0.96,
    slideStrength: 0.22
  });
  snapCloseSurfaces(silhouettes, snapRange, contactGap);
  flatEdgeMagnetizeSilhouettes(silhouettes, {
    range: 0.3,
    contactGap,
    iterations: 5,
    strength: 1,
    slideStrength: 0.16
  });
  connectFloatingSilhouettes(silhouettes, {
    contactGap,
    touchingDistance: 0.045,
    maxIterations: Math.min(20, silhouettes.length * 2)
  });
  snapCloseSurfaces(silhouettes, 0.09, contactGap);
  flatEdgeMagnetizeSilhouettes(silhouettes, {
    range: 0.18,
    contactGap,
    iterations: 4,
    strength: 1,
    slideStrength: 0.14
  });
  connectFloatingSilhouettes(silhouettes, {
    contactGap,
    touchingDistance: 0.075,
    maxIterations: Math.min(24, silhouettes.length * 3)
  });
  snapCloseSurfaces(silhouettes, 0.11, contactGap);
  return silhouettes;
}

function flatEdgeMagnetizeSilhouettes(silhouettes, options) {
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const edgeSets = silhouettes.map(findFlatEdges);

    for (let aIndex = 0; aIndex < silhouettes.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < silhouettes.length; bIndex += 1) {
        const match = closestFlatEdgePair(edgeSets[aIndex], edgeSets[bIndex], options);
        if (!match) continue;
        applyFlatEdgeAttraction(silhouettes[aIndex], silhouettes[bIndex], match, options);
      }
    }
  }
}

function findFlatEdges(silhouette) {
  const points = silhouette.points;
  const bounds = pathBounds(points);
  const minEdgeLength = clamp(Math.min(bounds.width, bounds.height) * 0.13, 0.11, 0.42);
  const edges = [];

  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < minEdgeLength) continue;

    const tx = dx / length;
    const ty = dy / length;
    edges.push({
      a,
      b,
      length,
      tx,
      ty,
      mid: {
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2
      }
    });
  }

  if (silhouette.edgeMode !== "round") {
    edges.push(...supportFlatEdges(points, bounds, minEdgeLength));
  }

  return edges;
}

function supportFlatEdges(points, bounds, minEdgeLength) {
  const edges = [];
  const tolerance = clamp(Math.min(bounds.width, bounds.height) * 0.075, 0.035, 0.16);
  addHorizontalSupportEdge(edges, points, bounds, bounds.maxY, tolerance, minEdgeLength);
  addHorizontalSupportEdge(edges, points, bounds, bounds.minY, tolerance, minEdgeLength);
  addVerticalSupportEdge(edges, points, bounds, bounds.minX, tolerance, minEdgeLength);
  addVerticalSupportEdge(edges, points, bounds, bounds.maxX, tolerance, minEdgeLength);
  return edges;
}

function addHorizontalSupportEdge(edges, points, bounds, sideY, tolerance, minEdgeLength) {
  if (bounds.width <= 0.001) return;
  const band = points.filter((point) => Math.abs(point.y - sideY) <= tolerance);
  if (band.length < 3) return;

  const minX = Math.min(...band.map((point) => point.x));
  const maxX = Math.max(...band.map((point) => point.x));
  const length = maxX - minX;
  if (length < Math.max(minEdgeLength, bounds.width * 0.36)) return;

  edges.push({
    a: { x: minX, y: sideY },
    b: { x: maxX, y: sideY },
    length,
    tx: 1,
    ty: 0,
    mid: {
      x: (minX + maxX) / 2,
      y: sideY
    },
    support: true
  });
}

function addVerticalSupportEdge(edges, points, bounds, sideX, tolerance, minEdgeLength) {
  if (bounds.height <= 0.001) return;
  const band = points.filter((point) => Math.abs(point.x - sideX) <= tolerance);
  if (band.length < 3) return;

  const minY = Math.min(...band.map((point) => point.y));
  const maxY = Math.max(...band.map((point) => point.y));
  const length = maxY - minY;
  if (length < Math.max(minEdgeLength, bounds.height * 0.36)) return;

  edges.push({
    a: { x: sideX, y: minY },
    b: { x: sideX, y: maxY },
    length,
    tx: 0,
    ty: 1,
    mid: {
      x: sideX,
      y: (minY + maxY) / 2
    },
    support: true
  });
}

function closestFlatEdgePair(aEdges, bEdges, options) {
  let best = null;

  for (const a of aEdges) {
    for (const b of bEdges) {
      const parallel = Math.abs(a.tx * b.tx + a.ty * b.ty);
      if (parallel < 0.9) continue;

      const delta = {
        x: b.mid.x - a.mid.x,
        y: b.mid.y - a.mid.y
      };
      const tangent = { x: a.tx, y: a.ty };
      let normal = { x: -a.ty, y: a.tx };
      if (delta.x * normal.x + delta.y * normal.y < 0) {
        normal = { x: -normal.x, y: -normal.y };
      }

      const normalGap = delta.x * normal.x + delta.y * normal.y;
      if (normalGap <= options.contactGap || normalGap > options.range) continue;

      const overlap = projectedSegmentOverlap(a, b, tangent);
      const minOverlap = Math.min(a.length, b.length) * 0.18;
      if (overlap < minOverlap) continue;

      const tangentOffset = delta.x * tangent.x + delta.y * tangent.y;
      const score = (parallel * overlap) / (normalGap + 0.025);

      if (!best || score > best.score) {
        best = {
          a,
          b,
          normal,
          tangent,
          normalGap,
          tangentOffset,
          overlap,
          score
        };
      }
    }
  }

  return best;
}

function projectedSegmentOverlap(aEdge, bEdge, tangent) {
  const a0 = aEdge.a.x * tangent.x + aEdge.a.y * tangent.y;
  const a1 = aEdge.b.x * tangent.x + aEdge.b.y * tangent.y;
  const b0 = bEdge.a.x * tangent.x + bEdge.a.y * tangent.y;
  const b1 = bEdge.b.x * tangent.x + bEdge.b.y * tangent.y;
  const aMin = Math.min(a0, a1);
  const aMax = Math.max(a0, a1);
  const bMin = Math.min(b0, b1);
  const bMax = Math.max(b0, b1);
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

function applyFlatEdgeAttraction(a, b, match, options) {
  const totalArea = Math.max(1, a.area + b.area);
  const moveAWeight = b.area / totalArea;
  const moveBWeight = a.area / totalArea;
  const normalPull = clamp((match.normalGap - options.contactGap) * options.strength, 0, 0.18);
  const slidePull = clamp(match.tangentOffset * options.slideStrength, -0.12, 0.12);

  translateSilhouette(
    a,
    match.normal.x * normalPull * moveAWeight + match.tangent.x * slidePull * moveAWeight,
    match.normal.y * normalPull * moveAWeight + match.tangent.y * slidePull * moveAWeight
  );
  translateSilhouette(
    b,
    -match.normal.x * normalPull * moveBWeight - match.tangent.x * slidePull * moveBWeight,
    -match.normal.y * normalPull * moveBWeight - match.tangent.y * slidePull * moveBWeight
  );
}

function applySurfaceMagnetism(aBody, bBody, options) {
  const closest = closestPathPoints(aBody.silhouette.points, bBody.silhouette.points);
  if (!closest || closest.distance <= options.contactGap || closest.distance > options.range) return;

  const nx = (closest.b.x - closest.a.x) / closest.distance;
  const ny = (closest.b.y - closest.a.y) / closest.distance;
  const falloff = (options.range - closest.distance) / options.range;
  const surfacePull = falloff * falloff * 0.066;
  const snapPull = closest.distance < options.snapRange
    ? (options.snapRange - closest.distance) * 0.46
    : 0;
  const pull = surfacePull + snapPull;
  const totalMass = Math.max(1, aBody.mass + bBody.mass);
  const moveA = pull * (bBody.mass / totalMass);
  const moveB = pull * (aBody.mass / totalMass);

  aBody.velocity.x += nx * moveA;
  aBody.velocity.y += ny * moveA;
  bBody.velocity.x -= nx * moveB;
  bBody.velocity.y -= ny * moveB;
}

function snapCloseSurfaces(silhouettes, snapRange, contactGap) {
  for (let aIndex = 0; aIndex < silhouettes.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < silhouettes.length; bIndex += 1) {
      const a = silhouettes[aIndex];
      const b = silhouettes[bIndex];
      const closest = closestPathPoints(a.points, b.points);
      if (!closest || closest.distance <= contactGap || closest.distance > snapRange) continue;

      const nx = (closest.b.x - closest.a.x) / closest.distance;
      const ny = (closest.b.y - closest.a.y) / closest.distance;
      const pull = (closest.distance - contactGap) * 0.82;
      const totalArea = Math.max(1, a.area + b.area);
      const moveA = pull * (b.area / totalArea);
      const moveB = pull * (a.area / totalArea);

      translateSilhouette(a, nx * moveA, ny * moveA);
      translateSilhouette(b, -nx * moveB, -ny * moveB);
    }
  }
}

function connectFloatingSilhouettes(silhouettes, options) {
  if (silhouettes.length < 2) return;

  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    const groups = connectedSilhouetteGroups(silhouettes, options.touchingDistance);
    if (groups.length <= 1) return;

    const match = closestGroupPair(groups);
    if (!match || match.distance <= options.contactGap) return;

    const pull = match.distance - options.contactGap;
    const nx = (match.bPoint.x - match.aPoint.x) / match.distance;
    const ny = (match.bPoint.y - match.aPoint.y) / match.distance;
    const totalArea = Math.max(1, match.aArea + match.bArea);
    const moveA = pull * (match.bArea / totalArea);
    const moveB = pull * (match.aArea / totalArea);

    translateSilhouetteGroup(match.aGroup, nx * moveA, ny * moveA);
    translateSilhouetteGroup(match.bGroup, -nx * moveB, -ny * moveB);
  }
}

function connectedSilhouetteGroups(silhouettes, touchingDistance) {
  const parent = silhouettes.map((_, index) => index);

  function find(index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  function unite(a, b) {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  }

  for (let aIndex = 0; aIndex < silhouettes.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < silhouettes.length; bIndex += 1) {
      const closest = closestPathPoints(silhouettes[aIndex].points, silhouettes[bIndex].points);
      if (closest && closest.distance <= touchingDistance) {
        unite(aIndex, bIndex);
      }
    }
  }

  const groups = new Map();
  silhouettes.forEach((silhouette, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(silhouette);
  });

  return [...groups.values()];
}

function closestGroupPair(groups) {
  let best = null;

  for (let aIndex = 0; aIndex < groups.length; aIndex += 1) {
    for (let bIndex = aIndex + 1; bIndex < groups.length; bIndex += 1) {
      const aGroup = groups[aIndex];
      const bGroup = groups[bIndex];
      const aArea = groupArea(aGroup);
      const bArea = groupArea(bGroup);

      for (const a of aGroup) {
        for (const b of bGroup) {
          const closest = closestPathPoints(a.points, b.points);
          if (!closest || closest.distance <= 0) continue;
          if (!best || closest.distance < best.distance) {
            best = {
              aGroup,
              bGroup,
              aArea,
              bArea,
              aPoint: closest.a,
              bPoint: closest.b,
              distance: closest.distance
            };
          }
        }
      }
    }
  }

  return best;
}

function groupArea(group) {
  return group.reduce((total, silhouette) => total + Math.max(1, silhouette.area), 0);
}

function translateSilhouetteGroup(group, dx, dy) {
  group.forEach((silhouette) => translateSilhouette(silhouette, dx, dy));
}

function closestPathPoints(aPoints, bPoints) {
  let closest = null;

  for (const a of aPoints) {
    for (const b of bPoints) {
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (!closest || distance < closest.distance) {
        closest = { a, b, distance };
      }
    }
  }

  return closest;
}

function translateSilhouette(silhouette, dx, dy) {
  silhouette.points.forEach((point) => {
    point.x += dx;
    point.y += dy;
  });
  silhouette.holes.forEach((hole) => {
    hole.forEach((point) => {
      point.x += dx;
      point.y += dy;
    });
  });
}

function colorizeSilhouettes(silhouettes, options = {}) {
  const palette = options.palette ?? silhouettes[0]?.palette ?? DEFAULT_PALETTE;
  const colors = palette.colors ?? DEFAULT_PALETTE.colors;
  const paper = palette.paper ?? colors[0] ?? ROBOT_COLORS.white;
  const ink = palette.ink ?? colors[1] ?? ROBOT_COLORS.black;
  const hot = colors[2] ?? ROBOT_COLORS.red;
  const warm = colors[3] ?? ROBOT_COLORS.yellow;
  const cool = colors[4] ?? ROBOT_COLORS.navy;
  const soft = colors[5] ?? ROBOT_COLORS.grey;
  const byHeight = [...silhouettes].sort((a, b) => pathCentroid(b.points).y - pathCentroid(a.points).y);
  const levelColors = [
    paper,
    hot,
    cool,
    warm,
    ink,
    soft,
    ...colors.slice(6)
  ];

  byHeight.forEach((silhouette, index) => {
    const bounds = pathBounds(silhouette.points);
    const aspect = bounds.width / Math.max(0.001, bounds.height);
    const isBottomPiece = index === byHeight.length - 1 && byHeight.length > 2;
    const offset = options.paletteIndex ?? silhouette.paletteIndex ?? 0;
    silhouette.palette = palette;

    if (isBottomPiece) {
      silhouette.color = index % 2 === 0 ? hot : ink;
    } else if (silhouette.holes.length > 0) {
      silhouette.color = warm;
    } else if (aspect > 2.35) {
      silhouette.color = index === 0 ? ink : colors[(offset + 2) % colors.length];
    } else if (aspect < 0.62) {
      silhouette.color = index % 2 === 0 ? cool : paper;
    } else if (silhouette.edgeMode === "round") {
      silhouette.color = colors[(offset + 5) % colors.length] ?? hot;
    } else {
      silhouette.color = levelColors[(index + offset) % levelColors.length];
    }
  });

  return silhouettes;
}

function assignVolumeStyles(silhouettes) {
  const byHeight = [...silhouettes].sort((a, b) => pathCentroid(b.points).y - pathCentroid(a.points).y);

  silhouettes.forEach((silhouette, index) => {
    const bounds = pathBounds(silhouette.points);
    const aspect = bounds.width / Math.max(0.001, bounds.height);
    const minSize = Math.min(bounds.width, bounds.height);
    const maxSize = Math.max(bounds.width, bounds.height);
    const heightRank = byHeight.indexOf(silhouette);
    const seed = shapeSeed(silhouette, index);
    const hasHole = silhouette.holes.length > 0;
    const isRoundish =
      silhouette.edgeMode === "round" ||
      (aspect > 0.58 && aspect < 1.75 && silhouette.fill > 0.42 && silhouette.radialVariance < 0.26);

    let kind = "straightExtrusion";

    if (hasHole) {
      const holeCanBeTube =
        silhouette.smoothOuter &&
        silhouette.radialVariance < 0.17 &&
        silhouette.fill < 0.58 &&
        maxSize < 2.35;
      const slotCanBeRounded = aspect > 1.6 && silhouette.radialVariance < 0.26 && seed > 0.58;
      if (holeCanBeTube) {
        kind = "ringTube";
      } else if (slotCanBeRounded) {
        kind = "roundedSlot";
      } else {
        kind = maxSize > 1.55 || seed > 0.42 ? "piercedTaper" : "piercedBlock";
      }
    } else if (isRoundish && aspect > 0.72 && aspect < 1.38) {
      kind = seed > 0.36 ? "spheroid" : "oneSidedDome";
    } else if (isRoundish) {
      kind = aspect > 1 ? "roundedBeam" : "roundedColumn";
    } else if (aspect > 3.2) {
      if (heightRank === 0) {
        kind = "curvedRibbon";
      } else if (seed > 0.72) {
        kind = "flatBlade";
      } else if (seed > 0.34) {
        kind = "curvedRibbon";
      } else {
        kind = "wedgeBeam";
      }
    } else if (aspect > 1.85) {
      kind = seed > 0.52 ? "wedgeBeam" : "straightExtrusion";
    } else if (aspect < 0.56) {
      kind = seed > 0.68 ? "roundedColumn" : "sharpColumn";
    } else if (heightRank === byHeight.length - 1 && byHeight.length > 2) {
      kind = "flatFoot";
    } else if (heightRank <= 1 && aspect < 1.35) {
      kind = "oneSidedTaper";
    } else if (seed < 0.32) {
      kind = "straightExtrusion";
    } else if (seed < 0.62) {
      kind = "oneSidedTaper";
    } else {
      kind = "facetedBlock";
    }

    silhouette.volumeStyle = volumeStyleForKind(kind, silhouette, {
      aspect,
      minSize,
      maxSize,
      seed
    });
    silhouette.depth = silhouette.volumeStyle.depth;
    silhouette.z = (silhouette.volumeStyle.zOffset ?? 0) + index * 0.035;
  });

  settleSilhouetteDepths(silhouettes);
  return silhouettes;
}

function settleSilhouetteDepths(silhouettes) {
  if (silhouettes.length < 2) return;

  const meanZ = silhouettes.reduce((total, silhouette) => total + silhouette.z, 0) / silhouettes.length;
  silhouettes.forEach((silhouette, index) => {
    const seed = shapeSeed(silhouette, index + 307);
    silhouette.z = meanZ + (silhouette.z - meanZ) * 0.16 + (seed - 0.5) * 0.035;
  });
}

function assignSurfaceStyles(silhouettes) {
  silhouettes.forEach((silhouette, index) => {
    const seed = shapeSeed(silhouette, index + 53);
    const palette = silhouette.palette ?? DEFAULT_PALETTE;
    const bounds = pathBounds(silhouette.points);
    const aspect = bounds.width / Math.max(0.001, bounds.height);
    const styleIndex = (index + Math.floor(seed * 10)) % 7;
    let pattern = ["solid", "stripes", "facePaint", "splitPaint", "patchPaint", "specklePaint", "sideBand"][styleIndex];

    if (aspect > 2.1 && seed > 0.28) {
      pattern = seed > 0.68 ? "sideBand" : "stripes";
    } else if (silhouette.holes.length > 0) {
      pattern = seed > 0.55 ? "splitPaint" : "facePaint";
    } else if (silhouette.volumeStyle?.builder === "boxPrism") {
      pattern = seed > 0.48 ? "facePaint" : "splitPaint";
    } else if (silhouette.volumeStyle?.builder === "ellipsoid" && seed > 0.42) {
      pattern = "specklePaint";
    }

    const finishes = ["matte", "glossy", "textured", "satin", "rubber"];
    let finish = finishes[(index + Math.floor(seed * finishes.length)) % finishes.length];
    if (silhouette.volumeStyle?.smooth && seed > 0.28) finish = "glossy";
    if (pattern === "specklePaint") finish = "textured";
    const accents = pickAccentColors(silhouette.color, seed, 4, palette);

    silhouette.surfaceStyle = {
      finish,
      pattern,
      baseColor: silhouette.color ?? ROBOT_COLORS.white,
      accentColors: accents,
      paperColor: palette.paper ?? ROBOT_COLORS.white,
      inkColor: palette.ink ?? ROBOT_COLORS.black,
      splitAngle: seed * Math.PI * 2,
      splitOffset: (seed - 0.5) * 0.55,
      stripeAxis: aspect > 1.6 ? "x" : "y",
      stripeScale: 3.4 + seed * 7.4,
      stripeOffset: seed * 3.7,
      patchScale: 1.2 + seed * 1.8,
      textureSeed: seed
    };
  });

  return silhouettes;
}

function pickAccentColors(baseColor, seed, count, palette = DEFAULT_PALETTE) {
  const available = (palette.colors ?? DEFAULT_PALETTE.colors).filter((color) => color !== baseColor);
  if (available.length === 0) return [ROBOT_COLORS.black, ROBOT_COLORS.red, ROBOT_COLORS.yellow, ROBOT_COLORS.navy].slice(0, count);
  const colors = [];
  let offset = Math.floor(seed * available.length);

  for (let i = 0; i < count; i += 1) {
    colors.push(available[(offset + i * 2) % available.length]);
  }

  return colors;
}

function volumeStyleForKind(kind, silhouette, metrics) {
  const { aspect, minSize, maxSize, seed } = metrics;
  const axis = aspect >= 1 ? "horizontal" : "vertical";
  const spread = 0.55 + seed * 2.25;
  const sizeDepth = (factor, min, max) => clamp(minSize * factor * spread, min, max);
  const offset = (amount) => clamp((seed - 0.5) * minSize * amount, -0.68, 0.68);

  switch (kind) {
    case "ringTube":
      return {
        kind,
        builder: "outlineLoft",
        depth: clamp(maxSize * (0.42 + seed * 0.46), 0.46, 1.8),
        smooth: true,
        sideShade: 0.9,
        zOffset: offset(0.75)
      };
    case "roundedSlot":
      return {
        kind,
        builder: "outlineLoft",
        depth: clamp(minSize * (0.9 + seed * 1.15), 0.34, 1.35),
        smooth: true,
        axis,
        sideShade: 0.9,
        zOffset: offset(0.85)
      };
    case "spheroid":
      return {
        kind,
        builder: "ellipsoid",
        depth: clamp(maxSize * (0.7 + seed * 0.72), 0.62, 2.3),
        smooth: true,
        sideShade: 0.92,
        zOffset: offset(0.75)
      };
    case "oneSidedDome":
      return {
        kind,
        builder: "ellipsoid",
        depth: clamp(maxSize * (0.5 + seed * 0.68), 0.42, 1.65),
        smooth: true,
        sideShade: 0.9,
        zOffset: offset(0.8)
      };
    case "roundedBeam":
    case "roundedColumn":
      return {
        kind,
        builder: "ellipsoid",
        depth: sizeDepth(0.82, 0.34, 1.5),
        smooth: true,
        axis,
        sideShade: 0.9,
        zOffset: offset(0.75)
      };
    case "curvedRibbon":
      return {
        kind,
        builder: "outlineLoft",
        depth: sizeDepth(1.1, 0.32, 1.35),
        smooth: true,
        axis,
        sideShade: 0.88,
        zOffset: offset(1.05)
      };
    case "flatBlade":
      return {
        kind,
        builder: "outlineLoft",
        depth: sizeDepth(0.08, 0.06, 0.18),
        smooth: false,
        sideShade: 0.7,
        zOffset: offset(0.35)
      };
    case "flatFoot":
      return {
        kind,
        builder: "boxPrism",
        depth: sizeDepth(0.16, 0.1, 0.34),
        smooth: false,
        sideShade: 0.72,
        zOffset: offset(0.42)
      };
    case "wedgeBeam":
      return {
        kind,
        builder: "wedgePrism",
        depth: sizeDepth(0.82, 0.34, 1.4),
        smooth: false,
        axis,
        sideShade: 0.78,
        zOffset: offset(1)
      };
    case "sharpColumn":
      return {
        kind,
        builder: "boxPrism",
        depth: sizeDepth(0.68, 0.28, 1.25),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.58)
      };
    case "piercedBlock":
      return {
        kind,
        builder: "outlineLoft",
        depth: sizeDepth(0.62, 0.32, 1.35),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.42)
      };
    case "piercedTaper":
      return {
        kind,
        builder: "outlineLoft",
        depth: sizeDepth(0.82, 0.38, 1.5),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.58)
      };
    case "oneSidedTaper":
      return {
        kind,
        builder: "outlineLoft",
        depth: sizeDepth(0.88, 0.34, 1.55),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.62)
      };
    case "facetedBlock":
      return {
        kind,
        builder: "boxPrism",
        depth: sizeDepth(0.72, 0.34, 1.35),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.7)
      };
    case "straightExtrusion":
    default:
      return {
        kind: "straightExtrusion",
        builder: seed > 0.52 ? "boxPrism" : "outlineLoft",
        depth: sizeDepth(0.38, 0.14, 1.05),
        smooth: false,
        sideShade: 0.74,
        zOffset: offset(0.7)
      };
  }
}

function shapeSeed(silhouette, index) {
  const center = pathCentroid(silhouette.points);
  const variant = silhouette.buildVariant ?? 0;
  const paletteIndex = silhouette.paletteIndex ?? 0;
  const raw = Math.sin(
    center.x * 12.9898 +
    center.y * 78.233 +
    silhouette.area * 0.0017 +
    index * 37.719 +
    variant * 91.113 +
    paletteIndex * 17.671
  ) * 43758.5453;
  return raw - Math.floor(raw);
}

function isDarkColor(color = ROBOT_COLORS.white) {
  const value = color.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90;
}

function createDynamicSilhouetteGeometry(silhouette) {
  const geometry = createGeometryForPart(silhouette);
  const paintedGeometry = paintGeometrySurfaces(geometry, silhouette);
  paintedGeometry.userData.profile = geometry.userData.profile ?? {};
  paintedGeometry.computeVertexNormals();
  return paintedGeometry;
}

function createGeometryForPart(silhouette) {
  const builder = silhouette.volumeStyle?.builder ?? "outlineLoft";

  if (builder === "ellipsoid" && silhouette.holes.length === 0) {
    return createEllipsoidGeometry(silhouette);
  }

  if (builder === "boxPrism" && silhouette.holes.length === 0) {
    return createBoxPrismGeometry(silhouette, false);
  }

  if (builder === "wedgePrism" && silhouette.holes.length === 0) {
    return createBoxPrismGeometry(silhouette, true);
  }

  return createOutlineLoftGeometry(silhouette);
}

function createOutlineLoftGeometry(silhouette) {
  const contour = ensureClockwise(silhouette.points).map((point) => new THREE.Vector2(point.x, point.y));
  const holes = silhouette.holes.map((hole) => ensureCounterClockwise(hole).map((point) => new THREE.Vector2(point.x, point.y)));
  const rings = [contour, ...holes];
  const flatPoints = rings.flat();
  const ringStarts = [];
  let offset = 0;

  rings.forEach((ring) => {
    ringStarts.push(offset);
    offset += ring.length;
  });

  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const profile = volumeProfileForSilhouette(silhouette);
  const center = pathCentroid(silhouette.points);
  const positions = [];
  const indices = [];
  const layerStride = flatPoints.length;

  profile.layers.forEach((layer) => {
    rings.forEach((ring) => {
      ring.forEach((point) => {
        const scaleX = layer.scaleX ?? layer.scale ?? 1;
        const scaleY = layer.scaleY ?? layer.scale ?? 1;
        positions.push(
          center.x + (point.x - center.x) * scaleX + (layer.x ?? 0),
          center.y + (point.y - center.y) * scaleY + (layer.y ?? 0),
          silhouette.z + layer.z
        );
      });
    });
  });

  const frontLayer = profile.layers.length - 1;
  triangles.forEach((triangle) => {
    indices.push(
      frontLayer * layerStride + triangle[0],
      frontLayer * layerStride + triangle[1],
      frontLayer * layerStride + triangle[2]
    );
    indices.push(
      triangle[2],
      triangle[1],
      triangle[0]
    );
  });

  for (let layer = 0; layer < profile.layers.length - 1; layer += 1) {
    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex];
      const start = ringStarts[ringIndex];
      const isHole = ringIndex > 0;

      for (let i = 0; i < ring.length; i += 1) {
        const next = (i + 1) % ring.length;
        const a0 = layer * layerStride + start + i;
        const a1 = layer * layerStride + start + next;
        const b0 = (layer + 1) * layerStride + start + i;
        const b1 = (layer + 1) * layerStride + start + next;

        if (isHole) {
          indices.push(a0, b1, b0, a0, a1, b1);
        } else {
          indices.push(a0, b0, b1, a0, b1, a1);
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData.profile = profile;
  return geometry;
}

function createEllipsoidGeometry(silhouette) {
  const bounds = pathBounds(silhouette.points);
  const center = pathCentroid(silhouette.points);
  const profile = volumeProfileForSilhouette(silhouette);
  let width = Math.max(bounds.width, 0.08);
  let height = Math.max(bounds.height, 0.08);
  let depth = Math.max(silhouette.depth, 0.08);
  const geometry = new THREE.SphereGeometry(0.5, 24, 14);

  if (silhouette.volumeStyle?.kind === "roundedBeam" || silhouette.volumeStyle?.kind === "roundedColumn") {
    const axis = silhouette.volumeStyle.axis ?? (width > height ? "horizontal" : "vertical");
    const squash = axis === "horizontal"
      ? { x: 1.08, y: 0.74, z: 0.9 }
      : { x: 0.74, y: 1.08, z: 0.9 };
    width *= squash.x;
    height *= squash.y;
    depth *= squash.z;
  }

  geometry.scale(width, height, depth);
  geometry.translate(center.x, center.y, silhouette.z);

  geometry.userData.profile = {
    ...profile,
    smooth: true,
    primitive: "ellipsoid"
  };
  return geometry;
}

function createBoxPrismGeometry(silhouette, wedge = false) {
  const bounds = pathBounds(silhouette.points);
  const center = pathCentroid(silhouette.points);
  const profile = volumeProfileForSilhouette(silhouette);
  const width = Math.max(bounds.width, 0.08);
  const height = Math.max(bounds.height, 0.08);
  const depth = Math.max(silhouette.depth, 0.08);
  const seed = shapeSeed(silhouette, wedge ? 211 : 173);
  const backScale = wedge ? 0.88 + seed * 0.12 : 1;
  const frontScale = wedge ? 0.52 + seed * 0.24 : 0.9 + seed * 0.16;
  const skewX = wedge ? (seed - 0.5) * width * 0.18 : (seed - 0.5) * width * 0.05;
  const skewY = wedge ? (seed - 0.5) * height * 0.14 : (seed - 0.5) * height * 0.04;
  const zBack = silhouette.z - depth / 2;
  const zFront = silhouette.z + depth / 2;
  const positions = [];
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    0, 1, 4, 1, 5, 4,
    1, 3, 5, 3, 7, 5,
    3, 2, 7, 2, 6, 7,
    2, 0, 6, 0, 4, 6
  ];

  [
    { z: zBack, scale: backScale, x: -skewX, y: -skewY },
    { z: zFront, scale: frontScale, x: skewX, y: skewY }
  ].forEach((layer) => {
    const hw = (width * layer.scale) / 2;
    const hh = (height * layer.scale) / 2;
    positions.push(
      center.x - hw + layer.x, center.y - hh + layer.y, layer.z,
      center.x + hw + layer.x, center.y - hh + layer.y, layer.z,
      center.x - hw + layer.x, center.y + hh + layer.y, layer.z,
      center.x + hw + layer.x, center.y + hh + layer.y, layer.z
    );
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.userData.profile = {
    ...profile,
    smooth: false,
    primitive: wedge ? "wedgePrism" : "boxPrism"
  };
  return geometry;
}

function paintGeometrySurfaces(indexedGeometry, silhouette) {
  const position = indexedGeometry.getAttribute("position");
  const index = indexedGeometry.getIndex();
  const paintedPositions = [];
  const colors = [];
  const style = silhouette.surfaceStyle ?? {
    pattern: "solid",
    baseColor: silhouette.color ?? ROBOT_COLORS.white,
    accentColors: pickAccentColors(silhouette.color ?? ROBOT_COLORS.white, 0.5, 4, silhouette.palette)
  };

  const count = index ? index.count : position.count;

  for (let i = 0; i < count; i += 3) {
    const a = vertexFromAttribute(position, index ? index.getX(i) : i);
    const b = vertexFromAttribute(position, index ? index.getX(i + 1) : i + 1);
    const c = vertexFromAttribute(position, index ? index.getX(i + 2) : i + 2);
    const centroid = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3
    };
    const normal = triangleNormal(a, b, c);
    const color = colorForSurfaceTriangle(style, centroid, normal, i / 3);

    [a, b, c].forEach((point) => {
      paintedPositions.push(point.x, point.y, point.z);
      colors.push(color.r, color.g, color.b);
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(paintedPositions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function vertexFromAttribute(attribute, index) {
  return {
    x: attribute.getX(index),
    y: attribute.getY(index),
    z: attribute.getZ(index)
  };
}

function triangleNormal(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x
  };
  const length = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length
  };
}

function colorForSurfaceTriangle(style, centroid, normal, faceIndex) {
  const base = colorObject(style.baseColor);
  const accents = style.accentColors.map(colorObject);
  let color = base;

  if (style.pattern === "stripes") {
    const axisValue = style.stripeAxis === "x" ? centroid.x : centroid.y;
    const stripe = Math.floor((axisValue + style.stripeOffset) * style.stripeScale);
    color = stripe % 2 === 0 ? base : accents[0];
  } else if (style.pattern === "facePaint") {
    const faceBucket = Math.abs(normal.z) > 0.72
      ? (normal.z > 0 ? 0 : 1)
      : Math.floor((Math.atan2(normal.y, normal.x) + Math.PI) / (Math.PI / 2));
    color = [base, ...accents][faceBucket % (accents.length + 1)];
  } else if (style.pattern === "splitPaint") {
    const split =
      centroid.x * Math.cos(style.splitAngle) +
      centroid.y * Math.sin(style.splitAngle) +
      centroid.z * 0.42;
    color = split > style.splitOffset ? accents[0] : base;
  } else if (style.pattern === "patchPaint") {
    const patch = Math.floor((centroid.x * 1.7 + centroid.y * 2.3 + centroid.z * 1.1) * style.patchScale + faceIndex * 0.17);
    color = [base, ...accents][Math.abs(patch) % (accents.length + 1)];
  } else if (style.pattern === "specklePaint") {
    const noise = surfaceNoise(centroid.x, centroid.y, centroid.z, style.textureSeed);
    color = noise > 0.68 ? mixColor(base, accents[0], 0.48) : base;
    if (noise < 0.16) color = mixColor(color, colorObject(style.paperColor ?? ROBOT_COLORS.white), 0.28);
  } else if (style.pattern === "sideBand") {
    const side = Math.abs(normal.z) < 0.42;
    const stripe = Math.floor((centroid.y + style.stripeOffset) * style.stripeScale);
    color = side && stripe % 2 === 0 ? accents[0] : base;
  }

  if (Math.abs(normal.z) < 0.18) {
    color = mixColor(color, colorObject(style.inkColor ?? ROBOT_COLORS.black), 0.08);
  }

  return color;
}

function surfaceNoise(x, y, z, seed = 0) {
  const raw = Math.sin(x * 42.13 + y * 89.91 + z * 27.37 + seed * 311.7) * 43758.5453;
  return raw - Math.floor(raw);
}

function colorObject(color) {
  const value = color.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255
  };
}

function mixColor(a, b, amount) {
  return {
    r: a.r * (1 - amount) + b.r * amount,
    g: a.g * (1 - amount) + b.g * amount,
    b: a.b * (1 - amount) + b.b * amount
  };
}

function createMaterialForSilhouette(silhouette, profile) {
  const finish = silhouette.surfaceStyle?.finish ?? "matte";
  const common = {
    color: 0xffffff,
    flatShading: !profile.smooth,
    vertexColors: true,
    side: THREE.DoubleSide
  };

  if (finish === "glossy") {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.16,
      metalness: 0.02,
      clearcoat: 0.86,
      clearcoatRoughness: 0.12
    });
  }

  if (finish === "satin") {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.42,
      metalness: 0,
      clearcoat: 0.32,
      clearcoatRoughness: 0.48
    });
  }

  if (finish === "rubber") {
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.94,
      metalness: 0,
      clearcoat: 0,
      sheen: 0.22,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color(0xffffff)
    });
  }

  if (finish === "textured") {
    const texture = proceduralTexture("grain", silhouette.surfaceStyle?.textureSeed ?? 0);
    return new THREE.MeshPhysicalMaterial({
      ...common,
      roughness: 0.88,
      metalness: 0,
      clearcoat: 0.08,
      clearcoatRoughness: 0.9,
      bumpMap: texture,
      bumpScale: 0.035,
      roughnessMap: texture
    });
  }

  return new THREE.MeshPhysicalMaterial({
    ...common,
    roughness: profile.smooth ? 0.64 : 0.86,
    metalness: 0,
    clearcoat: 0,
    clearcoatRoughness: 0.84
  });
}

function proceduralTexture(kind, seed) {
  const key = `${kind}-${Math.round(seed * 1000)}`;
  if (textureCache.has(key)) return textureCache.get(key);

  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const i = (y * canvas.width + x) * 4;
      const noise = surfaceNoise(x * 0.12, y * 0.12, seed, seed);
      const stripe = Math.sin((x + seed * 31) * 0.55) * 0.5 + 0.5;
      const value = Math.round(150 + noise * 72 + stripe * 28);
      image.data[i] = value;
      image.data[i + 1] = value;
      image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.colorSpace = THREE.NoColorSpace;
  textureCache.set(key, texture);
  return texture;
}

function volumeProfileForSilhouette(silhouette) {
  const style = silhouette.volumeStyle ?? {
    kind: "straightExtrusion",
    depth: silhouette.depth,
    smooth: false,
    sideShade: 0.78
  };
  const z = (value) => value * style.depth;
  const profile = {
    kind: style.kind,
    smooth: style.smooth,
    sideShade: style.sideShade,
    layers: []
  };
  const axisIsHorizontal = style.axis !== "vertical";
  const roundedAxisLayers = (values) => values.map(([depth, narrowScale, wideScale]) => ({
    z: z(depth),
    scaleX: axisIsHorizontal ? wideScale : narrowScale,
    scaleY: axisIsHorizontal ? narrowScale : wideScale
  }));

  switch (style.kind) {
    case "ringTube":
      profile.layers = [
        { z: z(-0.5), scale: 0.72 },
        { z: z(-0.34), scale: 0.92 },
        { z: z(-0.08), scale: 1.08 },
        { z: z(0.18), scale: 1.0 },
        { z: z(0.38), scale: 0.84 },
        { z: z(0.5), scale: 0.68 }
      ];
      return profile;
    case "roundedSlot":
    case "roundedBeam":
    case "roundedColumn":
    case "curvedRibbon":
      profile.layers = roundedAxisLayers([
        [-0.5, 0.22, 1],
        [-0.34, 0.58, 1.01],
        [-0.12, 0.88, 1.02],
        [0.12, 1, 1],
        [0.34, 0.68, 0.99],
        [0.5, 0.28, 0.98]
      ]);
      return profile;
    case "spheroid":
      profile.layers = [
        { z: z(-0.5), scale: 0.12 },
        { z: z(-0.36), scale: 0.5 },
        { z: z(-0.16), scale: 0.84 },
        { z: z(0), scale: 1 },
        { z: z(0.16), scale: 0.84 },
        { z: z(0.36), scale: 0.5 },
        { z: z(0.5), scale: 0.12 }
      ];
      return profile;
    case "oneSidedDome":
      profile.layers = [
        { z: z(-0.5), scale: 1 },
        { z: z(-0.12), scale: 1 },
        { z: z(0.18), scale: 0.8, x: 0.015, y: 0 },
        { z: z(0.4), scale: 0.42, x: 0.02, y: 0 },
        { z: z(0.5), scale: 0.14, x: 0.02, y: 0 }
      ];
      return profile;
    case "flatBlade":
    case "flatFoot":
    case "sharpColumn":
    case "piercedBlock":
    case "straightExtrusion":
      profile.layers = [
        { z: z(-0.5), scale: 1 },
        { z: z(0.5), scale: 1 }
      ];
      return profile;
    case "wedgeBeam": {
      const shift = axisIsHorizontal ? { x: 0.08, y: 0.015 } : { x: 0.02, y: 0.08 };
      profile.layers = [
        { z: z(-0.5), scale: 1, x: -shift.x, y: -shift.y },
        { z: z(0.5), scale: 1, x: shift.x, y: shift.y }
      ];
      return profile;
    }
    case "piercedTaper":
    case "oneSidedTaper":
      profile.layers = [
        { z: z(-0.5), scale: 1, x: 0, y: 0 },
        { z: z(-0.06), scale: 1, x: 0, y: 0 },
        { z: z(0.5), scale: 0.74, x: 0.04, y: 0.018 }
      ];
      return profile;
    case "facetedBlock":
    default:
      profile.layers = [
        { z: z(-0.5), scale: 1, x: -0.025, y: -0.012 },
        { z: z(0.08), scale: 1, x: 0, y: 0 },
        { z: z(0.5), scale: 0.86, x: 0.045, y: 0.02 }
      ];
      return profile;
  }
}

function ensureClockwise(points) {
  return THREE.ShapeUtils.isClockWise(points.map((point) => new THREE.Vector2(point.x, point.y)))
    ? points
    : [...points].reverse();
}

function ensureCounterClockwise(points) {
  return THREE.ShapeUtils.isClockWise(points.map((point) => new THREE.Vector2(point.x, point.y)))
    ? [...points].reverse()
    : points;
}

function rebuildScene(silhouettes) {
  disposeGroup(shapeGroup);
  shapeGroup.clear();
  shapeGroup.rotation.set(-0.08, 0.62, 0);

  if (silhouettes.length === 0) {
    addFallbackShape();
    return;
  }

  silhouettes.forEach((silhouette) => {
    const geometry = createDynamicSilhouetteGeometry(silhouette);
    const profile = geometry.userData.profile ?? {};

    const material = createMaterialForSilhouette(silhouette, profile);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    shapeGroup.add(mesh);

  });
}

function addFallbackShape() {
  const shape = new THREE.Shape();
  shape.moveTo(-1.2, -0.8);
  shape.lineTo(1.2, -0.8);
  shape.lineTo(0.7, 1);
  shape.lineTo(-0.7, 1);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.42,
    bevelEnabled: false
  });
  geometry.translate(0, 0, -0.21);
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: ROBOT_COLORS.white, roughness: 0.78 })
  );
  mesh.castShadow = true;
  shapeGroup.add(mesh);
}

function disposeGroup(group) {
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
}

function resetView() {
  const box = new THREE.Box3().setFromObject(shapeGroup);
  if (box.isEmpty()) {
    camera.position.set(0, 0.65, 7.5);
    controls.target.set(0, 0, 0);
    controls.update();
    return;
  }

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const verticalFit = size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const horizontalFit = size.x / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect);
  const distance = Math.max(verticalFit, horizontalFit, size.z + 2.5) * 1.38;
  camera.position.set(center.x, center.y + size.y * 0.06, center.z + distance);
  controls.target.copy(center);
  controls.update();
}

function runTestCapture(options = {}) {
  const buildOptions = resolveBuildOptions(options);
  const canvas = els.captureCanvas;
  canvas.width = 1000;
  canvas.height = 1300;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  const drift = ((buildOptions.variant % 5) - 2) * 7;

  ctx.save();
  ctx.translate(500 + drift, 330);
  ctx.rotate(-0.08 + drift * 0.0015);
  ctx.beginPath();
  ctx.moveTo(-155, 170);
  ctx.lineTo(155, 170);
  ctx.lineTo(95, -170);
  ctx.lineTo(-95, -170);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(500 - drift * 0.6, 605);
  ctx.rotate(0.03 - drift * 0.001);
  ctx.beginPath();
  ctx.moveTo(-270, 170);
  ctx.lineTo(270, 170);
  ctx.lineTo(205, -170);
  ctx.lineTo(-205, -170);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.fillRect(338, 780, 82, 255);
  ctx.fillRect(580, 780, 82, 255);
  roundedRect(ctx, 235, 1010, 240, 82, 30);
  roundedRect(ctx, 525, 1010, 240, 82, 30);
  ctx.beginPath();
  ctx.arc(285, 1040, 46, 0, Math.PI * 2);
  ctx.arc(715, 1040, 46, 0, Math.PI * 2);
  ctx.fill();

  buildFromCanvas(canvas, buildOptions);
}

function runImageTest(src, options = {}) {
  if (!src) return;
  const buildOptions = resolveBuildOptions(options);
  const image = new Image();
  image.onload = () => {
    const canvas = els.captureCanvas;
    const maxSide = 1440;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    buildFromCanvas(canvas, buildOptions);
  };
  image.onerror = () => setStatus("Test image unavailable");
  image.src = src;
}

function runAutoHoldTest() {
  const duration = clamp(Number(params.get("autohold")) || 2800, 1200, 8000);
  state.pointerDown = true;
  beginLiveGeneration();
  window.setTimeout(stopLiveGeneration, duration);
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
