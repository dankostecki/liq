/**
 * US LIQUIDITY MONITOR — CHARTS MODULE
 * Uses TradingView Lightweight Charts v4
 */

// ─── CHART THEME ──────────────────────────────────────────────────────────────
const CHART_THEME = {
    layout: {
        background: { color: '#09090b' },
        textColor: '#9c9891',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'Inter', monospace",
    },
    grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
    },
    crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { width: 1, color: 'rgba(201,169,110,0.4)', style: 3, labelBackgroundColor: '#1c1c20' },
        horzLine: { width: 1, color: 'rgba(201,169,110,0.25)', style: 3, labelBackgroundColor: '#1c1c20' },
    },
    rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#5c5852',
        scaleMargins: { top: 0.08, bottom: 0.08 },
    },
    leftPriceScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#5c5852',
        scaleMargins: { top: 0.08, bottom: 0.08 },
        visible: false,
    },
    timeScale: {
        borderColor: 'rgba(255,255,255,0.06)',
        textColor: '#5c5852',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
    },
    handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
};

const MINI_THEME = {
    layout: { background: { color: 'transparent' }, textColor: '#5c5852', fontSize: 9 },
    grid: { vertLines: { visible: false }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
    crosshair: { mode: LightweightCharts.CrosshairMode.Hidden },
    rightPriceScale: { visible: false },
    leftPriceScale: { visible: false },
    timeScale: { visible: false },
    handleScroll: false,
    handleScale: false,
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const chartInstances = { overview: null, builder: null, overlay: null, popup: null, mini: {} };
const seriesInstances = { overview: {}, builder: {}, overlay: {}, popup: {} };

let builderSeriesState = [];
let selectedBuilderSeriesId = null;
let currentBuilderType = 'line';

// ─── CREATE CHART ─────────────────────────────────────────────────────────────
function createChart(containerId, options = {}, mini = false) {
    const container = document.getElementById(containerId);
    if (!container) { console.warn('createChart: no container', containerId); return null; }

    // Get dimensions — use offsetWidth/offsetHeight as fallback
    const w = container.offsetWidth || container.clientWidth || 800;
    const h = container.offsetHeight || container.clientHeight || (mini ? 80 : 500);

    const chart = LightweightCharts.createChart(container, {
        ...(mini ? MINI_THEME : CHART_THEME),
        width: w,
        height: h,
        ...options,
    });

    // Auto-resize with ResizeObserver
    const ro = new ResizeObserver(entries => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (width > 0 && height > 0) {
                chart.applyOptions({ width, height });
                chart.timeScale().fitContent();
            }
        }
    });
    ro.observe(container);
    chart._ro = ro;

    return chart;
}

// ─── DESTROY CHART ────────────────────────────────────────────────────────────
function destroyChart(key) {
    const c = chartInstances[key];
    if (c) {
        try { if (c._ro) c._ro.disconnect(); } catch (_) { }
        try { c.remove(); } catch (_) { }
        chartInstances[key] = null;
        seriesInstances[key] = {};
    }
}

// ─── ADD SERIES ───────────────────────────────────────────────────────────────
function addSeries(chart, color, type, data, axis, inverted) {
    const priceScaleId = axis === 'left' ? 'left' : 'right';

    if (axis === 'left') {
        chart.applyOptions({
            leftPriceScale: {
                visible: true, invertScale: inverted || false,
                borderColor: 'rgba(255,255,255,0.06)', textColor: '#5c5852',
                scaleMargins: { top: 0.08, bottom: 0.08 },
            },
        });
    } else {
        chart.applyOptions({ rightPriceScale: { visible: true, invertScale: inverted || false } });
    }

    const base = { color, priceScaleId, lastValueVisible: true, priceLineVisible: false };
    let series;

    switch (type) {
        case 'area':
            series = chart.addAreaSeries({
                ...base,
                lineColor: color,
                topColor: hexToRgba(color, 0.2),
                bottomColor: hexToRgba(color, 0.01),
                lineWidth: 2,
            });
            break;
        case 'bar':
            series = chart.addHistogramSeries({ ...base, color: hexToRgba(color, 0.7) });
            break;
        case 'candlestick':
            series = chart.addCandlestickSeries({
                upColor: '#22c55e', downColor: '#ef4444',
                borderUpColor: '#22c55e', borderDownColor: '#ef4444',
                wickUpColor: '#22c55e', wickDownColor: '#ef4444',
                priceScaleId,
            });
            break;
        default:
            series = chart.addLineSeries({
                ...base, lineWidth: 2,
                crosshairMarkerVisible: true, crosshairMarkerRadius: 4,
                crosshairMarkerBorderColor: color, crosshairMarkerBackgroundColor: '#09090b',
            });
    }

    if (data && data.length > 0) {
        const sorted = [...data].sort((a, b) => a.time - b.time);
        const unique = [];
        const seen = new Set();
        for (const d of sorted) {
            if (seen.has(d.time)) continue;
            seen.add(d.time);
            if (type === 'candlestick') {
                unique.push({ time: d.time, open: d.value * 0.999, high: d.value * 1.004, low: d.value * 0.996, close: d.value });
            } else {
                unique.push({ time: d.time, value: d.value });
            }
        }
        try { series.setData(unique); } catch (e) { console.warn('setData error:', e); }
    }

    return series;
}

// ─── OVERVIEW CHART ───────────────────────────────────────────────────────────
function initOverviewChart(seriesList, dataMap) {
    destroyChart('overview');
    const chart = createChart('overview-chart', { height: 320 });
    if (!chart) return;
    chartInstances.overview = chart;
    seriesInstances.overview = {};

    const toShow = seriesList.slice(0, 2);
    toShow.forEach((cfg, i) => {
        const d = dataMap[cfg.id] || [];
        if (!d.length) return;
        const s = addSeries(chart, cfg.color, 'line', d, i === 0 ? 'right' : 'left', false);
        if (s) seriesInstances.overview[cfg.id] = s;
    });

    chart.timeScale().fitContent();
}

function updateOverviewChartType(type, seriesList, dataMap) {
    if (!chartInstances.overview) return;

    Object.values(seriesInstances.overview).forEach(s => { try { chartInstances.overview.removeSeries(s); } catch (_) { } });
    seriesInstances.overview = {};
    chartInstances.overview.applyOptions({
        leftPriceScale: { visible: false, invertScale: false },
        rightPriceScale: { visible: true, invertScale: false },
    });

    const toShow = seriesList.slice(0, 2);
    toShow.forEach((cfg, i) => {
        const d = dataMap[cfg.id] || [];
        if (!d.length) return;
        const s = addSeries(chartInstances.overview, cfg.color, type, d, i === 0 ? 'right' : 'left', false);
        if (s) seriesInstances.overview[cfg.id] = s;
    });
    chartInstances.overview.timeScale().fitContent();
}

// ─── MINI CHARTS ─────────────────────────────────────────────────────────────
function initMiniChart(containerId, color, data, seriesType = 'area') {
    const existing = chartInstances.mini[containerId];
    if (existing) { try { if (existing._ro) existing._ro.disconnect(); existing.remove(); } catch (_) { } }

    const chart = createChart(containerId, { height: 80 }, true);
    if (!chart || !data || !data.length) return;
    chartInstances.mini[containerId] = chart;
    addSeries(chart, color, seriesType, data, 'right', false);
    chart.timeScale().fitContent();
}

function destroyAllMiniCharts() {
    Object.entries(chartInstances.mini).forEach(([, c]) => {
        try { if (c._ro) c._ro.disconnect(); c.remove(); } catch (_) { }
    });
    chartInstances.mini = {};
}

// ─── BUILDER CHART ────────────────────────────────────────────────────────────
function initBuilderChart(seriesMap, dataMap) {
    destroyChart('builder');
    const chart = createChart('builder-chart', {});
    if (!chart) return;
    chartInstances.builder = chart;
    seriesInstances.builder = {};

    _drawBuilderSeries(chart, seriesMap, dataMap);
    _setupBuilderTooltip(chart, seriesMap);
    chart.timeScale().fitContent();
}

function redrawBuilderChart(seriesMap, dataMap) {
    if (!chartInstances.builder) {
        initBuilderChart(seriesMap, dataMap);
        return;
    }

    const chart = chartInstances.builder;

    Object.values(seriesInstances.builder).forEach(s => { try { chart.removeSeries(s); } catch (_) { } });
    seriesInstances.builder = {};

    chart.applyOptions({
        leftPriceScale: { visible: false, invertScale: false },
        rightPriceScale: { visible: true, invertScale: false },
    });

    _drawBuilderSeries(chart, seriesMap, dataMap);
    _setupBuilderTooltip(chart, seriesMap);
    chart.timeScale().fitContent();
}

function _drawBuilderSeries(chart, seriesMap, dataMap) {
    builderSeriesState.forEach(state => {
        const cfg = seriesMap[state.id];
        if (!cfg) return;
        const d = dataMap[state.id] || [];
        if (!d.length) return;

        const s = addSeries(chart, state.color, state.type || currentBuilderType, d, state.axis, state.invertAxis || false);
        if (s) seriesInstances.builder[state.id] = s;
    });
}

function _setupBuilderTooltip(chart, seriesMap) {
    // Get or create tooltip div
    const container = document.getElementById('builder-chart');
    if (!container) return;
    let tooltip = container.querySelector('.builder-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'builder-tooltip';
        container.appendChild(tooltip);
    }

    chart.subscribeCrosshairMove(param => {
        if (!param.time || !param.seriesData || param.seriesData.size === 0) {
            tooltip.style.display = 'none';
            return;
        }
        tooltip.style.display = 'flex';

        // Build date string
        const d = param.time;
        const dateStr = typeof d === 'object' ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` :
            new Date(d * 1000).toISOString().split('T')[0];

        let html = `<span style="color:#5c5852">${dateStr}</span>`;

        builderSeriesState.forEach(state => {
            const series = seriesInstances.builder[state.id];
            if (!series) return;
            const data = param.seriesData.get(series);
            if (!data) return;
            const val = data.value !== undefined ? data.value : data.close;
            if (val === undefined) return;
            const cfg = seriesMap[state.id];
            const formatted = cfg ? window.LiquidityData.formatValue(val, cfg.unit) : val.toFixed(2);
            html += `<span class="tooltip-item"><span class="tooltip-dot" style="background:${state.color}"></span>${cfg ? cfg.shortLabel : state.id}: <span class="tooltip-val">${formatted}</span></span>`;
        });

        tooltip.innerHTML = html;
    });
}


// ─── OVERLAY CHART ────────────────────────────────────────────────────────────
function initOverlayChart(seriesMap, dataMap) {
    destroyChart('overlay');
    const chart = createChart('overlay-chart', {});
    if (!chart) return;
    chartInstances.overlay = chart;
    seriesInstances.overlay = {};

    builderSeriesState.forEach(state => {
        const cfg = seriesMap[state.id];
        if (!cfg) return;
        const d = dataMap[state.id] || [];
        if (!d.length) return;
        const s = addSeries(chart, state.color, state.type || currentBuilderType, d, state.axis, state.invertAxis || false);
        if (s) seriesInstances.overlay[state.id] = s;
    });

    chart.timeScale().fitContent();
}

// ─── SINGLE SERIES OVERLAY (mini-chart expand) ──────────────────────────────
function initSingleOverlayChart(cfg, data) {
    destroyChart('overlay');
    const chart = createChart('overlay-chart', {});
    if (!chart || !data || !data.length) return;
    chartInstances.overlay = chart;
    seriesInstances.overlay = {};

    const s = addSeries(chart, cfg.color, 'area', data, 'right', false);
    if (s) seriesInstances.overlay[cfg.id] = s;

    // Tooltip
    const container = document.getElementById('overlay-chart');
    if (container) {
        let tooltip = container.querySelector('.builder-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'builder-tooltip';
            container.appendChild(tooltip);
        }
        chart.subscribeCrosshairMove(param => {
            if (!param.time || !param.seriesData || param.seriesData.size === 0) {
                tooltip.style.display = 'none';
                return;
            }
            tooltip.style.display = 'flex';
            const d = param.time;
            const dateStr = typeof d === 'object'
                ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
                : new Date(d * 1000).toISOString().split('T')[0];
            const seriesData = param.seriesData.get(s);
            const val = seriesData ? (seriesData.value !== undefined ? seriesData.value : seriesData.close) : null;
            const formatted = val !== null ? window.LiquidityData.formatValue(val, cfg.unit) : '—';
            tooltip.innerHTML = `<span style="color:#5c5852">${dateStr}</span>
                <span class="tooltip-item"><span class="tooltip-dot" style="background:${cfg.color}"></span>${cfg.label}: <span class="tooltip-val">${formatted}</span></span>`;
        });
    }

    chart.timeScale().fitContent();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
    if (!hex || !hex.startsWith('#')) return `rgba(99,102,241,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

// ─── POPUP CHART (mini-chart expanded in modal) ─────────────────────────────
function initPopupChart(cfg, data, seriesType = 'area') {
    destroyChart('popup');
    const chart = createChart('mini-popup-chart', {
        layout: { background: { color: '#131316' } },
    });
    if (!chart || !data || !data.length) return;
    chartInstances.popup = chart;
    seriesInstances.popup = {};

    const s = addSeries(chart, cfg.color, seriesType, data, 'right', false);
    if (s) seriesInstances.popup[cfg.id] = s;

    // Tooltip
    const container = document.getElementById('mini-popup-chart');
    if (container) {
        let tooltip = container.querySelector('.builder-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.className = 'builder-tooltip';
            container.appendChild(tooltip);
        }
        chart.subscribeCrosshairMove(param => {
            if (!param.time || !param.seriesData || param.seriesData.size === 0) {
                tooltip.style.display = 'none';
                return;
            }
            tooltip.style.display = 'flex';
            const d = param.time;
            const dateStr = typeof d === 'object'
                ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
                : new Date(d * 1000).toISOString().split('T')[0];
            const sd = param.seriesData.get(s);
            const val = sd ? (sd.value !== undefined ? sd.value : sd.close) : null;
            const formatted = val !== null ? window.LiquidityData.formatValue(val, cfg.unit) : '—';
            tooltip.innerHTML = `<span style="color:#5c5852">${dateStr}</span>
                <span class="tooltip-item"><span class="tooltip-dot" style="background:${cfg.color}"></span>${cfg.label}: <span class="tooltip-val">${formatted}</span></span>`;
        });
    }

    chart.timeScale().fitContent();
}

function destroyPopupChart() {
    destroyChart('popup');
}


// ─── PUBLIC API ───────────────────────────────────────────────────────────────
window.LiquidityCharts = {
    initOverviewChart,
    updateOverviewChartType,
    initMiniChart,
    destroyAllMiniCharts,
    initBuilderChart,
    redrawBuilderChart,
    initOverlayChart,
    initSingleOverlayChart,
    initPopupChart,
    destroyPopupChart,
    chartInstances,
    seriesInstances,
    get builderSeriesState() { return builderSeriesState; },
    set builderSeriesState(v) { builderSeriesState = v; },
    get selectedBuilderSeriesId() { return selectedBuilderSeriesId; },
    set selectedBuilderSeriesId(v) { selectedBuilderSeriesId = v; },
    get currentBuilderType() { return currentBuilderType; },
    set currentBuilderType(v) { currentBuilderType = v; },
};


