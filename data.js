/**
 * US LIQUIDITY MONITOR — DATA MODULE
 * Single source: Google Sheets CSV export
 */

const DATA_URL =
    'https://docs.google.com/spreadsheets/d/1BAy1HnHcuGPvkDkCxM4YH3hgb1u6cRmpT-onqj-u1Oc/export?format=csv';

const CORS_PROXIES = [
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url=',
];

// ─── SERIES META — known columns with explicit units & colors ─────────────────
const SERIES_META = {
    'wresbal (mln usd)': { unit: 'M USD', color: '#3b82f6', label: 'WRESBAL' },
    'tga (mln usd)': { unit: 'M USD', color: '#22c55e', label: 'TGA' },
    'implied wresbal': { unit: 'M USD', color: '#ef4444', label: 'Implied WRESBAL' },
    'sofrvol': { unit: 'M USD', color: '#a78bfa', label: 'SOFR Volume' },
    'total implied liq': { unit: 'M USD', color: '#38bdf8', label: 'Total Implied Liq' },
    'bitcoin': { unit: 'USD', color: '#f59e0b', label: 'Bitcoin' },
    'sofr': { unit: '%', color: '#f97316', label: 'SOFR' },
    'onrrp': { unit: '%', color: '#ec4899', label: 'ONRRP' },
    'spread': { unit: '%', color: '#c084fc', label: 'Spread (SOFR-RRP)' },
    'bank assets': { unit: 'M USD', color: '#6ee7b7', label: 'Bank Assets' },
    'wresbal/assets': { unit: '%', color: '#67e8f9', label: 'WRESBAL / Assets' },
    'srf': { unit: 'M USD', color: '#f472b6', label: 'SRF' },
};

const COLOR_PALETTE = [
    '#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#38bdf8',
    '#a78bfa', '#f97316', '#ec4899', '#6ee7b7', '#67e8f9',
    '#c084fc', '#fb923c', '#4ade80', '#fbbf24', '#34d399',
];

// ─── CACHE ────────────────────────────────────────────────────────────────────
let _rawCSV = null;
let _parsedData = null;
let _lastFetch = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ─── CSV FETCH ────────────────────────────────────────────────────────────────
async function fetchCSV() {
    if (_rawCSV && _lastFetch && Date.now() - _lastFetch < CACHE_TTL_MS) return _rawCSV;
    const urls = [DATA_URL, ...CORS_PROXIES.map(p => p + encodeURIComponent(DATA_URL))];
    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            if (!text || text.length < 20 || !text.includes(',')) throw new Error('Not CSV');
            _rawCSV = text; _lastFetch = Date.now();
            console.log('[Data] CSV loaded from', url.slice(0, 60));
            return text;
        } catch (e) { lastErr = e; }
    }
    throw new Error('All fetch attempts failed: ' + (lastErr?.message || ''));
}

// ─── CSV PARSER ───────────────────────────────────────────────────────────────
function parseLine(line) {
    const fields = []; let inQ = false, cur = '';
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
        else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = ''; }
        else cur += ch;
    }
    fields.push(cur.trim());
    return fields;
}

function parseCSV(text) {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    if (lines.length < 2) throw new Error('CSV too short');
    const headers = parseLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const f = parseLine(lines[i]);
        if (f.length < 2) continue;
        const row = {};
        headers.forEach((h, j) => { row[h] = f[j] !== undefined ? f[j] : ''; });
        rows.push(row);
    }
    return { headers, rows };
}

// ─── PARSE HELPERS ────────────────────────────────────────────────────────────
function detectDateCol(headers, row) {
    for (const h of headers) {
        const l = h.toLowerCase();
        if (['date', 'data', 'time', 'period', 'day', 'obserwacj'].some(k => l.includes(k))) return h;
    }
    for (const h of headers) if (row[h] && !isNaN(Date.parse(row[h]))) return h;
    return headers[0];
}

function parseDate(str) {
    if (!str) return null;
    str = str.trim();
    let d = new Date(str);
    if (!isNaN(d.getTime())) return d;
    const m1 = str.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (m1) { d = new Date(`${m1[3]}-${m1[2].padStart(2, '0')}-${m1[1].padStart(2, '0')}`); if (!isNaN(d.getTime())) return d; }
    return null;
}

function parseNumber(str) {
    if (!str) return null;
    const s = str.trim();
    if (s === '' || s === '-' || s === 'NA' || s === 'N/A' || s === '#N/A') return null;
    let cleaned = s.replace(/[$€£%\s]/g, '');
    if (/^\d+,\d{1,2}$/.test(cleaned)) {
        cleaned = cleaned.replace(',', '.');
    } else {
        cleaned = cleaned.replace(/,/g, '');
    }
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
}

// ─── BUILD SERIES ─────────────────────────────────────────────────────────────
function buildSeriesMap(headers, rows) {
    const dateCol = detectDateCol(headers, rows[0] || {});
    const valueCols = headers.filter(h => h !== dateCol && h.trim() !== '');
    const seriesMap = {};
    const seriesList = [];

    valueCols.forEach((col, idx) => {
        const key = col.trim().toLowerCase();
        const meta = SERIES_META[key] || {};
        const rawValues = rows.map(r => parseNumber(r[col]));
        const unit = meta.unit || autoDetectUnit(col, rawValues);
        const color = meta.color || COLOR_PALETTE[idx % COLOR_PALETTE.length];
        const label = meta.label || col.trim();

        const points = [];
        rows.forEach(r => {
            const dateObj = parseDate(r[dateCol]);
            const val = parseNumber(r[col]);
            if (dateObj && val !== null) {
                points.push({ time: Math.floor(dateObj.getTime() / 1000), value: val, date: dateObj.toISOString().split('T')[0] });
            }
        });

        points.sort((a, b) => a.time - b.time);
        const unique = []; const seen = new Set();
        for (const p of points) { if (!seen.has(p.time)) { seen.add(p.time); unique.push(p); } }

        const id = col.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-\/]/g, '').toUpperCase() || `S${idx}`;

        const cfg = {
            id, label,
            shortLabel: label.length > 14 ? label.slice(0, 13) + '…' : label,
            unit, color, type: meta.type || 'line',
            axis: unit === '%' ? 'right' : 'left',
            invertAxis: false,
            description: col.trim(),
            category: unit === '%' ? 'Rates' : 'Liquidity',
            data: unique,
        };

        seriesMap[id] = cfg;
        seriesList.push(cfg);
    });

    return { dateCol, seriesMap, seriesList };
}

function autoDetectUnit(header, values) {
    const l = header.toLowerCase();
    if (l.includes('%') || l.includes('rate') || l.includes('yield') || l.includes('spread')) return '%';
    if (l.includes('mln') || l.includes('million')) return 'M USD';
    if (l.includes('btc') || l.includes('bitcoin') || l.includes('price')) return 'USD';
    const nums = values.filter(v => v !== null);
    if (nums.length === 0) return '';
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    if (avg > 100000) return 'M USD';
    if (avg < 50) return '%';
    return 'USD';
}

// ─── RANGE FILTER ─────────────────────────────────────────────────────────────
function getStartTs(range) {
    const now = new Date();
    switch (range) {
        case '1M': return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate()).getTime() / 1000;
        case '3M': return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate()).getTime() / 1000;
        case '6M': return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate()).getTime() / 1000;
        case '1Y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).getTime() / 1000;
        case '2Y': return new Date(now.getFullYear() - 2, now.getMonth(), now.getDate()).getTime() / 1000;
        case 'ALL': return 0;
        default: return 0;
    }
}

function filterByRange(data, range) {
    if (!range || range === 'ALL') return data || [];
    const start = getStartTs(range);
    return (data || []).filter(d => d.time >= start);
}

// ─── FORMAT ───────────────────────────────────────────────────────────────────
function formatValue(value, unit) {
    if (value === null || value === undefined || isNaN(value)) return '—';
    if (unit === '%') return value.toFixed(2) + '%';
    if (unit === 'M USD') {
        if (Math.abs(value) >= 1000000) return '$' + (value / 1000000).toFixed(2) + 'T';
        if (Math.abs(value) >= 1000) return '$' + (value / 1000).toFixed(1) + 'B';
        return '$' + value.toFixed(0) + 'M';
    }
    if (unit === 'B USD') {
        if (Math.abs(value) >= 1000) return '$' + (value / 1000).toFixed(2) + 'T';
        return '$' + value.toFixed(1) + 'B';
    }
    if (unit === 'USD') return '$' + value.toLocaleString('en-US', { maximumFractionDigits: 0 });
    return value.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function getLatest(data) { return data && data.length ? data[data.length - 1] : null; }

function getChange(data) {
    if (!data || data.length < 2) return { value: 0, pct: 0 };
    const a = data[data.length - 1].value, b = data[data.length - 2].value;
    if (!b) return { value: 0, pct: 0 };
    return { value: a - b, pct: ((a - b) / Math.abs(b)) * 100 };
}

function getChangePeriod(data) {
    if (!data || data.length < 2) return { value: 0, pct: 0 };
    const a = data[data.length - 1].value, b = data[0].value;
    if (!b) return { value: 0, pct: 0 };
    return { value: a - b, pct: ((a - b) / Math.abs(b)) * 100 };
}

// ─── MAIN LOADER ──────────────────────────────────────────────────────────────
async function loadAllData(range = 'ALL') {
    if (!_parsedData) {
        const csv = await fetchCSV();
        const { headers, rows } = parseCSV(csv);
        const { dateCol, seriesMap, seriesList } = buildSeriesMap(headers, rows);
        _parsedData = { headers, rows, dateCol, seriesMap, seriesList };
        console.log('[Data] Parsed', seriesList.length, 'series,', rows.length, 'rows');
        console.log('[Data] Series:', seriesList.map(s => `${s.id}(${s.unit})`).join(', '));
    }
    const { seriesMap, seriesList } = _parsedData;
    const data = {};
    for (const s of seriesList) data[s.id] = filterByRange(s.data, range);
    return { seriesMap, seriesList, data };
}

function invalidateCache() { _rawCSV = null; _parsedData = null; _lastFetch = null; }

window.LiquidityData = {
    DATA_URL, loadAllData, invalidateCache, filterByRange,
    formatValue, getLatest, getChange, getChangePeriod,
};
