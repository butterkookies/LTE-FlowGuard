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
let currentDetailDevice = null; // Track which device detail panel is showing

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
        const payload = JSON.parse(event.data);
        const { type, data } = payload;

        if (type === 'INIT') {
            data.forEach(d => {
                devices[d.device_id] = d;
            });
            renderDashboard();
        } else if (type === 'UPDATE') {
            const prevDevice = devices[data.device_id];
            devices[data.device_id] = data;
            renderDashboard();

            // Update detail panel if it's showing this device
            if (currentDetailDevice === data.device_id) {
                updateDetailPanel(data);
            }

            // Check for leak alert
            if (data.alert === 'LEAK_DETECTED') {
                showToast(`🚨 LEAK DETECTED at ${formatDeviceName(data.device_id)}!`, 'danger');
                flashRow(data.device_id);
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
            const action = command === 'VALVE_CLOSE' ? 'Shutting off' : 'Opening';
            showToast(`🔧 ${action} valve at ${formatDeviceName(deviceId)}...`, 'info');

            // Optimistic UI update
            if (devices[deviceId]) {
                if (command === 'VALVE_CLOSE') {
                    devices[deviceId].valve_open = false;
                } else {
                    devices[deviceId].valve_open = true;
                    devices[deviceId].leak_status = false;
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

    // Device table
    if (deviceList.length === 0) {
        deviceTableBody.innerHTML = '<tr class="empty-row"><td colspan="7">Waiting for device data...</td></tr>';
        return;
    }

    deviceTableBody.innerHTML = '';
    deviceList.forEach(d => {
        const row = document.createElement('tr');
        row.className = 'device-row';
        row.dataset.deviceId = d.device_id;

        // Stale detection: no update for >10 seconds
        const isStale = d.last_seen && (Date.now() - new Date(d.last_seen).getTime() > 10000);

        let statusClass, statusText;
        if (isStale) {
            statusClass = 'status-stale';
            statusText = '⏸ OFFLINE';
        } else if (d.leak_status) {
            statusClass = 'status-leak';
            statusText = '⚠ LEAK';
        } else {
            statusClass = 'status-ok';
            statusText = '✓ NORMAL';
        }

        const lastSeen = formatTime(d.last_seen);
        const displayName = formatDeviceName(d.device_id);
        const valveOpen = d.valve_open !== false; // Default to open
        const valveIcon = valveOpen ? '🟢' : '🔴';
        const valveLabel = valveOpen ? 'Open' : 'Closed';
        const valveBtnClass = valveOpen ? 'valve-btn valve-close' : 'valve-btn valve-open';
        const valveBtnText = valveOpen ? 'Shut Off' : 'Reopen';

        row.innerHTML = `
            <td><span class="device-name">${displayName}</span></td>
            <td><span class="status-badge ${statusClass}">${statusText}</span></td>
            <td>${(d.flow_rate || 0).toFixed(2)} L/min</td>
            <td>${(d.total_consumption || 0).toFixed(3)} L</td>
            <td>${(d.water_loss || 0).toFixed(2)} L</td>
            <td><span class="valve-status">${valveIcon} ${valveLabel}</span></td>
            <td>
                <button class="${valveBtnClass}" data-device="${d.device_id}" data-action="${valveOpen ? 'VALVE_CLOSE' : 'VALVE_OPEN'}">
                    ${valveBtnText}
                </button>
            </td>
        `;

        // Click row (excluding button) to open detail panel
        row.addEventListener('click', (e) => {
            if (!e.target.closest('.valve-btn')) {
                openDetailPanel(d.device_id);
            }
        });

        // Valve button click
        const btn = row.querySelector('.valve-btn');
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            sendCommand(d.device_id, btn.dataset.action);
        });

        deviceTableBody.appendChild(row);
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

    // Fetch history from backend
    try {
        const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();

        if (data.history && data.history.length > 0) {
            const recent = data.history.slice(-20).reverse();
            detailHistory.innerHTML = recent.map(h => `
                <div class="history-item">
                    <span class="hi-time">${formatTime(h.timestamp)}</span>
                    <span class="hi-flow">${(h.flow_rate || 0).toFixed(2)} L/min</span>
                    <span class="hi-status ${h.leak_status ? 'leak' : 'ok'}">${h.leak_status ? 'LEAK' : 'OK'}</span>
                </div>
            `).join('');
        } else {
            detailHistory.innerHTML = '<p class="empty-history">No history available</p>';
        }
    } catch (err) {
        console.error('[Detail] Error fetching history:', err);
        detailHistory.innerHTML = '<p class="empty-history">Failed to load history</p>';
    }
}

function updateDetailPanel(device) {
    detailFlow.textContent = `${(device.flow_rate || 0).toFixed(2)} L/min`;
    detailUsage.textContent = `${(device.total_consumption || 0).toFixed(3)} L`;
    detailStatus.textContent = device.leak_status ? '⚠ LEAK' : '✓ Normal';
    detailStatus.style.color = device.leak_status ? 'var(--accent-red)' : 'var(--accent-green)';
    detailLoss.textContent = `${(device.water_loss || 0).toFixed(2)} L`;

    // Update valve control button in detail panel
    const valveSection = document.getElementById('detail-valve-section');
    if (valveSection) {
        const valveOpen = device.valve_open !== false;
        valveSection.innerHTML = `
            <div class="detail-valve">
                <span class="valve-indicator ${valveOpen ? 'open' : 'closed'}">
                    ${valveOpen ? '🟢 Valve Open' : '🔴 Valve Closed'}
                </span>
                <button class="valve-btn-large ${valveOpen ? 'valve-close' : 'valve-open'}"
                        onclick="sendCommand('${device.device_id}', '${valveOpen ? 'VALVE_CLOSE' : 'VALVE_OPEN'}')">
                    ${valveOpen ? '🛑 Shut Off Valve' : '✅ Reopen Valve'}
                </button>
            </div>
        `;
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

// ═══════════════════════ INIT ═══════════════════════
connectWebSocket();

// Periodically re-render to update stale indicators
setInterval(() => {
    if (Object.keys(devices).length > 0) {
        renderDashboard();
    }
}, 5000);
