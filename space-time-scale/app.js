const canvas = document.querySelector("#chart");
const ctx = canvas.getContext("2d");

const readouts = {
  mode: document.querySelector("#modeReadout"),
  x: document.querySelector("#xReadout"),
  y: document.querySelector("#yReadout"),
  width: document.querySelector("#widthReadout"),
  height: document.querySelector("#heightReadout")
};

const world = {
  minX: 1e-15,
  maxX: 1e26,
  minY: 1e-23,
  maxY: 1e17
};

const human = {
  minX: 1e-3,
  maxX: 1e7,
  minY: 1e-1,
  maxY: 1e9
};

const presets = {
  all: { minX: world.minX, maxX: world.maxX, minY: world.minY, maxY: world.maxY },
  human: { minX: 1e-3, maxX: 1e7, minY: 1e-1, maxY: 1e9 },
  room: { minX: 0, maxX: 30, minY: 0, maxY: 900 },
  planet: { minX: 0, maxX: 4.2e7, minY: 0, maxY: 3.2e7 },
  cosmos: { minX: 0, maxX: 1e26, minY: 0, maxY: 1e17 }
};

const state = {
  mode: "linear",
  centerX: 0,
  centerY: 0,
  xUnitsPerPixel: 1,
  yUnitsPerPixel: 1,
  logView: { minExpX: -15, maxExpX: 26, minExpY: -23, maxExpY: 17 },
  pointerWorld: null,
  dragging: false,
  dragStart: null
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function fitBounds(bounds, padding = 70) {
  const rect = canvas.getBoundingClientRect();
  const usableWidth = Math.max(1, rect.width - padding * 2);
  const usableHeight = Math.max(1, rect.height - padding * 2);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  state.centerX = bounds.minX + width / 2;
  state.centerY = bounds.minY + height / 2;
  state.xUnitsPerPixel = width / usableWidth;
  state.yUnitsPerPixel = height / usableHeight;
  draw();
}

function screenToWorld(px, py) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: state.centerX + (px - rect.width / 2) * state.xUnitsPerPixel,
    y: state.centerY - (py - rect.height / 2) * state.yUnitsPerPixel
  };
}

function worldToScreen(x, y) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.width / 2 + (x - state.centerX) / state.xUnitsPerPixel,
    y: rect.height / 2 - (y - state.centerY) / state.yUnitsPerPixel
  };
}

function logToScreen(xExp, yExp) {
  const rect = canvas.getBoundingClientRect();
  const margin = chartMargin();
  const xRange = state.logView.maxExpX - state.logView.minExpX;
  const yRange = state.logView.maxExpY - state.logView.minExpY;
  return {
    x: margin.left + ((xExp - state.logView.minExpX) / xRange) * (rect.width - margin.left - margin.right),
    y: rect.height - margin.bottom - ((yExp - state.logView.minExpY) / yRange) * (rect.height - margin.top - margin.bottom)
  };
}

function chartMargin() {
  return { top: 42, right: 36, bottom: 58, left: 78 };
}

function formatUnit(value, unit) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) < 1e-9 && value !== 0) return `${value.toExponential(2)} ${unit}`;
  if (Math.abs(value) >= 1e4 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)) {
    return `${value.toExponential(2)} ${unit}`;
  }
  const rounded = value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return `${rounded === "-0" ? "0" : rounded} ${unit}`;
}

function niceStep(raw) {
  const exp = Math.floor(Math.log10(raw));
  const base = raw / Math.pow(10, exp);
  const nice = base <= 1 ? 1 : base <= 2 ? 2 : base <= 5 ? 5 : 10;
  return nice * Math.pow(10, exp);
}

function drawLinear() {
  const rect = canvas.getBoundingClientRect();
  const margin = chartMargin();
  const left = margin.left;
  const right = rect.width - margin.right;
  const top = margin.top;
  const bottom = rect.height - margin.bottom;
  const viewMin = screenToWorld(left, bottom);
  const viewMax = screenToWorld(right, top);
  const xStep = niceStep((viewMax.x - viewMin.x) / 7);
  const yStep = niceStep((viewMax.y - viewMin.y) / 6);

  drawGrid(viewMin, viewMax, xStep, yStep, left, right, top, bottom);
  drawWorldBounds();
  drawHumanBox();
  drawLinearLabels(viewMin, viewMax, xStep, yStep, left, right, top, bottom);
}

function drawGrid(viewMin, viewMax, xStep, yStep, left, right, top, bottom) {
  ctx.save();
  ctx.strokeStyle = "#e7dfcf";
  ctx.lineWidth = 1;
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillStyle = "#68645d";

  const firstX = Math.ceil(viewMin.x / xStep) * xStep;
  for (let x = firstX; x <= viewMax.x; x += xStep) {
    const p = worldToScreen(x, 0);
    if (p.x < left || p.x > right) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, top);
    ctx.lineTo(p.x, bottom);
    ctx.stroke();
  }

  const firstY = Math.ceil(viewMin.y / yStep) * yStep;
  for (let y = firstY; y <= viewMax.y; y += yStep) {
    const p = worldToScreen(0, y);
    if (p.y < top || p.y > bottom) continue;
    ctx.beginPath();
    ctx.moveTo(left, p.y);
    ctx.lineTo(right, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLinearLabels(viewMin, viewMax, xStep, yStep, left, right, top, bottom) {
  ctx.save();
  ctx.strokeStyle = "#161615";
  ctx.fillStyle = "#161615";
  ctx.lineWidth = 1.5;
  ctx.font = "12px system-ui, sans-serif";

  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, top);
  ctx.stroke();

  const firstX = Math.ceil(viewMin.x / xStep) * xStep;
  for (let x = firstX; x <= viewMax.x; x += xStep) {
    const p = worldToScreen(x, 0);
    if (p.x < left || p.x > right) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, bottom);
    ctx.lineTo(p.x, bottom + 6);
    ctx.stroke();
    ctx.fillText(formatUnit(x, "m"), p.x - 28, bottom + 22);
  }

  const firstY = Math.ceil(viewMin.y / yStep) * yStep;
  for (let y = firstY; y <= viewMax.y; y += yStep) {
    const p = worldToScreen(0, y);
    if (p.y < top || p.y > bottom) continue;
    ctx.beginPath();
    ctx.moveTo(left - 6, p.y);
    ctx.lineTo(left, p.y);
    ctx.stroke();
    ctx.fillText(formatUnit(y, "s"), 10, p.y + 4);
  }

  ctx.font = "700 15px system-ui, sans-serif";
  ctx.fillText("Space", (left + right) / 2 - 24, bottom + 46);
  ctx.fillText("Time", left + 8, top - 14);
  ctx.restore();
}

function drawWorldBounds() {
  const a = worldToScreen(world.minX, world.minY);
  const b = worldToScreen(world.maxX, world.maxY);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.save();
  ctx.strokeStyle = "#161615";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawHumanBox() {
  const a = worldToScreen(human.minX, human.minY);
  const b = worldToScreen(human.maxX, human.maxY);
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  ctx.save();
  ctx.strokeStyle = "#d64d2f";
  ctx.fillStyle = "rgba(214, 77, 47, 0.12)";
  ctx.lineWidth = 2.5;
  if (w >= 2 && h >= 2) {
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#9b2f1d";
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillText("Human experience", x + 8, y + 20);
  } else {
    const p = worldToScreen(human.maxX, human.maxY);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#d64d2f";
    ctx.fill();
    ctx.font = "700 13px system-ui, sans-serif";
    ctx.fillText("Human experience is compressed here", Math.min(p.x + 10, canvas.clientWidth - 230), Math.max(28, p.y - 10));
  }
  ctx.restore();
}

function drawLogReference() {
  const rect = canvas.getBoundingClientRect();
  const margin = chartMargin();
  const left = margin.left;
  const right = rect.width - margin.right;
  const top = margin.top;
  const bottom = rect.height - margin.bottom;

  ctx.save();
  ctx.fillStyle = "rgba(14, 124, 134, 0.08)";
  ctx.strokeStyle = "#161615";
  ctx.lineWidth = 2;
  ctx.fillRect(left, top, right - left, bottom - top);
  hatch(left, top, right - left, bottom - top);
  ctx.strokeRect(left, top, right - left, bottom - top);

  const h1 = logToScreen(Math.log10(human.minX), Math.log10(human.minY));
  const h2 = logToScreen(Math.log10(human.maxX), Math.log10(human.maxY));
  ctx.fillStyle = "#fffdf7";
  ctx.strokeStyle = "#d64d2f";
  ctx.lineWidth = 3;
  ctx.fillRect(h1.x, h2.y, h2.x - h1.x, h1.y - h2.y);
  ctx.strokeRect(h1.x, h2.y, h2.x - h1.x, h1.y - h2.y);
  ctx.fillStyle = "#161615";
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.fillText("Human", h1.x + 14, h2.y + 42);
  ctx.fillText("experience", h1.x + 14, h2.y + 66);

  drawLogAxis(left, right, top, bottom);
  ctx.restore();
}

function hatch(x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(22, 22, 21, 0.35)";
  ctx.lineWidth = 1.2;
  for (let i = -h; i < w; i += 16) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

function drawLogAxis(left, right, top, bottom) {
  ctx.fillStyle = "#161615";
  ctx.font = "700 16px system-ui, sans-serif";
  ctx.fillText("10^-15 m", left - 26, bottom + 32);
  ctx.fillText("10^26 m", right - 82, bottom + 32);
  ctx.fillText("10^17 s", left - 70, top + 8);
  ctx.fillText("10^-23 s", left - 78, bottom - 2);
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.fillText("Space", (left + right) / 2 - 28, bottom + 52);
  ctx.save();
  ctx.translate(28, (top + bottom) / 2 + 22);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Time", 0, 0);
  ctx.restore();
}

function draw() {
  const rect = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "#fbfaf4";
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (state.mode === "linear") {
    drawLinear();
  } else {
    drawLogReference();
  }

  updateReadouts();
}

function updateReadouts() {
  readouts.mode.textContent = state.mode === "linear" ? "Linear" : "Log reference";
  if (state.pointerWorld && state.mode === "linear") {
    readouts.x.textContent = formatUnit(state.pointerWorld.x, "m");
    readouts.y.textContent = formatUnit(state.pointerWorld.y, "s");
  } else {
    readouts.x.textContent = "-";
    readouts.y.textContent = "-";
  }

  if (state.mode === "linear") {
    const rect = canvas.getBoundingClientRect();
    readouts.width.textContent = formatUnit(rect.width * state.xUnitsPerPixel, "m");
    readouts.height.textContent = formatUnit(rect.height * state.yUnitsPerPixel, "s");
  } else {
    readouts.width.textContent = "10^-15 to 10^26 m";
    readouts.height.textContent = "10^-23 to 10^17 s";
  }
}

function zoomAt(px, py, factor) {
  const before = screenToWorld(px, py);
  state.xUnitsPerPixel *= factor;
  state.yUnitsPerPixel *= factor;
  const after = screenToWorld(px, py);
  state.centerX += before.x - after.x;
  state.centerY += before.y - after.y;
  draw();
}

canvas.addEventListener("wheel", event => {
  if (state.mode !== "linear") return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 0.82 : 1.22;
  zoomAt(event.offsetX, event.offsetY, factor);
}, { passive: false });

canvas.addEventListener("pointerdown", event => {
  if (state.mode !== "linear") return;
  canvas.setPointerCapture(event.pointerId);
  state.dragging = true;
  state.dragStart = { x: event.clientX, y: event.clientY, centerX: state.centerX, centerY: state.centerY };
});

canvas.addEventListener("pointermove", event => {
  const rect = canvas.getBoundingClientRect();
  state.pointerWorld = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  if (state.dragging && state.dragStart) {
    state.centerX = state.dragStart.centerX - (event.clientX - state.dragStart.x) * state.xUnitsPerPixel;
    state.centerY = state.dragStart.centerY + (event.clientY - state.dragStart.y) * state.yUnitsPerPixel;
  }
  draw();
});

canvas.addEventListener("pointerup", event => {
  canvas.releasePointerCapture(event.pointerId);
  state.dragging = false;
  state.dragStart = null;
});

canvas.addEventListener("pointerleave", () => {
  state.pointerWorld = null;
  draw();
});

document.querySelectorAll("[data-mode]").forEach(button => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll("[data-mode]").forEach(item => item.classList.toggle("active", item === button));
    draw();
  });
});

document.querySelectorAll("[data-preset]").forEach(button => {
  button.addEventListener("click", () => {
    state.mode = "linear";
    document.querySelectorAll("[data-mode]").forEach(item => item.classList.toggle("active", item.dataset.mode === "linear"));
    fitBounds(presets[button.dataset.preset]);
  });
});

document.querySelector("[data-reset]").addEventListener("click", () => fitBounds(presets.all));
document.querySelector("[data-zoom='in']").addEventListener("click", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 0.5));
document.querySelector("[data-zoom='out']").addEventListener("click", () => zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 2));

window.addEventListener("resize", resize);
resize();
fitBounds(presets.all);
