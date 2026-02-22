/**
 * US LIQUIDITY MONITOR — DATA MODULE
 * Single source: GitHub JSON
 */

const DATA_URL = 'https://raw.githubusercontent.com/dankostecki/liq/main/plynnosc_full_btc.json';

// ─── SERIES META ──────────────────────────────────────────────────────────────
// Mapowanie kluczy z JSON na format oczekiwany przez dashboard (app.js)
const FIELD_MAPPING = {
    'wresbal_oficjalny': { id: 'WRESBAL_MLN_USD', label: 'WRESBAL', unit: 'M USD', color: '#3b82f6' },
    'tga': { id: 'TGA_MLN_USD', label: 'TGA', unit: 'M USD', color: '#22c55e' },
    'wresbal_implikowany': { id: 'IMPLIED_WRESBAL', label: 'Implied WRESBAL', unit: 'M USD', color: '#ef4444' },
    'sofr_vol': { id: 'SOFRVOL', label: 'SOFR Volume', unit: 'M USD', color: '#a78bfa' },
    'total_liquidity': { id: 'TOTAL_IMPLIED_LIQ', label: 'Total Implied Liq', unit: 'M USD', color: '#38bdf8' },
    'btc_usd': { id: 'BITCOIN', label: 'Bitcoin', unit: 'USD', color: '#f59e0b' },
    'sofr_rate': { id: 'SOFR', label: 'SOFR', unit: '%', color: '#f97316' },
    'on_rrp': { id: 'ONRRP', label: 'ONRRP', unit: '%', color: '#ec4899' },
    'spread': { id: 'SPREAD', label: 'Spread (SOFR-RRP)', unit: '%', color: '#c084fc' },
    'total_assets': { id: 'BANK_ASSETS', label: 'Bank Assets', unit: 'M USD', color: '#6ee7b7' },
    'wresbal_to_assets_ratio': { id: 'WRESBAL_ASSETS', label: 'WRESBAL / Assets', unit: '%', color: '#67e8f9' },
    'srf': { id: 'SRF', label: 'SRF', unit: 'M USD', color: '#f472b6' }
};

// ─── CACHE ────────────────────────────────────────────────────────────────────
let _rawJSON = null;
let _parsedData = null;
let _lastFetch = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minut wewnętrznego buforowania

// ─── JSON FETCH ───────────────────────────────────────────────────────────────
async function fetchJSON() {
    if (_rawJSON && _lastFetch && Date.now() - _lastFetch < CACHE_TTL_MS) return _rawJSON;
    try {
        // Parametr ?t= na końcu URL wymusza na przeglądarce pominięcie cache i pobranie świeżego pliku
        const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        _rawJSON = data;
        _lastFetch = Date.now();
        console.log('[Data] Pomyślnie załadowano bazę JSON z GitHuba');
        return data;
    } catch (e) {
        throw new Error('Błąd połączenia z serwerem danych: ' + e.message);
    }
}

// ─── BUILD SERIES ─────────────────────────────────────────────────────────────
function buildSeriesMapFromJSON(jsonData) {
    const seriesMap = {};
    const seriesList = [];
    
    const keys = Object.keys(FIELD_MAPPING);

    keys.forEach(key => {
        const meta = FIELD_MAPPING[key];
        const points = [];

        jsonData.forEach(row => {
            const dateStr = row['data'];
            const val = row[key];

            // Pomijamy puste wartości
            if (dateStr && val !== null && val !== undefined && val !== "") {
                const dateObj = new Date(dateStr);
                points.push({ 
                    time: Math.floor(dateObj.getTime() / 1000), 
                    value: parseFloat(val), 
                    date: dateStr 
                });
            }
        });

        // Sortowanie chronologiczne
        points.sort((a, b) => a.time - b.time);
        
        // Zabezpieczenie przed zduplikowanymi datami
        const unique = []; 
        const seen = new Set();
        for (const p of points) { 
            if (!seen.has(p.time)) { 
                seen.add(p.time); 
                unique.push(p); 
            } 
        }

        const isPct = meta.unit === '%';

        const cfg = {
            id: meta.id, 
            label: meta.label,
            shortLabel: meta.label.length > 14 ? meta.label.slice(0, 13) + '…' : meta.label,
            unit: meta.unit, 
            color: meta.color, 
            type: isPct ? 'line' : 'area',
            axis: isPct ? 'right' : 'left',
            invertAxis: false,
            description: meta.label,
            category: isPct ? 'Rates' : 'Liquidity',
            data: unique,
        };

        seriesMap[meta.id] = cfg;
        seriesList.push(cfg);
    });

    return { seriesMap, seriesList };
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
        const json = await fetchJSON();
        const { seriesMap, seriesList } = buildSeriesMapFromJSON(json);
        _parsedData = { seriesMap, seriesList };
        console.log('[Data] Zbudowano', seriesList.length, 'wykresów z danych JSON');
    }
    const { seriesMap, seriesList } = _parsedData;
    const data = {};
    for (const s of seriesList) data[s.id] = filterByRange(s.data, range);
    return { seriesMap, seriesList, data };
}

function invalidateCache() { _rawJSON = null; _parsedData = null; _lastFetch = null; }

window.LiquidityData = {
    DATA_URL, loadAllData, invalidateCache, filterByRange,
    formatValue, getLatest, getChange, getChangePeriod,
};
