const CONFIG = {
  stationName: "Seasalter",
  stationLabel: "Seasalter, Kent",
  latitude: 51.349,
  longitude: 1.0049,
  timezone: "Europe/London",
  units: "m",
  cacheVersion: "v1",
  apiBase: "https://www.worldtides.info/api/v3",
  sourceName: "WorldTides API",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const state = {
  events: [],
  rows: [],
  visibleRows: [],
  year: null,
  timezoneMode: "local",
  timeFormat: "24",
  tideFilter: "both",
  search: "",
  month: "all",
  startDate: "",
  endDate: "",
  loadedFromCache: false,
  cacheTimestamp: null,
  responseTimezone: CONFIG.timezone,
};

const elements = {
  form: document.querySelector("#controls-form"),
  apiKey: document.querySelector("#apiKey"),
  toggleApiKey: document.querySelector("#toggleApiKey"),
  yearInput: document.querySelector("#yearInput"),
  timezoneMode: document.querySelector("#timezoneMode"),
  timeFormat: document.querySelector("#timeFormat"),
  tideFilter: document.querySelector("#tideFilter"),
  monthFilter: document.querySelector("#monthFilter"),
  startDate: document.querySelector("#startDate"),
  endDate: document.querySelector("#endDate"),
  searchInput: document.querySelector("#searchInput"),
  generateButton: document.querySelector("#generateButton"),
  refreshButton: document.querySelector("#refreshButton"),
  csvButton: document.querySelector("#csvButton"),
  xlsxButton: document.querySelector("#xlsxButton"),
  statusMessage: document.querySelector("#statusMessage"),
  cachePill: document.querySelector("#cachePill"),
  rowsPill: document.querySelector("#rowsPill"),
  visibleRowsLabel: document.querySelector("#visibleRowsLabel"),
  yearLabel: document.querySelector("#yearLabel"),
  sourceLabel: document.querySelector("#sourceLabel"),
  emptyState: document.querySelector("#emptyState"),
  tableWrap: document.querySelector("#tableWrap"),
  tableHead: document.querySelector("#tideTableHead"),
  tableBody: document.querySelector("#tideTableBody"),
};

init();

function init() {
  const now = new Date();
  const defaultYear = now.getFullYear();
  elements.yearInput.value = String(defaultYear);

  const savedKey = localStorage.getItem("seasalter-worldtides-api-key");
  if (savedKey) {
    elements.apiKey.value = savedKey;
  }

  populateMonthFilter();
  syncDateInputsForYear(defaultYear);
  attachEvents();
  updateSummary();
  renderTable();
}

function attachEvents() {
  elements.toggleApiKey.addEventListener("click", () => {
    const nextType = elements.apiKey.type === "password" ? "text" : "password";
    elements.apiKey.type = nextType;
    elements.toggleApiKey.textContent = nextType === "password" ? "Show" : "Hide";
  });

  elements.yearInput.addEventListener("change", () => {
    const year = Number(elements.yearInput.value);
    if (Number.isInteger(year)) {
      syncDateInputsForYear(year);
    }
  });

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await generateTable({ forceRefresh: false });
  });

  elements.refreshButton.addEventListener("click", async () => {
    await generateTable({ forceRefresh: true });
  });

  elements.timezoneMode.addEventListener("change", () => {
    state.timezoneMode = elements.timezoneMode.value;
    rebuildRowsFromEvents();
  });

  elements.timeFormat.addEventListener("change", () => {
    state.timeFormat = elements.timeFormat.value;
    rebuildRowsFromEvents();
  });

  elements.tideFilter.addEventListener("change", () => {
    state.tideFilter = elements.tideFilter.value;
    applyFiltersAndRender();
  });

  elements.monthFilter.addEventListener("change", () => {
    state.month = elements.monthFilter.value;
    applyFiltersAndRender();
  });

  elements.startDate.addEventListener("change", () => {
    state.startDate = elements.startDate.value;
    applyFiltersAndRender();
  });

  elements.endDate.addEventListener("change", () => {
    state.endDate = elements.endDate.value;
    applyFiltersAndRender();
  });

  elements.searchInput.addEventListener("input", () => {
    state.search = elements.searchInput.value.trim().toLowerCase();
    applyFiltersAndRender();
  });

  elements.csvButton.addEventListener("click", exportCsv);
  elements.xlsxButton.addEventListener("click", exportXlsx);
}

async function generateTable({ forceRefresh }) {
  const apiKey = elements.apiKey.value.trim();
  const year = Number(elements.yearInput.value);

  if (!apiKey) {
    setStatus("Add a WorldTides API key first.");
    return;
  }

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    setStatus("Choose a valid year between 2000 and 2100.");
    return;
  }

  localStorage.setItem("seasalter-worldtides-api-key", apiKey);
  state.year = year;
  state.timezoneMode = elements.timezoneMode.value;
  state.timeFormat = elements.timeFormat.value;
  state.tideFilter = elements.tideFilter.value;
  state.month = elements.monthFilter.value;
  state.startDate = elements.startDate.value;
  state.endDate = elements.endDate.value;
  state.search = elements.searchInput.value.trim().toLowerCase();

  setBusy(true);
  setStatus(`Loading ${year} tide extremes for Seasalter...`);

  try {
    const payload = await loadYearEvents({ apiKey, year, forceRefresh });
    state.events = payload.events;
    state.loadedFromCache = payload.loadedFromCache;
    state.cacheTimestamp = payload.cachedAt;
    state.responseTimezone = payload.timezone || CONFIG.timezone;
    rebuildRowsFromEvents();
    setStatus(
      `Loaded ${state.events.length} tide events for ${year}${state.loadedFromCache ? " from cache" : ""}.`
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while fetching tide data.");
  } finally {
    setBusy(false);
  }
}

async function loadYearEvents({ apiKey, year, forceRefresh }) {
  const cacheKey = `seasalter-tides:${CONFIG.cacheVersion}:${year}`;

  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        loadedFromCache: true,
      };
    }
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const requests = [];
  let cursor = new Date(yearStart);

  while (cursor <= yearEnd) {
    const chunkStart = new Date(cursor);
    const chunkEnd = new Date(Date.UTC(chunkStart.getUTCFullYear(), chunkStart.getUTCMonth(), chunkStart.getUTCDate() + 6));
    const effectiveEnd = chunkEnd < yearEnd ? chunkEnd : yearEnd;
    const diffDays = Math.floor((effectiveEnd - chunkStart) / 86400000) + 1;
    requests.push({
      date: formatIsoDateUtc(chunkStart),
      days: diffDays,
    });
    cursor = new Date(Date.UTC(chunkStart.getUTCFullYear(), chunkStart.getUTCMonth(), chunkStart.getUTCDate() + 7));
  }

  const chunks = [];
  let timezone = CONFIG.timezone;

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    setStatus(`Fetching ${year} data... chunk ${index + 1} of ${requests.length}`);
    const chunk = await fetchChunk({
      apiKey,
      startDate: request.date,
      days: request.days,
    });
    timezone = chunk.timezone || timezone;
    chunks.push(...chunk.events);
  }

  const deduped = dedupeEvents(chunks);
  const payload = {
    events: deduped,
    timezone,
    cachedAt: new Date().toISOString(),
    loadedFromCache: false,
  };

  writeCache(cacheKey, payload);
  return payload;
}

async function fetchChunk({ apiKey, startDate, days }) {
  const url = new URL(CONFIG.apiBase);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("lat", String(CONFIG.latitude));
  url.searchParams.set("lon", String(CONFIG.longitude));
  url.searchParams.set("extremes", "");
  url.searchParams.set("date", startDate);
  url.searchParams.set("days", String(days));
  url.searchParams.set("localtime", "");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`WorldTides returned ${response.status}. Please check the API key and try again.`);
  }

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  if (!Array.isArray(data.extremes)) {
    throw new Error("The tide source did not return any extremes for this request.");
  }

  return {
    timezone: data.timezone || CONFIG.timezone,
    events: data.extremes.map((entry) => ({
      dt: entry.dt,
      date: entry.date,
      height: entry.height,
      type: entry.type,
    })),
  };
}

function dedupeEvents(events) {
  const seen = new Set();
  return events
    .filter((event) => {
      const key = `${event.dt}:${event.type}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.dt - b.dt);
}

function rebuildRowsFromEvents() {
  state.rows = buildRows(state.events, {
    timezoneMode: state.timezoneMode,
    timeZone: state.responseTimezone || CONFIG.timezone,
    timeFormat: state.timeFormat,
  });
  applyFiltersAndRender();
}

function buildRows(events, options) {
  const groups = new Map();

  events.forEach((event) => {
    const dateKey = getDateKeyFromEpoch(event.dt, options);
    const dayLabel = getDayLabelFromEpoch(event.dt, options);
    const eventView = {
      type: event.type.toLowerCase(),
      time: formatTimeFromEpoch(event.dt, options),
      height: formatHeight(event.height),
      epoch: event.dt,
      rawHeight: event.height,
    };

    if (!groups.has(dateKey)) {
      groups.set(dateKey, {
        date: dateKey,
        day: dayLabel,
        highs: [],
        lows: [],
        notes: "",
      });
    }

    const row = groups.get(dateKey);
    if (eventView.type === "high") {
      row.highs.push(eventView);
    } else {
      row.lows.push(eventView);
    }
  });

  return Array.from(groups.values())
    .map((row) => {
      row.highs.sort((a, b) => a.epoch - b.epoch);
      row.lows.sort((a, b) => a.epoch - b.epoch);
      const counts = [];
      if (row.highs.length > 2) counts.push(`${row.highs.length} highs`);
      if (row.lows.length > 2) counts.push(`${row.lows.length} lows`);
      row.notes = counts.join(", ");
      return row;
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

function applyFiltersAndRender() {
  let rows = [...state.rows];

  rows = rows.filter((row) => {
    if (state.month !== "all") {
      const monthIndex = String(Number(row.date.slice(5, 7)) - 1);
      if (monthIndex !== state.month) return false;
    }

    if (state.startDate && row.date < state.startDate) return false;
    if (state.endDate && row.date > state.endDate) return false;

    const filtered = filterRowEvents(row, state.tideFilter);
    if (filtered.highs.length === 0 && filtered.lows.length === 0) return false;

    if (state.search) {
      const haystack = [
        row.date,
        row.day,
        MONTHS[Number(row.date.slice(5, 7)) - 1],
        filtered.highs.map((item) => `${item.type} ${item.time} ${item.height}`).join(" "),
        filtered.lows.map((item) => `${item.type} ${item.time} ${item.height}`).join(" "),
        row.notes,
      ]
        .join(" ")
        .toLowerCase();

      if (!haystack.includes(state.search)) return false;
    }

    return true;
  }).map((row) => filterRowEvents(row, state.tideFilter));

  state.visibleRows = rows;
  updateSummary();
  renderTable();
}

function filterRowEvents(row, tideFilter) {
  if (tideFilter === "high") {
    return { ...row, highs: row.highs, lows: [] };
  }

  if (tideFilter === "low") {
    return { ...row, highs: [], lows: row.lows };
  }

  return { ...row, highs: row.highs, lows: row.lows };
}

function renderTable() {
  const rows = state.visibleRows;
  const hasRows = rows.length > 0;
  const maxHighs = Math.max(0, ...rows.map((row) => row.highs.length));
  const maxLows = Math.max(0, ...rows.map((row) => row.lows.length));
  const slotCount = Math.max(maxHighs, maxLows, 2);

  elements.emptyState.style.display = hasRows ? "none" : "block";
  elements.tableWrap.classList.toggle("is-hidden", !hasRows);
  elements.csvButton.disabled = !hasRows;
  elements.xlsxButton.disabled = !hasRows;

  if (!hasRows) {
    elements.tableHead.innerHTML = "";
    elements.tableBody.innerHTML = "";
    return;
  }

  const columns = ["Date", "Day"];
  for (let index = 1; index <= slotCount; index += 1) {
    columns.push(`High Tide ${index}`, "Height", `Low Tide ${index}`, "Height");
  }
  columns.push("Notes");

  elements.tableHead.innerHTML = `
    <tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
  `;

  elements.tableBody.innerHTML = rows
    .map((row) => {
      const cells = [row.date, row.day];
      for (let index = 0; index < slotCount; index += 1) {
        const high = row.highs[index];
        const low = row.lows[index];
        cells.push(high ? high.time : "", high ? high.height : "", low ? low.time : "", low ? low.height : "");
      }
      cells.push(row.notes || "");

      return `<tr>${cells
        .map((cell, index) => {
          const className = index === cells.length - 1 ? "notes-cell" : "";
          return `<td class="${className}">${escapeHtml(cell)}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
}

function exportCsv() {
  if (state.visibleRows.length === 0) return;
  const exportRows = buildExportRows(state.visibleRows);
  const metadataRows = buildMetadataRows();
  const csv = [...metadataRows, [], exportRows.headers, ...exportRows.rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\r\n");

  downloadBlob(csv, `seasalter-tides-${state.year || elements.yearInput.value}.csv`, "text/csv;charset=utf-8;");
}

function exportXlsx() {
  if (state.visibleRows.length === 0) return;
  if (!window.XLSX) {
    setStatus("Excel export is unavailable because the spreadsheet library did not load.");
    return;
  }

  const exportRows = buildExportRows(state.visibleRows);
  const workbook = XLSX.utils.book_new();
  const metadataSheet = XLSX.utils.aoa_to_sheet(buildMetadataRows());
  const tableSheet = XLSX.utils.aoa_to_sheet([exportRows.headers, ...exportRows.rows]);

  XLSX.utils.book_append_sheet(workbook, metadataSheet, "Metadata");
  XLSX.utils.book_append_sheet(workbook, tableSheet, "Tide Table");
  XLSX.writeFile(workbook, `seasalter-tides-${state.year || elements.yearInput.value}.xlsx`);
}

function buildExportRows(rows) {
  const maxHighs = Math.max(0, ...rows.map((row) => row.highs.length));
  const maxLows = Math.max(0, ...rows.map((row) => row.lows.length));
  const slotCount = Math.max(maxHighs, maxLows, 2);
  const headers = ["Date", "Day"];

  for (let index = 1; index <= slotCount; index += 1) {
    headers.push(`High Tide ${index}`, "Height", `Low Tide ${index}`, "Height");
  }
  headers.push("Notes");

  const exportRows = rows.map((row) => {
    const cells = [row.date, row.day];
    for (let index = 0; index < slotCount; index += 1) {
      const high = row.highs[index];
      const low = row.lows[index];
      cells.push(high ? high.time : "", high ? high.height : "", low ? low.time : "", low ? low.height : "");
    }
    cells.push(row.notes || "");
    return cells;
  });

  return { headers, rows: exportRows };
}

function buildMetadataRows() {
  return [
    ["Location", CONFIG.stationLabel],
    ["Year", String(state.year || elements.yearInput.value)],
    ["Units", "Metres"],
    ["Time zone mode", state.timezoneMode === "utc" ? "UTC" : `${state.responseTimezone || CONFIG.timezone} (local)`],
    ["Time format", state.timeFormat === "12" ? "12-hour" : "24-hour"],
    ["Tide filter", labelForTideFilter(state.tideFilter)],
    ["Date range", `${state.startDate || "Year start"} to ${state.endDate || "Year end"}`],
    ["Month filter", state.month === "all" ? "All months" : MONTHS[Number(state.month)]],
    ["Search", state.search || "-"],
    ["Data source", CONFIG.sourceName],
    ["Generated", new Date().toLocaleString("en-GB")],
  ];
}

function updateSummary() {
  elements.yearLabel.textContent = state.year ? String(state.year) : "-";
  elements.visibleRowsLabel.textContent = String(state.visibleRows.length);
  elements.sourceLabel.textContent = CONFIG.sourceName;
  elements.rowsPill.textContent = `${state.visibleRows.length} rows`;

  if (state.loadedFromCache && state.cacheTimestamp) {
    elements.cachePill.textContent = `Cached ${new Date(state.cacheTimestamp).toLocaleDateString("en-GB")}`;
  } else if (state.events.length > 0) {
    elements.cachePill.textContent = "Fresh API data";
  } else {
    elements.cachePill.textContent = "No cache yet";
  }
}

function setBusy(isBusy) {
  elements.generateButton.disabled = isBusy;
  elements.refreshButton.disabled = isBusy;
  elements.csvButton.disabled = isBusy || state.visibleRows.length === 0;
  elements.xlsxButton.disabled = isBusy || state.visibleRows.length === 0;
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

function populateMonthFilter() {
  elements.monthFilter.innerHTML = [
    `<option value="all">All months</option>`,
    ...MONTHS.map((month, index) => `<option value="${index}">${month}</option>`),
  ].join("");
}

function syncDateInputsForYear(year) {
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;
  elements.startDate.value = start;
  elements.endDate.value = end;
  state.startDate = start;
  state.endDate = end;
}

function formatHeight(height) {
  return `${Number(height).toFixed(2)} ${CONFIG.units}`;
}

function getDateKeyFromEpoch(epochSeconds, options) {
  if (options.timezoneMode === "utc") {
    return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochSeconds * 1000));

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getDayLabelFromEpoch(epochSeconds, options) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timezoneMode === "utc" ? "UTC" : options.timeZone,
    weekday: "short",
  }).format(new Date(epochSeconds * 1000));
}

function formatTimeFromEpoch(epochSeconds, options) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timezoneMode === "utc" ? "UTC" : options.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: options.timeFormat === "12",
  }).format(new Date(epochSeconds * 1000));
}

function formatIsoDateUtc(date) {
  return date.toISOString().slice(0, 10);
}

function labelForTideFilter(value) {
  if (value === "high") return "High only";
  if (value === "low") return "Low only";
  return "High and low";
}

function readCache(cacheKey) {
  try {
    const raw = localStorage.getItem(cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Could not read cache", error);
    return null;
  }
}

function writeCache(cacheKey, payload) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("Could not write cache", error);
  }
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
