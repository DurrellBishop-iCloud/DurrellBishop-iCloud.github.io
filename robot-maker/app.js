import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const ROBOT_COLORS = {
  white: "#ffffff",
  black: "#111318",
  red: "#c71924",
  yellow: "#f0bf1f",
  navy: "#10284c",
  grey: "#d8d6cd"
};

const ROBOT_PALETTE = [
  ROBOT_COLORS.white,
  ROBOT_COLORS.black,
  ROBOT_COLORS.red,
  ROBOT_COLORS.yellow,
  ROBOT_COLORS.navy,
  ROBOT_COLORS.grey
];

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
  lastSilhouettes: []
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

animate();

function bindEvents() {
  els.shutter.addEventListener("click", async () => {
    if (state.processing || state.starting) return;

    if (!state.stream) {
      await startCamera();
      return;
    }

    if (state.mode === "result") {
      showCamera();
      return;
    }

    captureAndBuild();
  });

  window.addEventListener("resize", resizeRenderer);
  window.addEventListener("orientationchange", () => window.setTimeout(resizeRenderer, 250));
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
  els.shutter.setAttribute("aria-label", "Take another photo");
  setStatus(`${state.lastSilhouettes.length} shapes converted`);
}

function setStateClass(className, enabled) {
  document.body.classList.toggle(className, enabled);
}

function setStatus(message) {
  els.status.textContent = message;
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
  renderer.toneMappingExposure = 1.06;
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

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8a867b, 1.8);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 2.8);
  key.position.set(3.5, 5.5, 6);
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

  const side = new THREE.DirectionalLight(0xfff4dd, 1.15);
  side.position.set(-4.5, 2.2, -5.5);
  scene.add(side);

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

function captureAndBuild() {
  if (!els.video.videoWidth || !els.video.videoHeight) {
    setStatus("Camera not ready");
    return;
  }

  state.processing = true;
  setStateClass("is-processing", true);
  setStatus("Reading shapes");

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
    buildFromCanvas(canvas);
  });
}

function buildFromCanvas(canvas) {
  try {
    const silhouettes = detectWhiteSilhouettes(canvas);
    state.lastSilhouettes = silhouettes;
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

function detectWhiteSilhouettes(sourceCanvas) {
  const processCanvas = document.createElement("canvas");
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(sourceCanvas.width, sourceCanvas.height));
  processCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale));
  processCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale));

  const ctx = processCanvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(sourceCanvas, 0, 0, processCanvas.width, processCanvas.height);

  const image = ctx.getImageData(0, 0, processCanvas.width, processCanvas.height);
  const luminance = getLuminance(image.data);
  const threshold = Math.max(95, otsuThreshold(luminance) + 8);
  const mask = makeWhiteMask(luminance, image.width, image.height, threshold);
  const components = findComponents(mask, image.width, image.height);
  const rawSilhouettes = components
    .map((component) => componentToSilhouette(component, mask, image.width, image.height))
    .filter(Boolean);

  return normalizeSilhouettes(rawSilhouettes, image.width, image.height);
}

function getLuminance(data) {
  const luminance = new Uint8Array(data.length / 4);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    luminance[p] = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  return luminance;
}

function otsuThreshold(values) {
  const histogram = new Uint32Array(256);
  for (const value of values) histogram[value] += 1;

  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * histogram[i];

  let sumBackground = 0;
  let weightBackground = 0;
  let maxVariance = 0;
  let threshold = 128;

  for (let i = 0; i < 256; i += 1) {
    weightBackground += histogram[i];
    if (weightBackground === 0) continue;
    const weightForeground = total - weightBackground;
    if (weightForeground === 0) break;

    sumBackground += i * histogram[i];
    const meanBackground = sumBackground / weightBackground;
    const meanForeground = (sum - sumBackground) / weightForeground;
    const variance = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = i;
    }
  }

  return threshold;
}

function makeWhiteMask(luminance, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < luminance.length; i += 1) {
    mask[i] = luminance[i] >= threshold ? 1 : 0;
  }
  return closeMask(openMask(mask, width, height), width, height);
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

    if (area < minArea || area > maxArea) continue;

    components.push({
      area,
      pixels,
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
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

function normalizeSilhouettes(silhouettes, width, height) {
  if (silhouettes.length === 0) return [];

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
      radialVariance: silhouette.radialVariance
    };
  });

  return assignSurfaceStyles(assignVolumeStyles(colorizeSilhouettes(magnetizeSilhouettes(normalized))));
}

function magnetizeSilhouettes(silhouettes) {
  const range = 0.62;
  const snapRange = 0.18;
  const contactGap = 0.008;
  const maxStep = 0.085;
  const iterations = 30;
  const damping = 0.74;
  const bodies = silhouettes.map((silhouette) => ({
    silhouette,
    mass: Math.max(1, Math.sqrt(silhouette.area)),
    velocity: { x: 0, y: 0 }
  }));

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

  snapCloseSurfaces(silhouettes, snapRange, contactGap);
  return silhouettes;
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

function colorizeSilhouettes(silhouettes) {
  const byHeight = [...silhouettes].sort((a, b) => pathCentroid(b.points).y - pathCentroid(a.points).y);
  const levelColors = [
    ROBOT_COLORS.white,
    ROBOT_COLORS.red,
    ROBOT_COLORS.navy,
    ROBOT_COLORS.yellow,
    ROBOT_COLORS.black
  ];

  byHeight.forEach((silhouette, index) => {
    const bounds = pathBounds(silhouette.points);
    const aspect = bounds.width / Math.max(0.001, bounds.height);
    const isBottomPiece = index === byHeight.length - 1 && byHeight.length > 2;

    if (isBottomPiece) {
      silhouette.color = ROBOT_COLORS.red;
    } else if (silhouette.holes.length > 0) {
      silhouette.color = ROBOT_COLORS.yellow;
    } else if (aspect > 2.35) {
      silhouette.color = index === 0 ? ROBOT_COLORS.black : ROBOT_COLORS.red;
    } else if (aspect < 0.62) {
      silhouette.color = index % 2 === 0 ? ROBOT_COLORS.navy : ROBOT_COLORS.white;
    } else if (silhouette.edgeMode === "round") {
      silhouette.color = ROBOT_COLORS.red;
    } else {
      silhouette.color = levelColors[index % levelColors.length];
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

  return silhouettes;
}

function assignSurfaceStyles(silhouettes) {
  silhouettes.forEach((silhouette, index) => {
    const seed = shapeSeed(silhouette, index + 53);
    const bounds = pathBounds(silhouette.points);
    const aspect = bounds.width / Math.max(0.001, bounds.height);
    const styleIndex = Math.floor(seed * 1000 + index * 7) % 6;
    let pattern = "solid";

    if (styleIndex === 1 || (aspect > 2.1 && seed > 0.32)) {
      pattern = "stripes";
    } else if (styleIndex === 2 || silhouette.volumeStyle?.kind === "facetedBlock") {
      pattern = "facePaint";
    } else if (styleIndex === 3 || silhouette.holes.length > 0) {
      pattern = "splitPaint";
    } else if (styleIndex === 4 && silhouette.volumeStyle?.kind !== "flatBlade") {
      pattern = "patchPaint";
    }

    const finish = seed > 0.56 || silhouette.volumeStyle?.smooth ? "glossy" : "matte";
    const accents = pickAccentColors(silhouette.color, seed, 4);

    silhouette.surfaceStyle = {
      finish,
      pattern,
      baseColor: silhouette.color ?? ROBOT_COLORS.white,
      accentColors: accents,
      splitAngle: seed * Math.PI * 2,
      splitOffset: (seed - 0.5) * 0.55,
      stripeAxis: aspect > 1.6 ? "x" : "y",
      stripeScale: 4.2 + seed * 5.6,
      stripeOffset: seed * 3.7,
      patchScale: 1.2 + seed * 1.8
    };
  });

  return silhouettes;
}

function pickAccentColors(baseColor, seed, count) {
  const available = ROBOT_PALETTE.filter((color) => color !== baseColor);
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
        depth: clamp(maxSize * (0.42 + seed * 0.46), 0.46, 1.8),
        smooth: true,
        sideShade: 0.9,
        zOffset: offset(0.75)
      };
    case "roundedSlot":
      return {
        kind,
        depth: clamp(minSize * (0.9 + seed * 1.15), 0.34, 1.35),
        smooth: true,
        axis,
        sideShade: 0.9,
        zOffset: offset(0.85)
      };
    case "spheroid":
      return {
        kind,
        depth: clamp(maxSize * (0.7 + seed * 0.72), 0.62, 2.3),
        smooth: true,
        sideShade: 0.92,
        zOffset: offset(0.75)
      };
    case "oneSidedDome":
      return {
        kind,
        depth: clamp(maxSize * (0.5 + seed * 0.68), 0.42, 1.65),
        smooth: true,
        sideShade: 0.9,
        zOffset: offset(0.8)
      };
    case "roundedBeam":
    case "roundedColumn":
      return {
        kind,
        depth: sizeDepth(0.82, 0.34, 1.5),
        smooth: true,
        axis,
        sideShade: 0.9,
        zOffset: offset(0.75)
      };
    case "curvedRibbon":
      return {
        kind,
        depth: sizeDepth(1.1, 0.32, 1.35),
        smooth: true,
        axis,
        sideShade: 0.88,
        zOffset: offset(1.05)
      };
    case "flatBlade":
      return {
        kind,
        depth: sizeDepth(0.08, 0.06, 0.18),
        smooth: false,
        sideShade: 0.7,
        zOffset: offset(0.35)
      };
    case "flatFoot":
      return {
        kind,
        depth: sizeDepth(0.16, 0.1, 0.34),
        smooth: false,
        sideShade: 0.72,
        zOffset: offset(0.42)
      };
    case "wedgeBeam":
      return {
        kind,
        depth: sizeDepth(0.82, 0.34, 1.4),
        smooth: false,
        axis,
        sideShade: 0.78,
        zOffset: offset(1)
      };
    case "sharpColumn":
      return {
        kind,
        depth: sizeDepth(0.68, 0.28, 1.25),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.58)
      };
    case "piercedBlock":
      return {
        kind,
        depth: sizeDepth(0.62, 0.32, 1.35),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.42)
      };
    case "piercedTaper":
      return {
        kind,
        depth: sizeDepth(0.82, 0.38, 1.5),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.58)
      };
    case "oneSidedTaper":
      return {
        kind,
        depth: sizeDepth(0.88, 0.34, 1.55),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.62)
      };
    case "facetedBlock":
      return {
        kind,
        depth: sizeDepth(0.72, 0.34, 1.35),
        smooth: false,
        sideShade: 0.78,
        zOffset: offset(0.7)
      };
    case "straightExtrusion":
    default:
      return {
        kind: "straightExtrusion",
        depth: sizeDepth(0.38, 0.14, 1.05),
        smooth: false,
        sideShade: 0.74,
        zOffset: offset(0.7)
      };
  }
}

function shapeSeed(silhouette, index) {
  const center = pathCentroid(silhouette.points);
  const raw = Math.sin(center.x * 12.9898 + center.y * 78.233 + silhouette.area * 0.0017 + index * 37.719) * 43758.5453;
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
  const paintedGeometry = paintGeometrySurfaces(geometry, silhouette);
  paintedGeometry.userData.profile = profile;
  paintedGeometry.computeVertexNormals();
  return paintedGeometry;
}

function paintGeometrySurfaces(indexedGeometry, silhouette) {
  const position = indexedGeometry.getAttribute("position");
  const index = indexedGeometry.getIndex();
  const paintedPositions = [];
  const colors = [];
  const style = silhouette.surfaceStyle ?? {
    pattern: "solid",
    baseColor: silhouette.color ?? ROBOT_COLORS.white,
    accentColors: pickAccentColors(silhouette.color ?? ROBOT_COLORS.white, 0.5, 4)
  };

  for (let i = 0; i < index.count; i += 3) {
    const a = vertexFromAttribute(position, index.getX(i));
    const b = vertexFromAttribute(position, index.getX(i + 1));
    const c = vertexFromAttribute(position, index.getX(i + 2));
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
  }

  if (Math.abs(normal.z) < 0.18) {
    color = mixColor(color, colorObject(ROBOT_COLORS.black), 0.08);
  }

  return color;
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

    const finish = silhouette.surfaceStyle?.finish ?? "matte";
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: finish === "glossy" ? 0.18 : (profile.smooth ? 0.64 : 0.86),
      metalness: finish === "glossy" ? 0.03 : 0,
      clearcoat: finish === "glossy" ? 0.72 : 0,
      clearcoatRoughness: finish === "glossy" ? 0.16 : 0.84,
      flatShading: !profile.smooth,
      vertexColors: true,
      side: THREE.DoubleSide
    });
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

function runTestCapture() {
  const canvas = els.captureCanvas;
  canvas.width = 1000;
  canvas.height = 1300;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#07080a";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";

  ctx.save();
  ctx.translate(500, 330);
  ctx.rotate(-0.08);
  ctx.beginPath();
  ctx.moveTo(-155, 170);
  ctx.lineTo(155, 170);
  ctx.lineTo(95, -170);
  ctx.lineTo(-95, -170);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.translate(500, 605);
  ctx.rotate(0.03);
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

  buildFromCanvas(canvas);
}

function runImageTest(src) {
  if (!src) return;
  const image = new Image();
  image.onload = () => {
    const canvas = els.captureCanvas;
    const maxSide = 1440;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    buildFromCanvas(canvas);
  };
  image.onerror = () => setStatus("Test image unavailable");
  image.src = src;
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
