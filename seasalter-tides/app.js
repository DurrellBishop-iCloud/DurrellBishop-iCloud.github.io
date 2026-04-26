import { createTidePredictor } from "./neaps-tide-predictor.js?v=0.8.20";
import { ENGINE_CONFIG, CONSTITUENTS } from "./tide-engine-data.js?v=0.8.20";

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
const STATION_COORDS = { lat: 51.349, lon: 1.0049 };
const CALENDAR_LEFT_PAD = 18;
const CALENDAR_WEEKEND_WIDTH = 7;
const CALENDAR_WEEKDAY_WIDTH = 2.4;
const CALENDAR_COLUMN_GAP = 5;
const CALENDAR_CHART_HEIGHT = 540;
const CALENDAR_LABEL_TOP = 146;
const CALENDAR_BOTTOM_PAD = 46;
const CALENDAR_COLORS = {
  weekend: "#d96f1d",
  monthStart: "rgba(95, 104, 114, 0.72)",
  high: "#6abfe9",
  morning: "rgba(191, 226, 233, 0.72)",
  afternoon: "rgba(246, 241, 223, 0.84)",
  sundown: "rgba(95, 104, 114, 0.18)",
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
  calendarScrollSyncing: false,
  calendarDayLayouts: [],
  pendingScrollDate: "",
  resizeFrame: 0,
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
  todayButton: document.querySelector("#todayButton"),
  jumpDateInput: document.querySelector("#jumpDateInput"),
  calendarLeadDateTop: document.querySelector("#calendarLeadDateTop"),
  calendarLeadDateBottom: document.querySelector("#calendarLeadDateBottom"),
  visualEmptyState: document.querySelector("#visualEmptyState"),
  calendarPanel: document.querySelector("#calendarPanel"),
  calendarRangeTop: document.querySelector("#calendarRangeTop"),
  calendarRangeBottom: document.querySelector("#calendarRangeBottom"),
  calendarAxisLeft: document.querySelector("#calendarAxisLeft"),
  calendarAxisRight: document.querySelector("#calendarAxisRight"),
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
  elements.jumpDateInput.value = getTodayDateKey({
    timezoneMode: "local",
    timeZone: ENGINE_CONFIG.timezone,
  });
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

  elements.todayButton.addEventListener("click", handleTodayJump);
  elements.jumpDateInput.addEventListener("change", handleJumpDate);
  elements.calendarRangeTop.addEventListener("input", handleCalendarRangeInput);
  elements.calendarRangeBottom.addEventListener("input", handleCalendarRangeInput);
  elements.calendarWrap.addEventListener("scroll", syncCalendarScrollUi);
  window.addEventListener("resize", handleWindowResize);

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
  elements.calendarPanel.classList.toggle("is-hidden", !(hasRows && hasHighs));

  if (!(hasRows && hasHighs)) {
    state.calendarScrollKey = "";
    state.calendarDayLayouts = [];
    elements.calendarGraphic.innerHTML = "";
    elements.calendarAxisLeft.innerHTML = "";
    elements.calendarAxisRight.innerHTML = "";
    setCalendarLeadDate("");
    return;
  }

  const calendarView = buildCalendarSvg(rows);
  state.calendarDayLayouts = calendarView.dayLayouts;
  elements.calendarPanel.style.setProperty("--calendar-total-height", `${calendarView.totalHeight}px`);
  elements.calendarPanel.style.setProperty("--calendar-label-top", `${calendarView.labelTop}px`);
  elements.calendarPanel.style.setProperty("--calendar-hour-height", `${calendarView.hourHeight}px`);
  elements.calendarGraphic.innerHTML = calendarView.svg;
  elements.calendarAxisLeft.innerHTML = buildCalendarAxisMarkup("left");
  elements.calendarAxisRight.innerHTML = buildCalendarAxisMarkup("right");
  updateCalendarRangeBounds();
  syncCalendarScrollUi();
  maybeScrollCalendarToToday(rows);
}

function buildCalendarSvg(rows) {
  const { chartHeight, labelTop, bottomPad } = getCalendarMetrics();
  const timeOptions = {
    timezoneMode: state.timezoneMode,
    timeZone: ENGINE_CONFIG.timezone,
  };
  const dayLayouts = buildCalendarDayLayouts(rows, timeOptions);
  const chartWidth = dayLayouts.length === 0
    ? 0
    : dayLayouts[dayLayouts.length - 1].x + dayLayouts[dayLayouts.length - 1].width - CALENDAR_LEFT_PAD;
  const totalWidth = CALENDAR_LEFT_PAD + chartWidth + 18;
  const totalHeight = labelTop + chartHeight + bottomPad;
  const middayY = labelTop + timeToY(12, chartHeight);
  const chartBottom = labelTop + chartHeight;
  const windowHours = state.highlightWindowHours;
  const labelIndices = pickCalendarLabelIndices(rows);

  const hourlyGuides = [];
  for (let hour = CALENDAR_END_HOUR; hour >= CALENDAR_START_HOUR; hour -= 1) {
    const y = labelTop + timeToY(hour, chartHeight);
    hourlyGuides.push(`
      <line x1="${CALENDAR_LEFT_PAD - 2}" y1="${y}" x2="${CALENDAR_LEFT_PAD + chartWidth + 2}" y2="${y}" stroke="rgba(255, 255, 255, 0.96)" stroke-width="2.4" />
      <line x1="${CALENDAR_LEFT_PAD - 2}" y1="${y}" x2="${CALENDAR_LEFT_PAD + chartWidth + 2}" y2="${y}" stroke="rgba(24, 33, 42, 0.04)" stroke-width="0.9" />
    `);
  }

  const dayColumns = dayLayouts.map((layout, index) => {
    const { row, x, width, isWeekend, isMonthStart, sunsetHour } = layout;
    const showLabel = labelIndices.has(index);
    const markerColor = isMonthStart ? CALENDAR_COLORS.monthStart : CALENDAR_COLORS.weekend;
    const label = showLabel
      ? `
        <text
          x="${x + width - 1}"
          y="${labelTop - 26}"
          transform="rotate(-90 ${x + width - 1} ${labelTop - 26})"
          fill="${isMonthStart ? CALENDAR_COLORS.monthStart : isWeekend ? CALENDAR_COLORS.weekend : "rgba(24, 33, 42, 0.74)"}"
          font-size="14"
          font-weight="${isMonthStart || isWeekend ? 800 : 700}"
          font-family="Manrope, system-ui, sans-serif"
        >${escapeHtml(formatCalendarLabel(row))}</text>
      `
      : "";

    const showMarkerCaps = isMonthStart || showLabel;
    const weekendCaps = showMarkerCaps
      ? `
        <rect x="${x + 0.5}" y="${labelTop - 16}" width="${Math.max(2, width - 0.5)}" height="9" fill="${markerColor}" />
        <rect x="${x + 0.5}" y="${chartBottom + 12}" width="${Math.max(2, width - 0.5)}" height="9" fill="${markerColor}" />
      `
      : "";

    const sundownShade = sunsetHour < CALENDAR_END_HOUR
      ? `
        <rect
          x="${x}"
          y="${labelTop}"
          width="${width}"
          height="${timeToY(sunsetHour, chartHeight)}"
          fill="${CALENDAR_COLORS.sundown}"
        />
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

        const inset = isWeekend ? Math.max(0.6, width * 0.2) : 0.2;
        const highlightWidth = isWeekend ? Math.max(1.2, width * 0.6) : Math.max(1.8, width - 0.4);

        return `
          <rect
            x="${x + inset}"
            y="${y + 1}"
            width="${highlightWidth}"
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
        <rect x="${x}" y="${labelTop}" width="${width}" height="${middayY - labelTop}" fill="${CALENDAR_COLORS.afternoon}" />
        <rect x="${x}" y="${middayY}" width="${width}" height="${chartBottom - middayY}" fill="${CALENDAR_COLORS.morning}" />
        ${sundownShade}
        <rect
          x="${x + width / 2 - (isWeekend ? 0.7 : 0.35)}"
          y="${labelTop}"
          width="${isWeekend ? 1.4 : 0.7}"
          height="${chartHeight}"
          fill="${isMonthStart ? CALENDAR_COLORS.monthStart : isWeekend ? "rgba(217, 111, 29, 0.56)" : "rgba(90, 100, 108, 0.16)"}"
        />
        ${highlights}
      </g>
    `;
  });

  const title = `${ENGINE_CONFIG.stationLabel} high tide calendar, ${CALENDAR_START_HOUR}am to ${CALENDAR_END_HOUR - 12}pm`;

  return {
    svg: `
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
    `,
    chartHeight,
    labelTop,
    totalHeight,
    hourHeight: chartHeight / (CALENDAR_END_HOUR - CALENDAR_START_HOUR),
    dayLayouts,
  };
}

function buildCalendarDayLayouts(rows, timeOptions) {
  let x = CALENDAR_LEFT_PAD;
  return rows.map((row) => {
    const isWeekend = WEEKEND_DAYS.has(row.day);
    const isMonthStart = row.date.slice(8, 10) === "01";
    const width = isWeekend ? CALENDAR_WEEKEND_WIDTH : CALENDAR_WEEKDAY_WIDTH;
    const sunsetHour = getSunsetHourForDate(row.date, timeOptions);
    const layout = { row, x, width, isWeekend, isMonthStart, sunsetHour };
    x += width + CALENDAR_COLUMN_GAP;
    return layout;
  });
}

function buildCalendarAxisMarkup(side) {
  const sideClass = side === "right" ? "calendar-axis-right" : "calendar-axis-left";
  const labels = [];
  for (let hour = CALENDAR_END_HOUR; hour >= CALENDAR_START_HOUR; hour -= 1) {
    labels.push(
      `<div class="calendar-axis-label"><span>${escapeHtml(formatAxisLabel(hour))}</span></div>`
    );
  }
  return `<div class="${sideClass}">${labels.join("")}</div>`;
}

function maybeScrollCalendarToToday(rows) {
  const today = getTodayDateKey({
    timezoneMode: state.timezoneMode,
    timeZone: ENGINE_CONFIG.timezone,
  });
  const requestedAnchor = state.pendingScrollDate;
  const targetDate = rows.some((row) => row.date === requestedAnchor)
    ? requestedAnchor
    : rows.some((row) => row.date === today)
      ? today
      : rows[0]?.date || "";
  const targetIndex = rows.findIndex((row) => row.date === targetDate);
  const rowAnchor = targetDate;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const scrollKey = `${rows[0]?.date || ""}|${lastRow?.date || ""}|${rows.length}|${rowAnchor}|${state.timezoneMode}`;

  if (state.calendarScrollKey === scrollKey) {
    return;
  }

  state.calendarScrollKey = scrollKey;

  requestAnimationFrame(() => {
    const targetLeft = Math.max(
      0,
      (state.calendarDayLayouts[targetIndex >= 0 ? targetIndex : 0]?.x || CALENDAR_LEFT_PAD) - CALENDAR_LEFT_PAD - 8
    );
    elements.calendarWrap.scrollLeft = targetLeft;
    state.pendingScrollDate = "";
    syncCalendarScrollUi();
  });
}

function updateCalendarRangeBounds() {
  const max = Math.max(0, Math.round(elements.calendarWrap.scrollWidth - elements.calendarWrap.clientWidth));
  elements.calendarRangeTop.max = String(max);
  elements.calendarRangeBottom.max = String(max);
  elements.calendarRangeTop.disabled = max === 0;
  elements.calendarRangeBottom.disabled = max === 0;
}

function handleCalendarRangeInput(event) {
  const next = Number(event.target.value) || 0;
  state.calendarScrollSyncing = true;
  elements.calendarWrap.scrollLeft = next;
  elements.calendarRangeTop.value = String(next);
  elements.calendarRangeBottom.value = String(next);
  state.calendarScrollSyncing = false;
}

function syncCalendarScrollUi() {
  if (state.calendarScrollSyncing) {
    return;
  }
  const left = Math.round(elements.calendarWrap.scrollLeft);
  elements.calendarRangeTop.value = String(left);
  elements.calendarRangeBottom.value = String(left);
  updateCalendarLeadDate();
}

function pickCalendarLabelIndices(rows) {
  const picked = new Set();
  let lastPicked = -99;
  const minimumGap = 3;
  let forceNextSaturday = false;

  rows.forEach((row, index) => {
    const isEdge = index === 0 || index === rows.length - 1;
    const isMonthStart = row.date.slice(8, 10) === "01";
    const isSaturday = row.day === "Sat";
    if (isMonthStart) {
      picked.add(index);
      lastPicked = index;
      forceNextSaturday = !isSaturday;
      return;
    }

    if (isEdge) {
      picked.add(index);
      lastPicked = index;
      return;
    }

    if (isSaturday) {
      if (forceNextSaturday) {
        picked.add(index);
        lastPicked = index;
        forceNextSaturday = false;
        return;
      }
      if (index - lastPicked >= minimumGap) {
        picked.add(index);
        lastPicked = index;
      }
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

function handleJumpDate() {
  const targetDate = elements.jumpDateInput.value;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return;
  }

  const targetYear = Number(targetDate.slice(0, 4));
  const fullYearStart = `${targetYear}-01-01`;
  const fullYearEnd = `${targetYear}-12-31`;

  state.pendingScrollDate = targetDate;
  state.calendarScrollKey = "";

  if (Number(elements.yearInput.value) !== targetYear) {
    elements.yearInput.value = String(targetYear);
    elements.monthFilter.value = "all";
    elements.searchInput.value = "";
    syncDateInputsForYear(targetYear);
    elements.jumpDateInput.value = targetDate;
    elements.startDate.value = fullYearStart;
    elements.endDate.value = fullYearEnd;
    generateTable({ forceRefresh: false });
    return;
  }

  let needsRefilter = false;

  if (elements.monthFilter.value !== "all") {
    elements.monthFilter.value = "all";
    state.month = "all";
    needsRefilter = true;
  }

  if (elements.searchInput.value) {
    elements.searchInput.value = "";
    state.search = "";
    needsRefilter = true;
  }

  if (elements.startDate.value > targetDate || elements.endDate.value < targetDate) {
    elements.startDate.value = fullYearStart;
    elements.endDate.value = fullYearEnd;
    state.startDate = fullYearStart;
    state.endDate = fullYearEnd;
    needsRefilter = true;
  }

  if (needsRefilter) {
    applyFiltersAndRender();
    return;
  }

  maybeScrollCalendarToToday(state.calendarRows);
}

function handleTodayJump() {
  elements.jumpDateInput.value = getTodayDateKey({
    timezoneMode: "local",
    timeZone: ENGINE_CONFIG.timezone,
  });
  handleJumpDate();
}

function handleWindowResize() {
  if (state.resizeFrame) {
    cancelAnimationFrame(state.resizeFrame);
  }

  state.resizeFrame = requestAnimationFrame(() => {
    state.resizeFrame = 0;
    if (state.calendarRows.length > 0) {
      renderCalendar();
    }
  });
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
  const today = getTodayDateKey({
    timezoneMode: "local",
    timeZone: ENGINE_CONFIG.timezone,
  });
  const start = year === Number(today.slice(0, 4)) ? today : `${year}-01-01`;
  const end = `${year}-12-31`;
  elements.startDate.value = start;
  elements.endDate.value = end;
  elements.jumpDateInput.value = start;
  state.startDate = start;
  state.endDate = end;
}

function getCalendarMetrics() {
  const isPhone = window.matchMedia("(max-width: 760px)").matches;
  return {
    chartHeight: isPhone ? 435 : CALENDAR_CHART_HEIGHT,
    labelTop: isPhone ? 142 : CALENDAR_LABEL_TOP,
    bottomPad: isPhone ? 36 : CALENDAR_BOTTOM_PAD,
  };
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

function updateCalendarLeadDate() {
  if (state.calendarDayLayouts.length === 0) {
    setCalendarLeadDate("");
    return;
  }

  const visibleX = elements.calendarWrap.scrollLeft + CALENDAR_LEFT_PAD;
  const leadLayout =
    state.calendarDayLayouts.find((layout) => layout.x + layout.width >= visibleX) ||
    state.calendarDayLayouts[state.calendarDayLayouts.length - 1];

  setCalendarLeadDate(formatLongDate(leadLayout.row));
}

function getSunsetHourForDate(dateKey, options) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const dayOfYear = getDayOfYearUtc(date);
  const lngHour = STATION_COORDS.lon / 15;
  const t = dayOfYear + ((18 - lngHour) / 24);
  const m = (0.9856 * t) - 3.289;
  const l = normalizeDegrees(
    m
      + (1.916 * Math.sin(toRadians(m)))
      + (0.020 * Math.sin(toRadians(2 * m)))
      + 282.634
  );
  let ra = normalizeDegrees(toDegrees(Math.atan(0.91764 * Math.tan(toRadians(l)))));
  const lQuadrant = Math.floor(l / 90) * 90;
  const raQuadrant = Math.floor(ra / 90) * 90;
  ra = (ra + (lQuadrant - raQuadrant)) / 15;

  const sinDec = 0.39782 * Math.sin(toRadians(l));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosH =
    (Math.cos(toRadians(90.833)) - (sinDec * Math.sin(toRadians(STATION_COORDS.lat)))) /
    (cosDec * Math.cos(toRadians(STATION_COORDS.lat)));

  if (cosH >= 1 || cosH <= -1) {
    return CALENDAR_END_HOUR;
  }

  const h = toDegrees(Math.acos(cosH)) / 15;
  const localMeanTime = h + ra - (0.06571 * t) - 6.622;
  const utcHours = normalizeHours(localMeanTime - lngHour);
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) + utcHours * 3600000);
  return getHourValueFromDate(utcDate, options);
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

function formatLongDate(row) {
  const day = String(Number(row.date.slice(8, 10)));
  const month = MONTHS[Number(row.date.slice(5, 7)) - 1].slice(0, 3);
  const year = row.date.slice(0, 4);
  return `${row.day} ${day} ${month} ${year}`;
}

function setCalendarLeadDate(text) {
  elements.calendarLeadDateTop.textContent = text;
  elements.calendarLeadDateBottom.textContent = text;
}

function getHourValueFromDate(date, options) {
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

function getDayOfYearUtc(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((current - start) / 86400000);
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toDegrees(value) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function normalizeHours(value) {
  return ((value % 24) + 24) % 24;
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
