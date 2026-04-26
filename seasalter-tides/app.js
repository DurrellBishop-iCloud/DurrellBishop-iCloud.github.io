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

const CALENDAR_START_HOUR = 8;
const CALENDAR_END_HOUR = 20;
const WEEKEND_DAYS = new Set(["Sat", "Sun"]);
const CALENDAR_LEFT_PAD = 18;
const CALENDAR_AXIS_WIDTH = 66;
const CALENDAR_COLUMN_WIDTH = 7;
const CALENDAR_COLUMN_GAP = 5;
const CALENDAR_PITCH = CALENDAR_COLUMN_WIDTH + CALENDAR_COLUMN_GAP;
const CALENDAR_COLORS = {
  weekend: "#d96f1d",
  high: "#6abfe9",
  morning: "rgba(191, 226, 233, 0.72)",
  afternoon: "rgba(246, 241, 223, 0.84)",
  evening: "rgba(95, 104, 114, 0.18)",
};

const state = {
  events: [],
  rows: [],
  visibleRows: [],
  calendarRows: [],
  year: null,
  timezoneMode: "local",
  timeFormat: "24",
  tideFilter: "both",
  highlightWindowHours: 2,
  search: "",
  month: "all",
  startDate: "",
  endDate: "",
  loadedFromCache: false,
  cacheTimestamp: null,
  calendarScrollKey: "",
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
  versionPill: document.querySelector("#versionPill"),
  highlightWindow: document.querySelector("#highlightWindow"),
  visualEmptyState: document.querySelector("#visualEmptyState"),
  calendarWrap: document.querySelector("#calendarWrap"),
  calendarGraphic: document.querySelector("#calendarGraphic"),
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
  elements.versionPill.textContent = ENGINE_CONFIG.appVersion;

  populateMonthFilter();
  syncDateInputsForYear(defaultYear);
  attachEvents();
  updateSummary();
  renderCalendar();
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

  elements.highlightWindow.addEventListener("change", () => {
    state.highlightWindowHours = Number(elements.highlightWindow.value) || 2;
    renderCalendar();
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
  state.highlightWindowHours = Number(elements.highlightWindow.value) || 2;
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
    });

  state.calendarRows = rows;
  state.visibleRows = rows.map((row) => filterRowEvents(row, state.tideFilter));
  updateSummary();
  renderCalendar();
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

function renderCalendar() {
  const rows = state.calendarRows;
  const hasRows = rows.length > 0;
  const hasHighs = rows.some((row) => row.highs.length > 0);

  if (!hasRows) {
    elements.visualEmptyState.querySelector("h3").textContent = "No calendar drawn yet";
    elements.visualEmptyState.querySelector("p").textContent =
      "Generate a date range and the app will draw a thin-line high-tide calendar from 8am to 8pm.";
  } else if (!hasHighs) {
    elements.visualEmptyState.querySelector("h3").textContent = "No high tides in this filtered range";
    elements.visualEmptyState.querySelector("p").textContent =
      "Try widening the date range, clearing the search, or switching back to dates that include high-tide events.";
  }

  elements.visualEmptyState.style.display = hasRows && hasHighs ? "none" : "block";
  elements.calendarWrap.classList.toggle("is-hidden", !(hasRows && hasHighs));

  if (!(hasRows && hasHighs)) {
    state.calendarScrollKey = "";
    elements.calendarGraphic.innerHTML = "";
    return;
  }

  elements.calendarGraphic.innerHTML = buildCalendarSvg(rows);
  maybeScrollCalendarToToday(rows);
}

function buildCalendarSvg(rows) {
  const chartHeight = 540;
  const labelTop = 146;
  const bottomPad = 46;
  const chartWidth = rows.length * CALENDAR_PITCH;
  const totalWidth = CALENDAR_LEFT_PAD + chartWidth + CALENDAR_AXIS_WIDTH + 18;
  const totalHeight = labelTop + chartHeight + bottomPad;
  const middayY = labelTop + timeToY(12, chartHeight);
  const eveningY = labelTop + timeToY(18, chartHeight);
  const chartBottom = labelTop + chartHeight;
  const axisX = CALENDAR_LEFT_PAD + chartWidth + 12;
  const windowHours = state.highlightWindowHours;
  const labelIndices = pickCalendarLabelIndices(rows);
  const timeOptions = {
    timezoneMode: state.timezoneMode,
    timeZone: ENGINE_CONFIG.timezone,
  };

  const hourlyGuides = [];
  for (let hour = CALENDAR_END_HOUR; hour >= CALENDAR_START_HOUR; hour -= 1) {
    const y = labelTop + timeToY(hour, chartHeight);
    hourlyGuides.push(`
      <line x1="${CALENDAR_LEFT_PAD - 2}" y1="${y}" x2="${CALENDAR_LEFT_PAD + chartWidth + 2}" y2="${y}" stroke="rgba(255, 255, 255, 0.96)" stroke-width="2.4" />
      <line x1="${CALENDAR_LEFT_PAD - 2}" y1="${y}" x2="${CALENDAR_LEFT_PAD + chartWidth + 2}" y2="${y}" stroke="rgba(24, 33, 42, 0.04)" stroke-width="0.9" />
      <text x="${axisX}" y="${y + 4}" fill="rgba(24, 33, 42, 0.76)" font-size="14" font-family="Manrope, system-ui, sans-serif">${escapeHtml(
        formatAxisLabel(hour)
      )}</text>
    `);
  }

  const dayColumns = rows.map((row, index) => {
    const x = CALENDAR_LEFT_PAD + index * CALENDAR_PITCH;
    const isWeekend = WEEKEND_DAYS.has(row.day);
    const showLabel = labelIndices.has(index);
    const label = showLabel
      ? `
        <text
          x="${x + CALENDAR_COLUMN_WIDTH - 1}"
          y="${labelTop - 26}"
          transform="rotate(-90 ${x + CALENDAR_COLUMN_WIDTH - 1} ${labelTop - 26})"
          fill="${isWeekend ? CALENDAR_COLORS.weekend : "rgba(24, 33, 42, 0.74)"}"
          font-size="14"
          font-weight="${isWeekend ? 800 : 700}"
          font-family="Manrope, system-ui, sans-serif"
        >${escapeHtml(formatCalendarLabel(row))}</text>
      `
      : "";

    const weekendCaps = isWeekend
      ? `
        <rect x="${x + 1}" y="${labelTop - 16}" width="${CALENDAR_COLUMN_WIDTH - 1}" height="9" fill="${CALENDAR_COLORS.weekend}" />
        <rect x="${x + 1}" y="${chartBottom + 12}" width="${CALENDAR_COLUMN_WIDTH - 1}" height="9" fill="${CALENDAR_COLORS.weekend}" />
      `
      : "";

    const highlights = row.highs
      .map((event) => {
        const eventHour = getHourValueFromEpoch(event.epoch, timeOptions);
        const startHour = Math.max(CALENDAR_START_HOUR, eventHour - windowHours);
        const endHour = Math.min(CALENDAR_END_HOUR, eventHour + windowHours);

        if (endHour <= CALENDAR_START_HOUR || startHour >= CALENDAR_END_HOUR) {
          return "";
        }

        const y = labelTop + timeToY(endHour, chartHeight);
        const height = timeToY(startHour, chartHeight) - timeToY(endHour, chartHeight);

        return `
          <rect
            x="${x + 1}"
            y="${y + 1}"
            width="${CALENDAR_COLUMN_WIDTH - 2}"
            height="${Math.max(0, height - 2)}"
            fill="${CALENDAR_COLORS.high}"
            opacity="0.92"
          />
        `;
      })
      .join("");

    return `
      <g>
        ${label}
        ${weekendCaps}
        <rect x="${x}" y="${labelTop}" width="${CALENDAR_COLUMN_WIDTH}" height="${middayY - labelTop}" fill="${CALENDAR_COLORS.afternoon}" />
        <rect x="${x}" y="${labelTop}" width="${CALENDAR_COLUMN_WIDTH}" height="${eveningY - labelTop}" fill="${CALENDAR_COLORS.evening}" opacity="0.72" />
        <rect x="${x}" y="${middayY}" width="${CALENDAR_COLUMN_WIDTH}" height="${chartBottom - middayY}" fill="${CALENDAR_COLORS.morning}" />
        ${highlights}
        <rect x="${x + 3}" y="${labelTop}" width="1.4" height="${chartHeight}" fill="${isWeekend ? "rgba(217, 111, 29, 0.56)" : "rgba(90, 100, 108, 0.16)"}" />
      </g>
    `;
  });

  const title = `${ENGINE_CONFIG.stationLabel} high tide calendar, ${CALENDAR_START_HOUR}am to ${CALENDAR_END_HOUR - 12}pm`;

  return `
    <svg
      class="calendar-svg"
      xmlns="http://www.w3.org/2000/svg"
      width="${totalWidth}"
      height="${totalHeight}"
      viewBox="0 0 ${totalWidth} ${totalHeight}"
      role="img"
      aria-label="${escapeHtml(title)}"
    >
      <rect x="0" y="0" width="${totalWidth}" height="${totalHeight}" fill="transparent" />
      ${hourlyGuides.join("")}
      ${dayColumns.join("")}
    </svg>
  `;
}

function maybeScrollCalendarToToday(rows) {
  const today = getTodayDateKey({
    timezoneMode: state.timezoneMode,
    timeZone: ENGINE_CONFIG.timezone,
  });
  const todayIndex = rows.findIndex((row) => row.date === today);
  const rowAnchor = todayIndex >= 0 ? today : rows[0]?.date || "";
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const scrollKey = `${rows[0]?.date || ""}|${lastRow?.date || ""}|${rows.length}|${rowAnchor}|${state.timezoneMode}`;

  if (state.calendarScrollKey === scrollKey) {
    return;
  }

  state.calendarScrollKey = scrollKey;

  requestAnimationFrame(() => {
    const targetIndex = todayIndex >= 0 ? todayIndex : 0;
    const targetLeft = Math.max(0, targetIndex * CALENDAR_PITCH - 8);
    elements.calendarWrap.scrollLeft = targetLeft;
  });
}

function pickCalendarLabelIndices(rows) {
  const picked = new Set();
  let lastPicked = -99;
  const minimumGap = 4;

  rows.forEach((row, index) => {
    const isEdge = index === 0 || index === rows.length - 1;
    const isMonthStart = row.date.slice(8, 10) === "01";
    const isSaturday = row.day === "Sat";
    if (!isEdge && !isMonthStart && !isSaturday) {
      return;
    }

    if (isEdge || index - lastPicked >= minimumGap) {
      picked.add(index);
      lastPicked = index;
    }
  });

  return picked;
}

function formatCalendarLabel(row) {
  const day = row.date.slice(8, 10).replace(/^0/, "");
  const month = MONTHS[Number(row.date.slice(5, 7)) - 1].slice(0, 3);
  return `${row.day} ${day} ${month}`;
}

function formatAxisLabel(hour) {
  if (hour === CALENDAR_END_HOUR) return "8 pm";
  if (hour === 12) return "midday";
  if (hour === CALENDAR_START_HOUR) return "8 am";
  if (hour > 12) return String(hour - 12);
  return String(hour);
}

function timeToY(hourValue, chartHeight) {
  const minutesFromTop = (CALENDAR_END_HOUR - hourValue) * 60;
  const totalMinutes = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 60;
  return (minutesFromTop / totalMinutes) * chartHeight;
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
    ["App version", ENGINE_CONFIG.appVersion],
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
  if (elements.yearLabel) {
    elements.yearLabel.textContent = state.year ? String(state.year) : "-";
  }
  if (elements.visibleRowsLabel) {
    elements.visibleRowsLabel.textContent = String(state.visibleRows.length);
  }
  if (elements.sourceLabel) {
    elements.sourceLabel.textContent = ENGINE_CONFIG.sourceName;
  }
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
  return getDateKeyFromDate(new Date(epochSeconds * 1000), options);
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

function getHourValueFromEpoch(epochSeconds, options) {
  const date = new Date(epochSeconds * 1000);

  if (options.timezoneMode === "utc") {
    return date.getUTCHours() + date.getUTCMinutes() / 60;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) + Number(values.minute) / 60;
}

function getTodayDateKey(options) {
  return getDateKeyFromDate(new Date(), options);
}

function getDateKeyFromDate(date, options) {
  if (options.timezoneMode === "utc") {
    return date.toISOString().slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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
