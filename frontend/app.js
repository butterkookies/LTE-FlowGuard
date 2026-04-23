// ═══════════════════════ DOM REFERENCES ═══════════════════════
const deviceTableBody = document.getElementById('device-table-body');
const totalUsageEl = document.getElementById('total-usage');
const activeDevicesEl = document.getElementById('active-devices');
const activeLeaksEl = document.getElementById('active-leaks');
const totalLossEl = document.getElementById('total-loss');
const deviceCountEl = document.getElementById('device-count');
const connectionStatus = document.getElementById('connection-status');
const toastContainer = document.getElementById('toast-container');

// Detail panel
const detailPanel = document.getElementById('detail-panel');
const detailOverlay = document.getElementById('detail-overlay');
const detailClose = document.getElementById('detail-close');
const detailDeviceName = document.getElementById('detail-device-name');
const detailFlow = document.getElementById('detail-flow');
const detailUsage = document.getElementById('detail-usage');
const detailStatus = document.getElementById('detail-status');
const detailLoss = document.getElementById('detail-loss');
const detailHistory = document.getElementById('detail-history');

// Leak card
const activeLeaksCard = document.getElementById('active-leaks-card');

// ═══════════════════════ STATE ═══════════════════════
const devices = {};
let socket = null;
let reconnectTimeout = null;
let currentDetailDevice = null;
let flowChart = null; // Chart.js instance (detail panel)
let mainChart = null; // Chart.js instance (main dashboard)
const mainChartHistory = {}; // { device_id: [{ time, flow_rate }] }
const MAX_MAIN_CHART_POINTS = 60;

// Render throttle — batch rapid WS updates into a single render pass
let renderTimer = null;
function scheduleRender() {
    if (!renderTimer) {
        renderTimer = setTimeout(() => {
            renderTimer = null;
            renderDashboard();
            renderMainChart();
        }, 200);
    }
}

// ── Event delegation for the device table (survives full row rebuilds) ──
deviceTableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (btn) {
        e.stopPropagation();
        sendCommand(btn.dataset.device, btn.dataset.action);
        return;
    }
    const row = e.target.closest('tr[data-device-id]');
    if (row) openDetailPanel(row.dataset.deviceId);
});
const DEVICE_COLORS = [
    '#3b82f6', '#22d3ee', '#a78bfa', '#f59e0b',
    '#22c55e', '#ec4899', '#f97316', '#14b8a6'
];

// Event type display config (used in Recent History)
const EVENT_CONFIG = {
    leak_detected: { icon: '🚨', cls: 'ev-danger',  label: 'Leak Detected' },
    leak_resolved: { icon: '✅', cls: 'ev-success', label: 'Leak Resolved' },
    valve_closed:  { icon: '🔴', cls: 'ev-warning', label: 'Valve Closed' },
    valve_opened:  { icon: '🟢', cls: 'ev-info',    label: 'Valve Opened' },
    leak_reset:    { icon: '🔄', cls: 'ev-neutral', label: 'Leak Reset' },
    flow_started:  { icon: '💧', cls: 'ev-info',    label: 'Flow Started' },
    flow_stopped:  { icon: '⏸',  cls: 'ev-neutral', label: 'Flow Stopped' },
    anomaly:       { icon: '📊', cls: 'ev-warning', label: 'Anomaly' }
};

// Leak type display config
const LEAK_TYPE_CONFIG = {
    burst:        { label: 'BURST',        severity: 'critical', icon: '💥', description: 'Flow rate spike detected' },
    prolonged:    { label: 'PROLONGED',    severity: 'warning',  icon: '🕐', description: 'Continuous flow for 30+ min' },
    closed_valve: { label: 'CLOSED VALVE', severity: 'critical', icon: '🔴', description: 'Flow while valve is closed' },
    unknown:      { label: 'LEAK',         severity: 'warning',  icon: '⚠',  description: 'Leak detected' },
    none:         { label: 'OK',           severity: 'ok',       icon: '✓',  description: 'Normal operation' }
};

// ═══════════════════════ WEBSOCKET ═══════════════════════
function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;

    setConnectionStatus('connecting', 'Connecting...');

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('[WS] Connected to backend');
        setConnectionStatus('connected', 'Live');
        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }
    };

    socket.onmessage = (event) => {
        let payload;
        try {
            payload = JSON.parse(event.data);
        } catch (e) {
            console.error('[WS] Failed to parse message:', e);
            return;
        }
        const { type, data } = payload;

        if (type === 'INIT') {
            data.forEach(d => {
                devices[d.device_id] = d;
                updateMainChartData(d);
            });
            renderDashboard();
            renderMainChart();
        } else if (type === 'UPDATE') {
            const prevDevice = devices[data.device_id];
            devices[data.device_id] = data;
            updateMainChartData(data);
            scheduleRender();

            // Update detail panel if it's showing this device
            if (currentDetailDevice === data.device_id) {
                updateDetailPanel(data);
            }

            // Check for leak alert — with leak type context
            if (data.alert === 'LEAK_DETECTED') {
                const ltConfig = LEAK_TYPE_CONFIG[data.leak_type] || LEAK_TYPE_CONFIG.unknown;
                showToast(`${ltConfig.icon} LEAK at ${formatDeviceName(data.device_id)} — ${ltConfig.description}`, 'danger');
                flashRow(data.device_id);
            } else if (data.alert === 'ANOMALY' && data.anomaly) {
                showToast(`📊 Unusual flow at ${formatDeviceName(data.device_id)} — ${data.anomaly.ratio}x above baseline for this hour`, 'info');
            }

            // Check for leak recovery
            if (prevDevice && prevDevice.leak_status && !data.leak_status) {
                showToast(`✅ ${formatDeviceName(data.device_id)} — Leak resolved, valve reopened.`, 'success');
            }
        }
        // COMMAND messages are for the bridge, dashboard ignores them
    };

    socket.onclose = () => {
        console.log('[WS] Disconnected');
        setConnectionStatus('disconnected', 'Disconnected');
        reconnectTimeout = setTimeout(() => {
            setConnectionStatus('connecting', 'Reconnecting...');
            connectWebSocket();
        }, 3000);
    };

    socket.onerror = (err) => {
        console.error('[WS] Error:', err);
        socket.close();
    };
}

function setConnectionStatus(state, text) {
    connectionStatus.className = 'connection-status ' + state;
    connectionStatus.querySelector('.status-text').textContent = text;
}

// ═══════════════════════ VALVE COMMANDS ═══════════════════════
async function sendCommand(deviceId, command) {
    try {
        const res = await fetch('/api/command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, command })
        });

        if (res.ok) {
            const actionMap = {
                'VALVE_CLOSE': 'Shutting off valve',
                'VALVE_OPEN': 'Opening valve',
                'RESET_LEAK': 'Resetting leak alarm'
            };
            showToast(`🔧 ${actionMap[command]} at ${formatDeviceName(deviceId)}...`, 'info');

            // Optimistic UI update
            if (devices[deviceId]) {
                if (command === 'VALVE_CLOSE') {
                    devices[deviceId].valve_open = false;
                } else if (command === 'VALVE_OPEN') {
                    devices[deviceId].valve_open = true;
                    devices[deviceId].leak_status = false;
                    devices[deviceId].water_loss = 0;
                } else if (command === 'RESET_LEAK') {
                    devices[deviceId].leak_status = false;
                    devices[deviceId].water_loss = 0;
                }
                renderDashboard();
                if (currentDetailDevice === deviceId) {
                    updateDetailPanel(devices[deviceId]);
                }
            }
        } else {
            showToast('⚠ Command failed. Is the bridge running?', 'danger');
        }
    } catch (err) {
        showToast('⚠ Cannot reach backend.', 'danger');
    }
}

// ═══════════════════════ TABLE ROW HELPERS ═══════════════════════
function getStatusInfo(d) {
    const isStale = d.last_seen && (Date.now() - new Date(d.last_seen).getTime() > 10000);
    if (isStale) return { cls: 'status-stale', text: '⏸ OFFLINE' };
    if (d.leak_status) {
        const ltConfig = LEAK_TYPE_CONFIG[d.leak_type] || LEAK_TYPE_CONFIG.unknown;
        return {
            cls: ltConfig.severity === 'critical' ? 'status-leak-critical' : 'status-leak',
            text: `${ltConfig.icon} ${ltConfig.label}`
        };
    }
    if (d.anomaly) return { cls: 'status-anomaly', text: `📊 ANOMALY (${d.anomaly.ratio}x)` };
    return { cls: 'status-ok', text: '✓ NORMAL' };
}

function getValveInfo(d) {
    const open = d.valve_open !== false;
    return {
        icon: open ? '🟢' : '🔴',
        label: open ? 'Open' : 'Closed',
        btnClass: `valve-btn ${open ? 'valve-close' : 'valve-open'}`,
        action: open ? 'VALVE_CLOSE' : 'VALVE_OPEN',
        btnText: open ? 'Shut Off' : 'Reopen'
    };
}

function buildRow(d) {
    const row = document.createElement('tr');
    row.className = 'device-row';
    row.dataset.deviceId = d.device_id;
    const s = getStatusInfo(d);
    const v = getValveInfo(d);
    row.innerHTML = `
        <td><span class="device-name">${formatDeviceName(d.device_id)}</span></td>
        <td><span class="status-badge ${s.cls}">${s.text}</span></td>
        <td>${(d.flow_rate || 0).toFixed(2)} L/min</td>
        <td>${(d.total_consumption || 0).toFixed(3)} L</td>
        <td>${(d.water_loss || 0).toFixed(2)} L</td>
        <td><span class="valve-status">${v.icon} ${v.label}</span></td>
        <td class="run-timer-cell${d.run_start ? '' : ' idle'}">${formatDuration(d.run_start)}</td>
        <td class="control-buttons">
            <button class="${v.btnClass}" data-device="${d.device_id}" data-action="${v.action}">${v.btnText}</button>
            ${d.leak_status ? `<button class="valve-btn valve-reset" data-device="${d.device_id}" data-action="RESET_LEAK">Reset Leak</button>` : ''}
        </td>
    `;
    return row;
}

function refreshRowCells(row, d) {
    const cells = row.cells;
    const s = getStatusInfo(d);
    const v = getValveInfo(d);
    cells[1].innerHTML = `<span class="status-badge ${s.cls}">${s.text}</span>`;
    cells[2].textContent = `${(d.flow_rate || 0).toFixed(2)} L/min`;
    cells[3].textContent = `${(d.total_consumption || 0).toFixed(3)} L`;
    cells[4].textContent = `${(d.water_loss || 0).toFixed(2)} L`;
    cells[5].innerHTML = `<span class="valve-status">${v.icon} ${v.label}</span>`;
    // cells[6] = run-timer-cell — updated by the 1s interval
    cells[7].innerHTML = `
        <button class="${v.btnClass}" data-device="${d.device_id}" data-action="${v.action}">${v.btnText}</button>
        ${d.leak_status ? `<button class="valve-btn valve-reset" data-device="${d.device_id}" data-action="RESET_LEAK">Reset Leak</button>` : ''}
    `;
}

// ═══════════════════════ RENDERING ═══════════════════════
function renderDashboard() {
    const deviceList = Object.values(devices);

    // Summary cards
    let totalUsage = 0;
    let activeLeaks = 0;
    let totalLoss = 0;

    deviceList.forEach(d => {
        totalUsage += d.total_consumption || 0;
        if (d.leak_status) activeLeaks++;
        totalLoss += d.water_loss || 0;
    });

    totalUsageEl.textContent = `${totalUsage.toFixed(3)} L`;
    activeDevicesEl.textContent = deviceList.length;
    activeLeaksEl.textContent = activeLeaks;
    totalLossEl.textContent = `${totalLoss.toFixed(2)} L`;
    deviceCountEl.textContent = `${deviceList.length} device${deviceList.length !== 1 ? 's' : ''}`;

    // Leak card alert state
    if (activeLeaks > 0) {
        activeLeaksCard.classList.add('alert');
    } else {
        activeLeaksCard.classList.remove('alert');
    }

    // Device table — smart DOM diffing (no full rebuild = no flicker)
    if (deviceList.length === 0) {
        deviceTableBody.innerHTML = '<tr class="empty-row"><td colspan="8">Waiting for device data...</td></tr>';
        return;
    }

    const emptyRow = deviceTableBody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    // Remove rows for devices that disappeared
    const currentIds = new Set(deviceList.map(d => d.device_id));
    deviceTableBody.querySelectorAll('tr[data-device-id]').forEach(row => {
        if (!currentIds.has(row.dataset.deviceId)) row.remove();
    });

    // Update existing rows in-place; append new rows
    deviceList.forEach(d => {
        const existing = deviceTableBody.querySelector(`tr[data-device-id="${d.device_id}"]`);
        if (existing) {
            refreshRowCells(existing, d);
        } else {
            deviceTableBody.appendChild(buildRow(d));
        }
    });
}

// ═══════════════════════ DETAIL PANEL ═══════════════════════
async function openDetailPanel(deviceId) {
    currentDetailDevice = deviceId;
    detailPanel.classList.add('active');
    detailOverlay.classList.add('active');
    detailDeviceName.textContent = formatDeviceName(deviceId);

    // Show current state immediately
    const device = devices[deviceId];
    if (device) {
        updateDetailPanel(device);
    }

    // Fetch history, report, baseline, and events in parallel
    const [historyRes, reportRes, baselineRes, eventsRes] = await Promise.allSettled([
        fetch(`/api/devices/${encodeURIComponent(deviceId)}`),
        fetch(`/api/report/${encodeURIComponent(deviceId)}`),
        fetch(`/api/baseline/${encodeURIComponent(deviceId)}`),
        fetch(`/api/events/${encodeURIComponent(deviceId)}`)
    ]);

    // ── History (flow chart only) ──
    try {
        if (historyRes.status === 'fulfilled' && historyRes.value.ok) {
            const data = await historyRes.value.json();
            renderFlowChart(data.history && data.history.length > 0 ? data.history : []);
        } else {
            renderFlowChart([]);
        }
    } catch (err) {
        console.error('[Detail] Error fetching history:', err);
        renderFlowChart([]);
    }

    // ── Recent Events (actual state-change log) ──
    try {
        if (eventsRes.status === 'fulfilled' && eventsRes.value.ok) {
            const evData = await eventsRes.value.json();
            if (evData.events && evData.events.length > 0) {
                detailHistory.innerHTML = evData.events.slice(0, 30).map(ev => {
                    const cfg = EVENT_CONFIG[ev.type] || { icon: 'ℹ️', cls: 'ev-neutral', label: ev.type };
                    return `
                        <div class="history-item">
                            <span class="hi-time">${formatDateTime(ev.timestamp)}</span>
                            <span class="hi-status ${cfg.cls}">${cfg.icon} ${cfg.label}</span>
                            <span class="hi-desc">${ev.description}</span>
                        </div>
                    `;
                }).join('');
            } else {
                detailHistory.innerHTML = '<p class="empty-history">No events recorded yet</p>';
            }
        } else {
            detailHistory.innerHTML = '<p class="empty-history">No events available</p>';
        }
    } catch (err) {
        console.error('[Detail] Error fetching events:', err);
        detailHistory.innerHTML = '<p class="empty-history">Failed to load events</p>';
    }

    // ── Usage Report (#3) ──
    const reportSection = document.getElementById('detail-report');
    if (reportSection) {
        try {
            if (reportRes.status === 'fulfilled' && reportRes.value.ok) {
                const report = await reportRes.value.json();
                reportSection.innerHTML = renderReportHTML(report);
                renderDailyBreakdownChart(report.daily_breakdown);
            } else {
                reportSection.innerHTML = '<p class="empty-history">Not enough data for report yet</p>';
            }
        } catch (err) {
            reportSection.innerHTML = '<p class="empty-history">Failed to load report</p>';
        }
    }

    // ── Baseline Profile (#1) ──
    const baselineSection = document.getElementById('detail-baseline');
    if (baselineSection) {
        try {
            if (baselineRes.status === 'fulfilled' && baselineRes.value.ok) {
                const baseline = await baselineRes.value.json();
                if (baseline.status === 'ok' && Object.keys(baseline.hours).length > 0) {
                    baselineSection.innerHTML = renderBaselineHTML(baseline);
                    renderBaselineChart(baseline.hours);
                } else {
                    baselineSection.innerHTML = '<p class="empty-history">Collecting baseline data...</p>';
                }
            }
        } catch (err) {
            baselineSection.innerHTML = '<p class="empty-history">Failed to load baseline</p>';
        }
    }
}

function updateDetailPanel(device) {
    detailFlow.textContent = `${(device.flow_rate || 0).toFixed(2)} L/min`;
    detailUsage.textContent = `${(device.total_consumption || 0).toFixed(3)} L`;
    if (device.leak_status) {
        const ltConfig = LEAK_TYPE_CONFIG[device.leak_type] || LEAK_TYPE_CONFIG.unknown;
        detailStatus.textContent = `${ltConfig.icon} ${ltConfig.label}`;
        detailStatus.style.color = ltConfig.severity === 'critical' ? 'var(--accent-red)' : 'var(--accent-orange, #e67e22)';
    } else {
        detailStatus.textContent = '✓ Normal';
        detailStatus.style.color = 'var(--accent-green)';
    }
    detailLoss.textContent = `${(device.water_loss || 0).toFixed(2)} L`;

    const timerEl = document.getElementById('detail-run-timer');
    if (timerEl) {
        timerEl.textContent = formatDuration(device.run_start);
        timerEl.style.color = device.run_start ? 'var(--accent-cyan)' : 'var(--text-muted)';
    }

    // Update valve control button in detail panel
    const valveSection = document.getElementById('detail-valve-section');
    if (valveSection) {
        const valveOpen = device.valve_open !== false;
        const cmd = valveOpen ? 'VALVE_CLOSE' : 'VALVE_OPEN';
        const resetBtnHtml = device.leak_status
            ? `<button class="valve-btn-large valve-reset-large" id="detail-reset-btn">🔄 Reset Leak Alarm</button>`
            : '';
        valveSection.innerHTML = `
            <div class="detail-valve">
                <span class="valve-indicator ${valveOpen ? 'open' : 'closed'}">
                    ${valveOpen ? '🟢 Valve Open' : '🔴 Valve Closed'}
                </span>
                <div class="detail-valve-buttons">
                    <button class="valve-btn-large ${valveOpen ? 'valve-close' : 'valve-open'}"
                            id="detail-valve-btn">
                        ${valveOpen ? '🛑 Shut Off Valve' : '✅ Reopen Valve'}
                    </button>
                    ${resetBtnHtml}
                </div>
            </div>
        `;
        const safeId = device.device_id;
        valveSection.querySelector('#detail-valve-btn').addEventListener('click', () => {
            sendCommand(safeId, cmd);
        });
        const resetBtn = valveSection.querySelector('#detail-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                sendCommand(safeId, 'RESET_LEAK');
            });
        }
    }
}

function closeDetailPanel() {
    detailPanel.classList.remove('active');
    detailOverlay.classList.remove('active');
    currentDetailDevice = null;
}

detailClose.addEventListener('click', closeDetailPanel);
detailOverlay.addEventListener('click', closeDetailPanel);

// ESC key closes panel
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDetailPanel();
});

// ═══════════════════════ TOAST NOTIFICATIONS ═══════════════════════
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, 5000);
}

// ═══════════════════════ ROW FLASH ═══════════════════════
function flashRow(deviceId) {
    const row = document.querySelector(`tr[data-device-id="${deviceId}"]`);
    if (row) {
        row.classList.remove('flash-leak');
        void row.offsetWidth;
        row.classList.add('flash-leak');
        row.addEventListener('animationend', () => {
            row.classList.remove('flash-leak');
        }, { once: true });
    }
}

// ═══════════════════════ HELPERS ═══════════════════════
function formatDeviceName(deviceId) {
    return deviceId
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatTime(isoString) {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleTimeString();
    } catch {
        return '—';
    }
}

function formatDateTime(isoString) {
    if (!isoString) return '—';
    try {
        return new Date(isoString).toLocaleString([], {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
    } catch {
        return '—';
    }
}

function formatDuration(isoStart) {
    if (!isoStart) return '—';
    const elapsed = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
    if (elapsed < 0) return '—';
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
    return `${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

// ═══════════════════════ MAIN DASHBOARD CHART ═══════════════════════
function updateMainChartData(deviceData) {
    const id = deviceData.device_id;
    if (!mainChartHistory[id]) {
        mainChartHistory[id] = [];
    }
    mainChartHistory[id].push({
        time: new Date().toLocaleTimeString(),
        flow_rate: deviceData.flow_rate || 0
    });
    if (mainChartHistory[id].length > MAX_MAIN_CHART_POINTS) {
        mainChartHistory[id].shift();
    }
}

function renderMainChart() {
    const canvas = document.getElementById('main-flow-chart');
    if (!canvas) return;

    const deviceIds = Object.keys(mainChartHistory);
    const chartDeviceCount = document.getElementById('chart-device-count');
    if (chartDeviceCount) {
        chartDeviceCount.textContent = `${deviceIds.length} device${deviceIds.length !== 1 ? 's' : ''}`;
    }

    if (deviceIds.length === 0) {
        if (mainChart) { mainChart.destroy(); mainChart = null; }
        return;
    }

    // Build unified time labels from the device with the most data points
    const maxLen = Math.max(...deviceIds.map(id => mainChartHistory[id].length));
    const longestId = deviceIds.find(id => mainChartHistory[id].length === maxLen);
    const labels = mainChartHistory[longestId].map(p => p.time);

    // Build one dataset per device
    const datasets = deviceIds.map((id, i) => {
        const color = DEVICE_COLORS[i % DEVICE_COLORS.length];
        const history = mainChartHistory[id];
        // Right-align data so latest points line up
        const padded = new Array(maxLen - history.length).fill(null)
            .concat(history.map(p => p.flow_rate));

        return {
            label: formatDeviceName(id),
            data: padded,
            borderColor: color,
            backgroundColor: color + '1a',
            borderWidth: 2,
            pointRadius: 2,
            pointBackgroundColor: color,
            fill: false,
            tension: 0.3,
            spanGaps: true
        };
    });

    if (mainChart) {
        mainChart.data.labels = labels;
        mainChart.data.datasets = datasets;
        mainChart.update('none');
        return;
    }

    mainChart = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#94a3b8',
                        font: { size: 12, weight: '600' },
                        boxWidth: 12,
                        boxHeight: 12,
                        borderRadius: 3,
                        useBorderRadius: true,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 24, 39, 0.95)',
                    titleColor: '#e2e8f0',
                    bodyColor: '#94a3b8',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    padding: 12
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 10, color: '#64748b', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'L/min', color: '#64748b', font: { size: 11 } },
                    ticks: { color: '#64748b' },
                    grid: { color: 'rgba(255,255,255,0.04)' }
                }
            }
        }
    });
}

// ═══════════════════════ DETAIL PANEL FLOW CHART ═══════════════════════
function renderFlowChart(history) {
    const canvas = document.getElementById('detail-chart');
    if (!canvas) return;

    // Destroy previous chart
    if (flowChart) {
        flowChart.destroy();
        flowChart = null;
    }

    if (!history || history.length === 0) {
        return;
    }

    // Use last 60 data points
    const data = history.slice(-60);
    const labels = data.map(h => formatTime(h.timestamp));
    const flowData = data.map(h => h.flow_rate || 0);

    // Color points by leak status
    const pointColors = data.map(h => {
        if (!h.leak_status) return '#3498db';
        const lt = LEAK_TYPE_CONFIG[h.leak_type] || LEAK_TYPE_CONFIG.unknown;
        return lt.severity === 'critical' ? '#e74c3c' : '#e67e22';
    });

    // Build leak annotation segments (shade background where leaks occurred)
    const leakSegments = [];
    let inLeak = false;
    let segStart = 0;
    data.forEach((h, i) => {
        if (h.leak_status && !inLeak) { inLeak = true; segStart = i; }
        if (!h.leak_status && inLeak) { inLeak = false; leakSegments.push({ start: segStart, end: i }); }
    });
    if (inLeak) leakSegments.push({ start: segStart, end: data.length - 1 });

    flowChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Flow Rate (L/min)',
                data: flowData,
                borderColor: '#3498db',
                backgroundColor: 'rgba(52, 152, 219, 0.1)',
                borderWidth: 2,
                pointBackgroundColor: pointColors,
                pointRadius: 3,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: function(ctx) {
                            const d = data[ctx.dataIndex];
                            if (d.leak_status) {
                                const lt = LEAK_TYPE_CONFIG[d.leak_type] || LEAK_TYPE_CONFIG.unknown;
                                return `${lt.icon} ${lt.description}`;
                            }
                            return '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { maxTicksLimit: 8, color: '#888', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'L/min', color: '#888' },
                    ticks: { color: '#888' },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        },
        plugins: [{
            id: 'leakHighlight',
            beforeDraw(chart) {
                const ctx = chart.ctx;
                const xScale = chart.scales.x;
                const yScale = chart.scales.y;
                leakSegments.forEach(seg => {
                    const x1 = xScale.getPixelForValue(seg.start);
                    const x2 = xScale.getPixelForValue(seg.end);
                    ctx.fillStyle = 'rgba(231, 76, 60, 0.08)';
                    ctx.fillRect(x1, yScale.top, x2 - x1, yScale.bottom - yScale.top);
                });
            }
        }]
    });
}

// ═══════════════════════ REPORT RENDERING (#3) ═══════════════════════
function renderReportHTML(report) {
    const { today, week, month } = report;

    function trendBadge(val) {
        if (val === null) return '<span class="trend-badge trend-neutral">—</span>';
        const sign = val > 0 ? '+' : '';
        const cls = val > 15 ? 'trend-up' : val < -15 ? 'trend-down' : 'trend-neutral';
        return `<span class="trend-badge ${cls}">${sign}${val}%</span>`;
    }

    return `
        <div class="report-grid">
            <div class="report-card">
                <h4>Today</h4>
                <div class="report-stat">
                    <span class="report-label">Consumption</span>
                    <span class="report-value">${today.consumption.toFixed(3)} L</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Avg Flow</span>
                    <span class="report-value">${today.avg_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Peak Flow</span>
                    <span class="report-value">${today.peak_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Leak Events</span>
                    <span class="report-value ${today.leak_events > 0 ? 'report-danger' : ''}">${today.leak_events}</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">vs Yesterday</span>
                    ${trendBadge(today.trend_vs_yesterday)}
                </div>
            </div>
            <div class="report-card">
                <h4>This Week</h4>
                <div class="report-stat">
                    <span class="report-label">Consumption</span>
                    <span class="report-value">${week.consumption.toFixed(3)} L</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Avg Flow</span>
                    <span class="report-value">${week.avg_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Peak Flow</span>
                    <span class="report-value">${week.peak_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Leak Events</span>
                    <span class="report-value ${week.leak_events > 0 ? 'report-danger' : ''}">${week.leak_events}</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">vs Prev Week</span>
                    ${trendBadge(week.trend_vs_prev_week)}
                </div>
            </div>
            ${month ? `
            <div class="report-card">
                <h4>This Month</h4>
                <div class="report-stat">
                    <span class="report-label">Consumption</span>
                    <span class="report-value">${month.consumption.toFixed(3)} L</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Avg Flow</span>
                    <span class="report-value">${month.avg_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Peak Flow</span>
                    <span class="report-value">${month.peak_flow.toFixed(2)} L/min</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">Leak Events</span>
                    <span class="report-value ${month.leak_events > 0 ? 'report-danger' : ''}">${month.leak_events}</span>
                </div>
                <div class="report-stat">
                    <span class="report-label">vs Prev Month</span>
                    ${trendBadge(month.trend_vs_prev_month)}
                </div>
            </div>` : ''}
        </div>
        <div class="report-chart-container">
            <canvas id="daily-breakdown-chart"></canvas>
        </div>
    `;
}

let dailyChart = null;
function renderDailyBreakdownChart(breakdown) {
    const canvas = document.getElementById('daily-breakdown-chart');
    if (!canvas) return;
    if (dailyChart) { dailyChart.destroy(); dailyChart = null; }

    const labels = breakdown.map(d => d.label);
    const avgData = breakdown.map(d => d.avg_flow);
    const peakData = breakdown.map(d => d.peak_flow);

    dailyChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Avg Flow (L/min)',
                    data: avgData,
                    backgroundColor: 'rgba(59, 130, 246, 0.6)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    label: 'Peak Flow (L/min)',
                    data: peakData,
                    backgroundColor: 'rgba(34, 211, 238, 0.3)',
                    borderColor: '#22d3ee',
                    borderWidth: 1,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { size: 11 } } }
            },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { beginAtZero: true, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}

// ═══════════════════════ BASELINE RENDERING (#1) ═══════════════════════
function renderBaselineHTML(baseline) {
    const currentHour = new Date().getHours();
    const currentSlot = baseline.hours[currentHour];
    const currentAvg = currentSlot ? currentSlot.avg_flow : null;

    return `
        <div class="baseline-info">
            <div class="baseline-current">
                <span class="report-label">Baseline for ${currentHour}:00-${currentHour + 1}:00</span>
                <span class="report-value">${currentAvg !== null ? currentAvg.toFixed(2) + ' L/min' : 'No data'}</span>
                ${currentSlot ? `<span class="baseline-samples">${currentSlot.samples} samples</span>` : ''}
            </div>
        </div>
        <div class="report-chart-container">
            <canvas id="baseline-chart"></canvas>
        </div>
    `;
}

let baselineChart = null;
function renderBaselineChart(hours) {
    const canvas = document.getElementById('baseline-chart');
    if (!canvas) return;
    if (baselineChart) { baselineChart.destroy(); baselineChart = null; }

    const labels = [];
    const data = [];
    const bgColors = [];
    const currentHour = new Date().getHours();

    for (let h = 0; h < 24; h++) {
        labels.push(`${String(h).padStart(2, '0')}:00`);
        data.push(hours[h] ? hours[h].avg_flow : 0);
        bgColors.push(h === currentHour ? 'rgba(34, 197, 94, 0.7)' : 'rgba(167, 139, 250, 0.5)');
    }

    baselineChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Avg Flow (L/min)',
                data,
                backgroundColor: bgColors,
                borderColor: bgColors.map(c => c.replace(/[\d.]+\)$/, '1)')),
                borderWidth: 1,
                borderRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 300 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => {
                            const h = ctx.dataIndex;
                            const slot = hours[h];
                            return slot ? `${slot.samples} samples` : 'No data';
                        }
                    }
                }
            },
            scales: {
                x: { ticks: { maxTicksLimit: 12, color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { beginAtZero: true, title: { display: true, text: 'L/min', color: '#64748b', font: { size: 10 } }, ticks: { color: '#64748b' }, grid: { color: 'rgba(255,255,255,0.04)' } }
            }
        }
    });
}

// ═══════════════════════ SETTINGS MODAL ═══════════════════════
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsClose = document.getElementById('settings-close');
const settingsStatus = document.getElementById('settings-status');

function openSettings() {
    settingsModal.classList.add('active');
    settingsOverlay.classList.add('active');
    settingsStatus.textContent = '';

    // Load current settings
    fetch('/api/settings')
        .then(r => r.json())
        .then(s => {
            document.getElementById('email-enabled').checked = s.email?.enabled || false;
            document.getElementById('gmail-user').value = s.email?.gmailUser || '';
            document.getElementById('gmail-pass').value = '';
            document.getElementById('gmail-pass').placeholder = s.email?.gmailAppPassword === '••••••••' ? '(saved — enter new to change)' : 'xxxx xxxx xxxx xxxx';
            document.getElementById('email-recipient').value = s.email?.recipient || '';
        })
        .catch(() => {
            settingsStatus.textContent = 'Failed to load settings';
            settingsStatus.style.color = 'var(--accent-red)';
        });
}

function closeSettings() {
    settingsModal.classList.remove('active');
    settingsOverlay.classList.remove('active');
}

settingsBtn.addEventListener('click', openSettings);
settingsClose.addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', closeSettings);

document.getElementById('save-settings-btn').addEventListener('click', async () => {
    const email = {
        enabled: document.getElementById('email-enabled').checked,
        gmailUser: document.getElementById('gmail-user').value.trim(),
        gmailAppPassword: document.getElementById('gmail-pass').value.trim() || '••••••••',
        recipient: document.getElementById('email-recipient').value.trim()
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (res.ok) {
            settingsStatus.textContent = 'Settings saved!';
            settingsStatus.style.color = 'var(--accent-green)';
        } else {
            settingsStatus.textContent = 'Failed to save';
            settingsStatus.style.color = 'var(--accent-red)';
        }
    } catch {
        settingsStatus.textContent = 'Cannot reach backend';
        settingsStatus.style.color = 'var(--accent-red)';
    }
});

document.getElementById('test-email-btn').addEventListener('click', async () => {
    settingsStatus.textContent = 'Sending test email...';
    settingsStatus.style.color = '#888';

    try {
        const res = await fetch('/api/settings/test-email', { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            settingsStatus.textContent = data.message || 'Test email sent!';
            settingsStatus.style.color = 'var(--accent-green)';
        } else {
            settingsStatus.textContent = data.error || 'Test failed';
            settingsStatus.style.color = 'var(--accent-red)';
        }
    } catch {
        settingsStatus.textContent = 'Cannot reach backend';
        settingsStatus.style.color = 'var(--accent-red)';
    }
});

// ═══════════════════════ DEMO PANEL ═══════════════════════
const demoBtn = document.getElementById('demo-btn');
const demoModal = document.getElementById('demo-modal');
const demoOverlay = document.getElementById('demo-overlay');
const demoClose = document.getElementById('demo-close');
const demoStatus = document.getElementById('demo-status');
const demoDeviceSelect = document.getElementById('demo-device');

function openDemo() {
    // Populate device list from current known devices
    demoDeviceSelect.innerHTML = '<option value="">— First connected device —</option>';
    Object.keys(devices).forEach(id => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = formatDeviceName(id);
        demoDeviceSelect.appendChild(opt);
    });
    demoStatus.textContent = '';
    demoModal.classList.add('active');
    demoOverlay.classList.add('active');
}

function closeDemo() {
    demoModal.classList.remove('active');
    demoOverlay.classList.remove('active');
}

demoBtn.addEventListener('click', openDemo);
demoClose.addEventListener('click', closeDemo);
demoOverlay.addEventListener('click', closeDemo);

document.getElementById('demo-trigger-btn').addEventListener('click', async () => {
    const deviceId = demoDeviceSelect.value || undefined;
    const leakType = document.getElementById('demo-leak-type').value;
    demoStatus.textContent = 'Injecting leak...';
    demoStatus.style.color = '#888';
    try {
        const res = await fetch('/api/demo/simulate-leak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId, leak_type: leakType })
        });
        const data = await res.json();
        if (res.ok) {
            demoStatus.textContent = `✅ Leak simulated on ${formatDeviceName(data.device_id)} @ ${data.flow_rate} L/min`;
            demoStatus.style.color = 'var(--accent-green)';
        } else {
            demoStatus.textContent = data.error || 'Failed';
            demoStatus.style.color = 'var(--accent-red)';
        }
    } catch {
        demoStatus.textContent = 'Cannot reach backend.';
        demoStatus.style.color = 'var(--accent-red)';
    }
});

document.getElementById('demo-resolve-btn').addEventListener('click', async () => {
    const deviceId = demoDeviceSelect.value || undefined;
    demoStatus.textContent = 'Resolving...';
    demoStatus.style.color = '#888';
    try {
        const res = await fetch('/api/demo/resolve-leak', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: deviceId })
        });
        const data = await res.json();
        if (res.ok) {
            demoStatus.textContent = `✅ Leak resolved on ${formatDeviceName(data.device_id)}`;
            demoStatus.style.color = 'var(--accent-green)';
        } else {
            demoStatus.textContent = data.error || 'Failed';
            demoStatus.style.color = 'var(--accent-red)';
        }
    } catch {
        demoStatus.textContent = 'Cannot reach backend.';
        demoStatus.style.color = 'var(--accent-red)';
    }
});

// ═══════════════════════ INIT ═══════════════════════
connectWebSocket();

// 1-second interval: tick running timers without full re-render
setInterval(() => {
    deviceTableBody.querySelectorAll('tr[data-device-id]').forEach(row => {
        const d = devices[row.dataset.deviceId];
        const cell = row.cells[6]; // run-timer-cell is column index 6
        if (!d || !cell) return;
        cell.textContent = formatDuration(d.run_start);
        cell.className = `run-timer-cell${d.run_start ? '' : ' idle'}`;
    });
    if (currentDetailDevice) {
        const el = document.getElementById('detail-run-timer');
        if (el && devices[currentDetailDevice]) {
            el.textContent = formatDuration(devices[currentDetailDevice].run_start);
        }
    }
}, 1000);

// 5-second interval: re-render to catch stale (offline) status changes
setInterval(() => {
    if (Object.keys(devices).length > 0) renderDashboard();
}, 5000);
