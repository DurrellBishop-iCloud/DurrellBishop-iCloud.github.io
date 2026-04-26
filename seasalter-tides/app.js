import { createTidePredictor } from "./neaps-tide-predictor.js";
import { ENGINE_CONFIG, CONSTITUENTS } from "./tide-engine-data.js";

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
};

const elements = {
  form: document.querySelector("#controls-form"),
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

  populateMonthFilter();
  syncDateInputsForYear(defaultYear);
  attachEvents();
  updateSummary();
  renderTable();
  generateTable({ forceRefresh: false });
}

function attachEvents() {
  elements.yearInput.addEventListener("change", () => {
    const year = Number(elements.yearInput.value);
    if (Number.isInteger(year)) {
      syncDateInputsForYear(year);
    }
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();
    generateTable({ forceRefresh: false });
  });

  elements.refreshButton.addEventListener("click", () => {
    generateTable({ forceRefresh: true });
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

function generateTable({ forceRefresh }) {
  const year = Number(elements.yearInput.value);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    setStatus("Choose a valid year between 2000 and 2100.");
    return;
  }

  state.year = year;
  state.timezoneMode = elements.timezoneMode.value;
  state.timeFormat = elements.timeFormat.value;
  state.tideFilter = elements.tideFilter.value;
  state.month = elements.monthFilter.value;
  state.startDate = elements.startDate.value;
  state.endDate = elements.endDate.value;
  state.search = elements.searchInput.value.trim().toLowerCase();

  setBusy(true);
  setStatus(`Generating ${year} Seasalter tide table from the built-in harmonic engine...`);

  try {
    const payload = loadYearEvents({ year, forceRefresh });
    state.events = payload.events;
    state.loadedFromCache = payload.loadedFromCache;
    state.cacheTimestamp = payload.cachedAt;
    rebuildRowsFromEvents();
    setStatus(
      `Generated ${state.events.length} tide events for ${year}${state.loadedFromCache ? " from local cache" : ""}.`
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while generating the tide table.");
  } finally {
    setBusy(false);
  }
}

function loadYearEvents({ year, forceRefresh }) {
  const cacheKey = `seasalter-tides:${ENGINE_CONFIG.cacheVersion}:${year}`;

  if (!forceRefresh) {
    const cached = readCache(cacheKey);
    if (cached) {
      return {
        ...cached,
        loadedFromCache: true,
      };
    }
  }

  const predictor = createTidePredictor(CONSTITUENTS, {
    offset: ENGINE_CONFIG.referenceOffset,
  });

  // Generate a small buffer around the requested year so local-time display can
  // include events that cross the UTC midnight boundary.
  const start = new Date(Date.UTC(year - 1, 11, 31, 0, 0, 0));
  const end = new Date(Date.UTC(year + 1, 0, 2, 0, 0, 0));

  const extremes = predictor.getExtremesPrediction({
    start,
    end,
    offsets: ENGINE_CONFIG.subordinateOffsets,
    labels: {
      high: "High",
      low: "Low",
    },
  });

  const payload = {
    events: extremes
      .map((entry) => ({
        dt: Math.round(entry.time.getTime() / 1000),
        height: entry.level,
        type: entry.high ? "high" : "low",
      }))
      .sort((a, b) => a.dt - b.dt),
    cachedAt: new Date().toISOString(),
    loadedFromCache: false,
  };

  writeCache(cacheKey, payload);
  return payload;
}

function rebuildRowsFromEvents() {
  state.rows = buildRows(state.events, {
    timezoneMode: state.timezoneMode,
    timeZone: ENGINE_CONFIG.timezone,
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

  rows = rows
    .filter((row) => {
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
    })
    .map((row) => filterRowEvents(row, state.tideFilter));

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

  downloadBlob(csv, `seasalter-tides-${state.year}.csv`, "text/csv;charset=utf-8;");
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
  XLSX.writeFile(workbook, `seasalter-tides-${state.year}.xlsx`);
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
    ["Location", ENGINE_CONFIG.stationLabel],
    ["Year", String(state.year)],
    ["Units", "Metres"],
    ["Time zone mode", state.timezoneMode === "utc" ? "UTC" : `${ENGINE_CONFIG.timezone} (local)`],
    ["Time format", state.timeFormat === "12" ? "12-hour" : "24-hour"],
    ["Tide filter", labelForTideFilter(state.tideFilter)],
    ["Date range", `${state.startDate || "Year start"} to ${state.endDate || "Year end"}`],
    ["Month filter", state.month === "all" ? "All months" : MONTHS[Number(state.month)]],
    ["Search", state.search || "-"],
    ["Data source", ENGINE_CONFIG.dataSource],
    ["Reference station", ENGINE_CONFIG.referenceStation],
    ["Prediction engine", ENGINE_CONFIG.engineName],
    ["Validation", ENGINE_CONFIG.validationNote],
    ["Validation mean time error", `${ENGINE_CONFIG.validationFit.meanAbsTimeMinutes} minutes`],
    ["Validation mean height error", `${ENGINE_CONFIG.validationFit.meanAbsHeightMetres} m`],
    ["Generated", new Date().toLocaleString("en-GB")],
    ["Notice", "Open-data approximation. Not for navigation."],
  ];
}

function updateSummary() {
  elements.yearLabel.textContent = state.year ? String(state.year) : "-";
  elements.visibleRowsLabel.textContent = String(state.visibleRows.length);
  elements.sourceLabel.textContent = ENGINE_CONFIG.sourceName;
  elements.rowsPill.textContent = `${state.visibleRows.length} rows`;

  if (state.loadedFromCache && state.cacheTimestamp) {
    elements.cachePill.textContent = `Cached ${new Date(state.cacheTimestamp).toLocaleDateString("en-GB")}`;
  } else if (state.events.length > 0) {
    elements.cachePill.textContent = "Fresh local engine";
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
  return `${Number(height).toFixed(2)} ${ENGINE_CONFIG.units}`;
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
