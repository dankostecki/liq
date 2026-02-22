/**
 * US LIQUIDITY MONITOR — APP
 * Clean dashboard + modal settings + chart builder with tooltip
 */

const AppState = {
    tab: 'dashboard',
    range: 'ALL',
    seriesList: [],
    seriesMap: {},
    dataMap: {},
    loaded: false,
    sidebarCollapsed: false,
    miniChartVisibility: {},  // id → bool
    seriesOrder: [],          // ordered ids for dashboard
};

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadData();
});

async function loadData() {
    setLoading(true);
    try {
        const r = await LiquidityData.loadAllData(AppState.range);
        AppState.seriesList = r.seriesList;
        AppState.seriesMap = r.seriesMap;
        AppState.dataMap = r.data;
        AppState.loaded = true;

        // Init order & visibility — preferred default order
        // Force refresh order if it doesn't match the new uppercase style
        if (AppState.seriesOrder.length === 0 || AppState.seriesOrder.some(id => id !== id.toUpperCase())) {
            const PREFERRED_ORDER = [
                'WRESBAL_MLN_USD',
                'TGA_MLN_USD',
                'IMPLIED_WRESBAL',
                'SOFRVOL',
                'TOTAL_IMPLIED_LIQ',
                'BITCOIN',
                'WRESBAL/ASSETS',
                'BANK_ASSETS',
                // Rates & Spreads (bar section)
                'ONRRP',
                'SOFR',
                'SPREAD',
                'SRF',
            ];
            const knownIds = new Set(r.seriesList.map(s => s.id));
            const ordered = PREFERRED_ORDER.filter(id => knownIds.has(id));
            // Append any series not in preferred list
            r.seriesList.forEach(s => { if (!ordered.includes(s.id)) ordered.push(s.id); });
            AppState.seriesOrder = ordered;
            r.seriesList.forEach(s => { AppState.miniChartVisibility[s.id] = true; });
        }

        // Init builder state
        if (LiquidityCharts.builderSeriesState.length === 0 && r.seriesList.length > 0) {
            const wresbal = r.seriesList.find(s => s.id === 'WRESBAL_MLN_USD');
            const bitcoin = r.seriesList.find(s => s.id === 'BITCOIN');

            if (wresbal && bitcoin) {
                LiquidityCharts.builderSeriesState = [
                    { id: wresbal.id, axis: 'left', invertAxis: false, type: 'area', color: wresbal.color },
                    { id: bitcoin.id, axis: 'right', invertAxis: false, type: 'line', color: bitcoin.color },
                ];
            } else {
                LiquidityCharts.builderSeriesState = r.seriesList.slice(0, 2).map((s, i) => ({
                    id: s.id, axis: i === 0 ? 'left' : 'right',
                    invertAxis: false, type: 'line', color: s.color,
                }));
            }
        }

        renderAll();
        setStatus('ok');
    } catch (err) {
        console.error('[App]', err);
        setStatus('error', err.message);
        showError(err.message);
    } finally {
        setLoading(false);
    }
}

function getOrderedSeries() {
    return AppState.seriesOrder
        .map(id => AppState.seriesMap[id])
        .filter(Boolean);
}

function getVisibleSeries() {
    return getOrderedSeries().filter(s => AppState.miniChartVisibility[s.id] !== false);
}

function renderAll() {
    renderMetricCards();
    renderMiniCharts();
    renderOverviewChart();
    if (AppState.tab === 'builder') renderBuilderTab();
    if (AppState.tab === 'data') renderDataTable();
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
function setLoading(on) {
    document.getElementById('loading-overlay')?.classList.toggle('hidden', !on);
    document.getElementById('refresh-btn')?.classList.toggle('spinning', on);
}

function setStatus(state, msg) {
    const dot = document.getElementById('status-dot');
    const txt = document.getElementById('status-text');
    const sub = document.getElementById('last-updated');
    if (dot) dot.className = 'status-dot' + (state === 'error' ? ' error' : '');
    if (txt) txt.textContent = state === 'ok' ? 'Connected' : 'Error';
    if (sub) sub.textContent = state === 'ok' ? 'Updated ' + new Date().toLocaleTimeString() : (msg || '');
}

function showError(msg) {
    const g = document.getElementById('metrics-grid');
    if (g) g.innerHTML = `<div style="grid-column:1/-1;padding:24px;background:#1a0f0f;border:1px solid rgba(239,68,68,0.3);border-radius:12px;color:#f87171;font-size:13px"><div style="font-weight:700;margin-bottom:8px">Failed to load data</div><div style="color:#9c9891;font-size:12px">${msg}</div></div>`;
}

// ─── METRIC CARDS ─────────────────────────────────────────────────────────────
function renderMetricCards() {
    const g = document.getElementById('metrics-grid');
    if (!g) return;
    g.innerHTML = '';

    getVisibleSeries().forEach(cfg => {
        const data = AppState.dataMap[cfg.id] || [];
        const latest = LiquidityData.getLatest(data);
        const chg = LiquidityData.getChange(data);
        const pct = Math.abs(chg.pct).toFixed(2);
        const cls = Math.abs(chg.pct) < 0.001 ? 'neutral' : chg.pct >= 0 ? 'positive' : 'negative';
        const arrow = cls === 'positive' ? '▲' : cls === 'negative' ? '▼' : '';

        const card = document.createElement('div');
        card.className = 'metric-card';
        card.style.setProperty('--card-color', cfg.color);
        card.innerHTML = `
            <div class="card-header">
                <div class="card-label">${cfg.label}</div>
                <div class="card-unit" style="color:${cfg.color}">${cfg.unit}</div>
            </div>
            <div class="card-value">${latest ? LiquidityData.formatValue(latest.value, cfg.unit) : '—'}</div>
            <div class="card-change ${cls}">${arrow} ${pct}% <span class="card-sub">vs prev</span></div>
        `;
        g.appendChild(card);
    });
}

// ─── MINI CHARTS (clean, click to expand) ────────────────────────────────────
function renderMiniCharts() {
    const grid = document.getElementById('mini-charts-grid');
    if (!grid) return;

    LiquidityCharts.destroyAllMiniCharts();
    grid.innerHTML = '';

    const visible = getVisibleSeries();

    visible.forEach(cfg => {
        const data = AppState.dataMap[cfg.id] || [];
        const latest = LiquidityData.getLatest(data);
        const ch = LiquidityData.getChangePeriod(data);
        const chCls = ch.pct >= 0 ? 'text-green' : 'text-red';
        const chSign = ch.pct >= 0 ? '+' : '';
        const chartId = 'mini-' + cfg.id;
        const seriesType = cfg.type || 'area';
        const card = document.createElement('div');
        card.className = 'mini-chart-card';
        card.style.cursor = 'pointer';
        card.title = 'Click to expand';
        card.innerHTML = `
            <div class="mini-chart-header">
                <span class="mini-chart-title">${cfg.label}</span>
                <span class="mini-chart-value" style="color:${cfg.color}">
                    ${latest ? LiquidityData.formatValue(latest.value, cfg.unit) : '—'}
                </span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
                <span style="font-size:10px;color:#5c5852">${cfg.unit}</span>
                <span class="${chCls}" style="font-size:11px;font-weight:600">${chSign}${ch.pct.toFixed(1)}%</span>
            </div>
            <div class="mini-chart-container" id="${chartId}"></div>
        `;

        card.addEventListener('click', () => expandMiniChart(cfg));

        grid.appendChild(card);

        if (data.length > 0) {
            setTimeout(() => LiquidityCharts.initMiniChart(chartId, cfg.color, data, seriesType), 0);
        }
    });
}

function expandMiniChart(cfg) {
    const data = AppState.dataMap[cfg.id] || [];
    if (!data.length) return;

    const popup = document.getElementById('mini-popup');
    const titleEl = document.getElementById('mini-popup-title');
    const unitEl = document.getElementById('mini-popup-unit');
    if (!popup) return;

    if (titleEl) titleEl.textContent = cfg.label;
    if (unitEl) unitEl.textContent = cfg.unit;
    popup.classList.remove('hidden');

    const seriesType = cfg.type || 'area';
    setTimeout(() => LiquidityCharts.initPopupChart(cfg, data, seriesType), 50);
}

function closeMiniPopup() {
    const popup = document.getElementById('mini-popup');
    if (popup) popup.classList.add('hidden');
    LiquidityCharts.destroyPopupChart();
}


// ─── DASHBOARD SETTINGS MODAL ────────────────────────────────────────────────
function openDashboardSettings() {
    const modal = document.getElementById('dashboard-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    renderDashboardOrderList();
}

function closeDashboardSettings() {
    document.getElementById('dashboard-modal')?.classList.add('hidden');
}

function renderDashboardOrderList() {
    const list = document.getElementById('dashboard-order-list');
    if (!list) return;
    list.innerHTML = '';

    AppState.seriesOrder.forEach((id, idx) => {
        const cfg = AppState.seriesMap[id];
        if (!cfg) return;
        const visible = AppState.miniChartVisibility[id] !== false;

        const item = document.createElement('div');
        item.className = 'modal-list-item';
        item.setAttribute('draggable', 'true');
        item.dataset.idx = idx;

        item.innerHTML = `
            <span class="item-drag">⠿</span>
            <div class="item-dot" style="background:${cfg.color}"></div>
            <span class="item-label">${cfg.label}</span>
            <span class="item-unit">${cfg.unit}</span>
            <input type="checkbox" class="modal-toggle" ${visible ? 'checked' : ''} data-id="${id}" />
        `;

        // Toggle
        item.querySelector('.modal-toggle').addEventListener('change', e => {
            e.stopPropagation();
            AppState.miniChartVisibility[id] = e.target.checked;
        });

        // Drag
        item.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', String(idx));
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('dragover', e => { e.preventDefault(); item.classList.add('drag-over'); });
        item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
        item.addEventListener('drop', e => {
            e.preventDefault();
            item.classList.remove('drag-over');
            const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
            const toIdx = idx;
            if (!isNaN(fromIdx) && fromIdx !== toIdx) {
                const [moved] = AppState.seriesOrder.splice(fromIdx, 1);
                AppState.seriesOrder.splice(toIdx, 0, moved);
                renderDashboardOrderList();
            }
        });

        list.appendChild(item);
    });
}

function applyDashboardSettings() {
    renderMetricCards();
    renderMiniCharts();
    closeDashboardSettings();
}

function resetDashboardOrder() {
    const PREFERRED_ORDER = [
        'WRESBAL_MLN_USD', 'TGA_MLN_USD', 'IMPLIED_WRESBAL', 'SOFRVOL',
        'TOTAL_IMPLIED_LIQ', 'BITCOIN', 'WRESBAL/ASSETS', 'BANK_ASSETS',
        'ONRRP', 'SOFR', 'SPREAD', 'SRF',
    ];
    const knownIds = new Set(AppState.seriesList.map(s => s.id));
    const ordered = PREFERRED_ORDER.filter(id => knownIds.has(id));
    AppState.seriesList.forEach(s => { if (!ordered.includes(s.id)) ordered.push(s.id); });
    AppState.seriesOrder = ordered;
    AppState.seriesList.forEach(s => { AppState.miniChartVisibility[s.id] = true; });
    renderDashboardOrderList();
}

// ─── OVERVIEW CHART ───────────────────────────────────────────────────────────
function renderOverviewChart() {
    const liqSeries = AppState.seriesList.find(s => s.label.toLowerCase().includes('total implied'));
    const btcSeries = AppState.seriesList.find(s => s.label.toLowerCase().includes('bitcoin'));
    const toShow = [liqSeries, btcSeries].filter(Boolean);
    if (toShow.length < 2) toShow.push(...AppState.seriesList.slice(0, 2 - toShow.length));

    const titleEl = document.querySelector('.overview-section .section-header h2');
    if (titleEl && toShow.length >= 2) titleEl.textContent = toShow[0].label + ' vs ' + toShow[1].label;

    LiquidityCharts.initOverviewChart(toShow, AppState.dataMap);
}

// ─── BUILDER TAB ──────────────────────────────────────────────────────────────
function renderBuilderTab() {
    LiquidityCharts.initBuilderChart(AppState.seriesMap, AppState.dataMap);
    renderBuilderSeriesList();
}

function renderBuilderSeriesList() {
    const list = document.getElementById('series-list');
    if (!list) return;
    list.innerHTML = '';

    LiquidityCharts.builderSeriesState.forEach((s, idx) => {
        const cfg = AppState.seriesMap[s.id];
        if (!cfg) return;
        const item = document.createElement('div');
        const isSelected = LiquidityCharts.selectedBuilderSeriesId === s.id;
        item.className = 'series-item' + (isSelected ? ' selected' : '');
        item.style.flexDirection = 'column';
        item.style.alignItems = 'stretch';

        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px; width:100%; cursor:pointer;">
                <div class="series-dot" style="background:${s.color}"></div>
                <span class="series-name" style="flex:1">${cfg.label} <span style="font-size:10px;color:#5c5852;font-weight:400;margin-left:4px">(${cfg.unit})</span></span>
                <span class="series-axis-badge" style="font-size:9px">${s.axis.toUpperCase()}</span>
                <button class="series-remove" data-idx="${idx}" title="Remove">&times;</button>
            </div>
            ${isSelected ? `
            <div class="inline-config" style="margin-top:12px; padding-top:12px; border-top:1px dashed rgba(255,255,255,0.1); display:flex; flex-direction:column; gap:8px;">
                <div class="config-row">
                    <div class="config-label" style="font-size:11px">Axis</div>
                    <div class="config-toggles">
                        <button class="config-toggle ${s.axis === 'left' ? 'active' : ''}" data-axis="left">Left</button>
                        <button class="config-toggle ${s.axis === 'right' ? 'active' : ''}" data-axis="right">Right</button>
                    </div>
                </div>
                <div class="config-row">
                    <div class="config-label" style="font-size:11px">Type</div>
                    <div class="config-toggles">
                        <button class="config-toggle ${s.type === 'line' ? 'active' : ''}" data-stype="line">Line</button>
                        <button class="config-toggle ${s.type === 'area' ? 'active' : ''}" data-stype="area">Area</button>
                        <button class="config-toggle ${s.type === 'bar' ? 'active' : ''}" data-stype="bar">Bar</button>
                    </div>
                </div>
                <div class="config-row">
                    <div class="config-label" style="font-size:11px">Color</div>
                    <input type="color" class="inline-color" value="${s.color}" style="width:28px;height:24px;border:none;background:transparent;cursor:pointer;padding:0" />
                </div>
                <div class="config-row">
                    <div class="config-label" style="font-size:11px">Invert</div>
                    <label class="toggle-switch">
                        <input type="checkbox" class="inline-invert" ${s.invertAxis ? 'checked' : ''} />
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>
            ` : ''}
        `;

        item.addEventListener('click', e => {
            if (e.target.closest('.series-remove')) {
                const i = parseInt(e.target.closest('.series-remove').dataset.idx);
                const removed = LiquidityCharts.builderSeriesState[i];
                LiquidityCharts.builderSeriesState = LiquidityCharts.builderSeriesState.filter((_, j) => j !== i);
                if (LiquidityCharts.selectedBuilderSeriesId === removed.id) LiquidityCharts.selectedBuilderSeriesId = null;
                renderBuilderSeriesList();
                LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
                return;
            }
            if (e.target.closest('.config-toggle') || e.target.closest('.inline-color') || e.target.closest('label') || e.target.tagName === 'INPUT') {
                return; // let those inputs handle themselves below
            }

            LiquidityCharts.selectedBuilderSeriesId =
                LiquidityCharts.selectedBuilderSeriesId === s.id ? null : s.id;
            renderBuilderSeriesList();
        });

        if (isSelected) {
            item.querySelectorAll('[data-axis]').forEach(b => b.addEventListener('click', () => {
                s.axis = b.dataset.axis;
                LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
                renderBuilderSeriesList();
            }));
            item.querySelectorAll('[data-stype]').forEach(b => b.addEventListener('click', () => {
                s.type = b.dataset.stype;
                LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
                renderBuilderSeriesList();
            }));
            item.querySelector('.inline-color')?.addEventListener('input', e => {
                s.color = e.target.value;
                LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
                // Don't re-render list here or it interrupts drawing the color picker
            });
            item.querySelector('.inline-color')?.addEventListener('change', () => renderBuilderSeriesList());

            item.querySelector('.inline-invert')?.addEventListener('change', e => {
                s.invertAxis = e.target.checked;
                LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
            });
        }

        list.appendChild(item);
    });
}

// ─── SERIES ADD MODAL (Chart Builder popup) ──────────────────────────────────
function openSeriesAddModal() {
    const modal = document.getElementById('series-add-modal');
    if (!modal) return;
    modal.classList.remove('hidden');
    const search = document.getElementById('series-modal-search');
    if (search) { search.value = ''; search.focus(); }
    populateSeriesModal('');
}

function closeSeriesAddModal() {
    document.getElementById('series-add-modal')?.classList.add('hidden');
}

function populateSeriesModal(filter) {
    const list = document.getElementById('series-modal-list');
    if (!list) return;
    list.innerHTML = '';
    const currentIds = new Set(LiquidityCharts.builderSeriesState.map(s => s.id));
    const q = (filter || '').toLowerCase();

    AppState.seriesList.forEach(cfg => {
        if (q && !cfg.label.toLowerCase().includes(q) && !cfg.id.toLowerCase().includes(q)) return;
        const added = currentIds.has(cfg.id);
        const item = document.createElement('div');
        item.className = 'modal-list-item' + (added ? ' added' : '');
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px; flex:1; min-width:0;">
                <div class="item-dot" style="background:${cfg.color}"></div>
                <div style="display:flex; flex-direction:column; min-width:0;">
                    <span class="item-label">${cfg.label}</span>
                    <span class="item-unit">${cfg.unit}</span>
                </div>
            </div>
            ${added ? `<span class="item-unit" style="flex-shrink:0;">✓ Added</span>` : `
            <div class="item-actions" style="display:flex; gap:6px; flex-shrink:0">
                <button class="add-axis-btn" data-axis="left" style="font-size:10px; padding:4px 8px; border-radius:4px; border:1px solid #333; background:transparent; color:#9c9891; cursor:pointer;">+ Left</button>
                <button class="add-axis-btn" data-axis="right" style="font-size:10px; padding:4px 8px; border-radius:4px; border:1px solid #333; background:transparent; color:#9c9891; cursor:pointer;">+ Right</button>
            </div>
            `}
        `;

        if (!added) {
            item.querySelectorAll('.add-axis-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const axis = btn.dataset.axis;
                    LiquidityCharts.builderSeriesState = [
                        ...LiquidityCharts.builderSeriesState,
                        { id: cfg.id, axis: axis, invertAxis: false, type: 'line', color: cfg.color },
                    ];
                    renderBuilderSeriesList();
                    LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
                    populateSeriesModal(filter);
                });
            });
        }

        list.appendChild(item);
    });
}

// ─── DATA TABLE ───────────────────────────────────────────────────────────────
function renderDataTable(filter = '') {
    const wrapper = document.getElementById('table-wrapper');
    if (!wrapper || !AppState.seriesList.length) return;
    const dateMap = {};
    AppState.seriesList.forEach(cfg => {
        (AppState.dataMap[cfg.id] || []).forEach(d => {
            if (!dateMap[d.date]) dateMap[d.date] = {};
            dateMap[d.date][cfg.id] = d.value;
        });
    });
    let rows = Object.entries(dateMap).sort(([a], [b]) => b.localeCompare(a));
    if (filter) rows = rows.filter(([d]) => d.includes(filter));

    const t = document.createElement('table');
    t.innerHTML = `
        <thead><tr>
            <th>Date</th>
            ${AppState.seriesList.map(s => `<th title="${s.description}">${s.shortLabel}</th>`).join('')}
        </tr></thead>
        <tbody>${rows.slice(0, 500).map(([date, vals]) => `
            <tr><td>${date}</td>
            ${AppState.seriesList.map(s => {
        const v = vals[s.id];
        return `<td>${v !== undefined ? LiquidityData.formatValue(v, s.unit) : '—'}</td>`;
    }).join('')}</tr>
        `).join('')}</tbody>
    `;
    wrapper.innerHTML = '';
    wrapper.appendChild(t);
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function bindEvents() {
    // Nav
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;
        document.querySelectorAll('.nav-item').forEach(b => {
            b.classList.toggle('active', b.dataset.tab === targetTab);
        });
        switchTab(targetTab);
    }));

    // Sidebar
    document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
        AppState.sidebarCollapsed = !AppState.sidebarCollapsed;
        document.getElementById('sidebar')?.classList.toggle('collapsed', AppState.sidebarCollapsed);
    });

    // Range
    document.querySelectorAll('.range-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.range = btn.dataset.range;
        if (AppState.loaded) {
            AppState.seriesList.forEach(cfg => {
                AppState.dataMap[cfg.id] = LiquidityData.filterByRange(cfg.data, AppState.range);
            });
            renderAll();
        }
    }));

    // Refresh
    document.getElementById('refresh-btn')?.addEventListener('click', () => {
        LiquidityData.invalidateCache();
        loadData();
    });

    // Overview pills
    document.querySelectorAll('.pill[data-chart="main"]').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.pill[data-chart="main"]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const liq = AppState.seriesList.find(s => s.label.toLowerCase().includes('total implied'));
        const btc = AppState.seriesList.find(s => s.label.toLowerCase().includes('bitcoin'));
        const toShow = [liq, btc].filter(Boolean);
        if (toShow.length < 2) toShow.push(...AppState.seriesList.slice(0, 2 - toShow.length));
        LiquidityCharts.updateOverviewChartType(btn.dataset.type, toShow, AppState.dataMap);
    }));

    // Builder type btns
    document.querySelectorAll('.chart-type-btn').forEach(btn => btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        LiquidityCharts.currentBuilderType = btn.dataset.type;
        LiquidityCharts.builderSeriesState = LiquidityCharts.builderSeriesState.map(s => ({ ...s, type: btn.dataset.type }));
        LiquidityCharts.redrawBuilderChart(AppState.seriesMap, AppState.dataMap);
    }));

    // Maximize
    document.getElementById('maximize-chart')?.addEventListener('click', () => {
        document.getElementById('chart-overlay')?.classList.remove('hidden');
        setTimeout(() => LiquidityCharts.initOverlayChart(AppState.seriesMap, AppState.dataMap), 50);
    });
    document.getElementById('overlay-close')?.addEventListener('click', () => {
        document.getElementById('chart-overlay')?.classList.add('hidden');
    });

    // Settings drawer
    document.getElementById('open-settings')?.addEventListener('click', () => {
        const d = document.getElementById('settings-drawer');
        d?.classList.toggle('open');
    });
    document.getElementById('close-drawer')?.addEventListener('click', () => {
        document.getElementById('settings-drawer')?.classList.remove('open');
    });

    // Add series button → open modal popup
    document.getElementById('add-series-btn')?.addEventListener('click', () => openSeriesAddModal());

    // Series add modal
    document.getElementById('series-modal-close')?.addEventListener('click', closeSeriesAddModal);
    document.getElementById('series-modal-search')?.addEventListener('input', e => populateSeriesModal(e.target.value));

    // Dashboard settings
    document.getElementById('dashboard-settings-btn')?.addEventListener('click', openDashboardSettings);
    document.getElementById('dashboard-modal-close')?.addEventListener('click', closeDashboardSettings);
    document.getElementById('dashboard-save-btn')?.addEventListener('click', applyDashboardSettings);
    document.getElementById('dashboard-reset-btn')?.addEventListener('click', resetDashboardOrder);

    // Mini-chart popup
    document.getElementById('mini-popup-close')?.addEventListener('click', closeMiniPopup);

    // Table
    document.getElementById('table-search')?.addEventListener('input', e => renderDataTable(e.target.value));
    document.getElementById('export-csv')?.addEventListener('click', exportCSV);

    // ESC closes modals
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.getElementById('chart-overlay')?.classList.add('hidden');
            document.getElementById('settings-drawer')?.classList.remove('open');
            closeDashboardSettings();
            closeSeriesAddModal();
            closeMiniPopup();
        }
    });

    // Click backdrop to close modals
    ['dashboard-modal', 'series-add-modal', 'mini-popup'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', e => {
            if (e.target.id === id) {
                if (id === 'mini-popup') { closeMiniPopup(); }
                else { document.getElementById(id)?.classList.add('hidden'); }
            }
        });
    });
}

function switchTab(tab) {
    AppState.tab = tab;
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.getElementById('tab-' + tab)?.classList.add('active');
    const titles = { dashboard: 'Dashboard', builder: 'Chart Builder', data: 'Data Table' };
    document.getElementById('page-title').textContent = titles[tab] || tab;

    if (tab === 'builder') {
        const drawer = document.getElementById('settings-drawer');
        if (drawer && !drawer.classList.contains('open')) drawer.classList.add('open');
        if (AppState.loaded) setTimeout(() => renderBuilderTab(), 50);
    }
    if (tab === 'data' && AppState.loaded) renderDataTable();
}

function exportCSV() {
    if (!AppState.seriesList.length) return;
    const dateMap = {};
    AppState.seriesList.forEach(cfg => {
        (AppState.dataMap[cfg.id] || []).forEach(d => {
            if (!dateMap[d.date]) dateMap[d.date] = {};
            dateMap[d.date][cfg.id] = d.value;
        });
    });
    const hdr = ['Date', ...AppState.seriesList.map(s => s.label)];
    const rows = Object.entries(dateMap).sort(([a], [b]) => a.localeCompare(b))
        .map(([date, v]) => [date, ...AppState.seriesList.map(s => v[s.id] !== undefined ? v[s.id] : '')]);
    const csv = [hdr, ...rows].map(r => r.join(',')).join('\n');
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
        download: 'us-liquidity-' + new Date().toISOString().split('T')[0] + '.csv',
    });
    a.click();
}
