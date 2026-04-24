const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ═══════════════ DATA PERSISTENCE ═══════════════
const DATA_DIR = path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const BASELINE_FILE = path.join(DATA_DIR, 'baselines.json');
const MAX_HISTORY = 500; // per device

// ═══════════════ BASELINE ANOMALY CONFIG ═══════════════
const ANOMALY_MULTIPLIER = 2.5;   // flag if flow > 2.5x the baseline for that hour
const ANOMALY_MIN_FLOW = 0.5;     // ignore anomalies below this flow rate
const BASELINE_MIN_SAMPLES = 5;   // need at least N samples before baseline is trusted
const BASELINE_MAX_SAMPLES = 500; // cap samples per slot — older data decays via EMA blending

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Load persisted history
function loadHistory() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Storage] Failed to load history:', e.message);
    }
    return {};
}

// Save history to disk (debounced)
let saveTimer = null;
function saveHistory() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(HISTORY_FILE, JSON.stringify(deviceHistory), 'utf8');
        } catch (e) {
            console.error('[Storage] Failed to save history:', e.message);
        }
        saveTimer = null;
    }, 5000); // flush every 5 seconds at most
}

// Load/save email settings
function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Storage] Failed to load settings:', e.message);
    }
    return { email: { enabled: false, recipient: '', gmailUser: '', gmailAppPassword: '' } };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
        console.error('[Storage] Failed to save settings:', e.message);
    }
}

let appSettings = loadSettings();

// ═══════════════ BASELINE PROFILING (#1) ═══════════════
// Structure: { "device-id": { "0": { sum, count }, "1": { sum, count }, ... "23": { sum, count } } }
// Each key is an hour (0-23). We store sum + count to compute rolling averages.
function loadBaselines() {
    try {
        if (fs.existsSync(BASELINE_FILE)) {
            return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('[Baseline] Failed to load baselines:', e.message);
    }
    return {};
}

let baselineSaveTimer = null;
function saveBaselines() {
    if (baselineSaveTimer) return;
    baselineSaveTimer = setTimeout(() => {
        try {
            fs.writeFileSync(BASELINE_FILE, JSON.stringify(deviceBaselines), 'utf8');
        } catch (e) {
            console.error('[Baseline] Failed to save baselines:', e.message);
        }
        baselineSaveTimer = null;
    }, 10000);
}

const deviceBaselines = loadBaselines();

// Update baseline with a new flow reading (with exponential decay)
function updateBaseline(deviceId, flowRate) {
    if (!deviceBaselines[deviceId]) {
        deviceBaselines[deviceId] = {};
    }
    const hour = String(new Date().getHours());
    if (!deviceBaselines[deviceId][hour]) {
        deviceBaselines[deviceId][hour] = { sum: 0, count: 0 };
    }
    const slot = deviceBaselines[deviceId][hour];
    if (slot.count >= BASELINE_MAX_SAMPLES) {
        // Decay: blend toward recent data by halving the accumulated stats
        slot.sum = slot.sum / 2;
        slot.count = Math.floor(slot.count / 2);
    }
    slot.sum += flowRate;
    slot.count += 1;
    saveBaselines();
}

// Check if current flow is anomalous relative to the baseline for this hour
function checkAnomaly(deviceId, flowRate) {
    if (flowRate < ANOMALY_MIN_FLOW) return null;

    const baseline = deviceBaselines[deviceId];
    if (!baseline) return null;

    const hour = String(new Date().getHours());
    const slot = baseline[hour];
    if (!slot || slot.count < BASELINE_MIN_SAMPLES) return null;

    const avg = slot.sum / slot.count;
    if (avg < ANOMALY_MIN_FLOW) return null;

    if (flowRate > avg * ANOMALY_MULTIPLIER) {
        return {
            type: 'high_flow',
            current: flowRate,
            baseline_avg: parseFloat(avg.toFixed(2)),
            ratio: parseFloat((flowRate / avg).toFixed(1)),
            hour: parseInt(hour)
        };
    }
    return null;
}

// ═══════════════ EMAIL ALERTS ═══════════════
function sendLeakEmail(deviceData) {
    const { email } = appSettings;
    if (!email.enabled || !email.recipient || !email.gmailUser || !email.gmailAppPassword) {
        return;
    }

    const leakLabels = {
        burst: 'Flow Rate Spike (Burst)',
        prolonged: 'Prolonged Continuous Flow (30+ min)',
        closed_valve: 'Flow Detected While Valve Closed',
        unknown: 'Unknown Leak Type'
    };

    const leakType = deviceData.leak_type || 'unknown';
    const label = leakLabels[leakType] || leakLabels.unknown;
    const deviceName = deviceData.device_id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: email.gmailUser,
            pass: email.gmailAppPassword
        }
    });

    const mailOptions = {
        from: `"FlowGuard+ Alert" <${email.gmailUser}>`,
        to: email.recipient,
        subject: `🚨 LEAK DETECTED — ${deviceName}`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
                <h2 style="color: #e74c3c;">🚨 Leak Detected</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px; font-weight: bold;">Device</td><td style="padding: 8px;">${deviceName}</td></tr>
                    <tr style="background: #f8f8f8;"><td style="padding: 8px; font-weight: bold;">Leak Type</td><td style="padding: 8px;">${label}</td></tr>
                    <tr><td style="padding: 8px; font-weight: bold;">Flow Rate</td><td style="padding: 8px;">${(deviceData.flow_rate || 0).toFixed(2)} L/min</td></tr>
                    <tr style="background: #f8f8f8;"><td style="padding: 8px; font-weight: bold;">Total Consumption</td><td style="padding: 8px;">${(deviceData.total_consumption || 0).toFixed(3)} L</td></tr>
                    <tr><td style="padding: 8px; font-weight: bold;">Valve</td><td style="padding: 8px;">${deviceData.valve_open ? 'Open' : 'Closed'}</td></tr>
                    <tr style="background: #f8f8f8;"><td style="padding: 8px; font-weight: bold;">Time</td><td style="padding: 8px;">${new Date().toLocaleString()}</td></tr>
                </table>
                <p style="margin-top: 16px; color: #666; font-size: 13px;">— FlowGuard+ Monitoring System</p>
            </div>
        `
    };

    transporter.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.error('[Email] Failed to send alert:', err.message);
        } else {
            console.log('[Email] Leak alert sent to', email.recipient);
        }
    });
}

// In-memory data store for devices
const devices = {};
// History store — loaded from disk
const deviceHistory = loadHistory();

// Event log — in-memory, records meaningful state-change events per device
const deviceEvents = {};
const MAX_EVENTS = 100;

function logEvent(deviceId, type, description, extra = {}) {
    if (!deviceEvents[deviceId]) deviceEvents[deviceId] = [];
    deviceEvents[deviceId].push({ timestamp: new Date().toISOString(), type, description, ...extra });
    if (deviceEvents[deviceId].length > MAX_EVENTS) deviceEvents[deviceId].shift();
}

// ── Server-side valve state (overrides ESP32 reports) ──
const valveOverrides = {};
const consumptionSnapshots = {};

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server for real-time dashboard updates
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('[WS] New dashboard client connected.');
    // Send current state on connect
    ws.send(JSON.stringify({ type: 'INIT', data: Object.values(devices) }));
});

// Broadcast helper
const broadcast = (payload) => {
    const msg = JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(msg);
        }
    });
};

// ═══════════════ ENDPOINT: Receive data from ESP32 ═══════════════
app.post('/api/data', (req, res) => {
    const { device_id, flow_rate, total_consumption, leak_status, leak_type, water_loss, valve_open } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'device_id is required' });
    }

    // Build device data from ESP32 report
    const deviceData = {
        device_id,
        flow_rate,
        total_consumption,
        leak_status,
        leak_type: leak_type || 'none',
        water_loss,
        valve_open: valve_open !== undefined ? valve_open : true,
        last_seen: new Date().toISOString()
    };

    // ── Apply server-side valve override ──
    // If the dashboard has commanded a valve state, enforce it
    // regardless of what the ESP32 reports.
    if (valveOverrides[device_id]) {
        const override = valveOverrides[device_id];
        deviceData.valve_open = override.valve_open;

        // If valve was commanded closed, suppress flow and leak readings
        if (!override.valve_open) {
            deviceData.flow_rate = 0;
            deviceData.water_loss = 0;
            deviceData.leak_status = override.leak_status !== undefined
                ? override.leak_status
                : leak_status;
            // Freeze total_consumption to the snapshot taken when valve was closed
            if (consumptionSnapshots[device_id] !== undefined) {
                deviceData.total_consumption = consumptionSnapshots[device_id];
            }
        } else {
            // Valve was commanded open = leak reset
            deviceData.leak_status = false;
            deviceData.water_loss = 0;
        }
    }

    // ── Baseline profiling: update + anomaly check ──
    updateBaseline(device_id, deviceData.flow_rate || 0);
    const anomaly = checkAnomaly(device_id, deviceData.flow_rate || 0);
    deviceData.anomaly = anomaly; // null if normal

    // Check if leak status just changed (for alert notification)
    const previousState = devices[device_id];
    const leakJustDetected = deviceData.leak_status && (!previousState || !previousState.leak_status);

    // Track run_start: set when flow begins, keep while flowing, clear when stopped
    if (deviceData.flow_rate > 0) {
        deviceData.run_start = (previousState && previousState.run_start && previousState.flow_rate > 0)
            ? previousState.run_start
            : new Date().toISOString();
    } else {
        deviceData.run_start = null;
    }

    // Log meaningful state-change events
    if (leakJustDetected) {
        logEvent(device_id, 'leak_detected', `Leak: ${deviceData.leak_type || 'unknown'}`, { leak_type: deviceData.leak_type, flow_rate: deviceData.flow_rate });
    }
    if (previousState && previousState.leak_status && !deviceData.leak_status) {
        logEvent(device_id, 'leak_resolved', 'Leak resolved');
    }
    if (previousState ? (previousState.flow_rate === 0 && deviceData.flow_rate > 0) : deviceData.flow_rate > 0) {
        logEvent(device_id, 'flow_started', `Flow: ${(deviceData.flow_rate || 0).toFixed(2)} L/min`, { flow_rate: deviceData.flow_rate });
    }
    if (previousState && previousState.flow_rate > 0 && deviceData.flow_rate === 0) {
        logEvent(device_id, 'flow_stopped', 'Flow stopped');
    }
    if (anomaly && !(previousState && previousState.anomaly)) {
        logEvent(device_id, 'anomaly', `Anomaly: ${anomaly.ratio}x baseline`, { flow_rate: deviceData.flow_rate, ratio: anomaly.ratio });
    }
    if (!anomaly && previousState && previousState.anomaly) {
        logEvent(device_id, 'anomaly_resolved', 'Anomaly resolved — flow returned to normal');
    }

    // Store/Update device state
    devices[device_id] = deviceData;

    // Append to history and persist
    if (!deviceHistory[device_id]) {
        deviceHistory[device_id] = [];
    }
    deviceHistory[device_id].push({ ...deviceData, timestamp: new Date().toISOString() });
    if (deviceHistory[device_id].length > MAX_HISTORY) {
        deviceHistory[device_id].shift();
    }
    saveHistory();

    console.log(`[DATA] ${device_id}: ${flow_rate} L/min | Valve: ${deviceData.valve_open ? 'OPEN' : 'CLOSED'} | Leak: ${deviceData.leak_status}${deviceData.leak_type !== 'none' ? ' (' + deviceData.leak_type + ')' : ''}`);

    // Send email alert on new leak detection
    if (leakJustDetected) {
        sendLeakEmail(deviceData);
    }

    // Broadcast to dashboard
    const alertType = leakJustDetected ? 'LEAK_DETECTED' : (anomaly ? 'ANOMALY' : null);
    broadcast({
        type: 'UPDATE',
        data: {
            ...deviceData,
            alert: alertType
        }
    });

    // Include desired valve state in response so ESP32 can enforce it
    // This gives the ESP32 a reliable command channel every 2 seconds
    const response = { status: 'OK' };
    if (valveOverrides[device_id]) {
        response.valve_open = valveOverrides[device_id].valve_open;
    }
    res.status(200).json(response);
});

// ═══════════════ ENDPOINT: Send command to device ═══════════════
app.post('/api/command', (req, res) => {
    const { device_id, command } = req.body;

    if (!device_id || !command) {
        return res.status(400).json({ error: 'device_id and command are required' });
    }

    const validCommands = ['VALVE_OPEN', 'VALVE_CLOSE', 'RESET_LEAK'];
    if (!validCommands.includes(command)) {
        return res.status(400).json({ error: `Invalid command. Valid: ${validCommands.join(', ')}` });
    }

    console.log(`[CMD] ${command} → ${device_id}`);

    if (command === 'VALVE_CLOSE') {
        logEvent(device_id, 'valve_closed', 'Valve manually closed');
    } else if (command === 'VALVE_OPEN') {
        logEvent(device_id, 'valve_opened', 'Valve manually opened');
    } else if (command === 'RESET_LEAK') {
        logEvent(device_id, 'leak_reset', 'Leak alarm manually reset');
    }

    // ── Set server-side valve override ──
    if (command === 'VALVE_CLOSE') {
        valveOverrides[device_id] = { valve_open: false, leak_status: false };
        // Snapshot current consumption to freeze it while valve is closed
        if (devices[device_id]) {
            consumptionSnapshots[device_id] = devices[device_id].total_consumption || 0;
        }
    } else if (command === 'VALVE_OPEN') {
        valveOverrides[device_id] = { valve_open: true, leak_status: false };
        // Release the consumption freeze
        delete consumptionSnapshots[device_id];
    } else if (command === 'RESET_LEAK') {
        // Clear leak alarm but keep valve in its current state
        const currentValveState = valveOverrides[device_id]
            ? valveOverrides[device_id].valve_open
            : (devices[device_id] ? devices[device_id].valve_open : true);
        valveOverrides[device_id] = { valve_open: currentValveState, leak_status: false };
    }

    // Update current device state immediately
    if (devices[device_id]) {
        if (command === 'VALVE_CLOSE') {
            devices[device_id].valve_open = false;
        } else if (command === 'VALVE_OPEN') {
            devices[device_id].valve_open = true;
            devices[device_id].leak_status = false;
            devices[device_id].water_loss = 0;
        } else if (command === 'RESET_LEAK') {
            devices[device_id].leak_status = false;
            devices[device_id].water_loss = 0;
        }

        // Broadcast updated state to all dashboards
        broadcast({
            type: 'UPDATE',
            data: { ...devices[device_id] }
        });
    }

    // Also broadcast COMMAND for the bridge to forward to ESP32
    broadcast({
        type: 'COMMAND',
        data: { device_id, command }
    });

    res.status(200).json({ status: 'OK', command, device_id });
});

// ═══════════════ ENDPOINT: Get all devices ═══════════════
app.get('/api/devices', (req, res) => {
    res.json(Object.values(devices));
});

// ═══════════════ ENDPOINT: Get device with history ═══════════════
app.get('/api/devices/:id', (req, res) => {
    const deviceId = req.params.id;
    const device = devices[deviceId];

    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }

    res.json({
        ...device,
        history: deviceHistory[deviceId] || []
    });
});

// ═══════════════ ENDPOINT: System summary ═══════════════
app.get('/api/summary', (req, res) => {
    const allDevices = Object.values(devices);

    const summary = {
        total_devices: allDevices.length,
        total_consumption: allDevices.reduce((sum, d) => sum + (d.total_consumption || 0), 0),
        total_water_loss: allDevices.reduce((sum, d) => sum + (d.water_loss || 0), 0),
        active_leaks: allDevices.filter(d => d.leak_status).length,
        devices: allDevices
    };

    res.json(summary);
});

// ═══════════════ ENDPOINT: Email alert settings ═══════════════
app.get('/api/settings', (req, res) => {
    // Return settings but mask the app password
    const safe = JSON.parse(JSON.stringify(appSettings));
    if (safe.email && safe.email.gmailAppPassword) {
        safe.email.gmailAppPassword = safe.email.gmailAppPassword ? '••••••••' : '';
    }
    res.json(safe);
});

app.post('/api/settings', (req, res) => {
    const { email } = req.body;
    if (email) {
        // Only update password if a real value was sent (not the masked one)
        if (email.gmailAppPassword === '••••••••') {
            email.gmailAppPassword = appSettings.email.gmailAppPassword;
        }
        appSettings.email = { ...appSettings.email, ...email };
    }
    saveSettings(appSettings);
    console.log(`[Settings] Email alerts ${appSettings.email.enabled ? 'ENABLED' : 'DISABLED'} → ${appSettings.email.recipient || '(no recipient)'}`);
    res.json({ status: 'OK' });
});

// ═══════════════ ENDPOINT: Baseline profile for a device ═══════════════
app.get('/api/baseline/:id', (req, res) => {
    const deviceId = req.params.id;
    const baseline = deviceBaselines[deviceId];

    if (!baseline) {
        return res.json({ device_id: deviceId, hours: {}, status: 'no_data' });
    }

    // Return hourly averages
    const hours = {};
    for (let h = 0; h < 24; h++) {
        const slot = baseline[String(h)];
        if (slot && slot.count > 0) {
            hours[h] = {
                avg_flow: parseFloat((slot.sum / slot.count).toFixed(2)),
                samples: slot.count
            };
        }
    }

    res.json({ device_id: deviceId, hours, status: 'ok' });
});

// ═══════════════ ENDPOINT: Daily/Weekly usage report (#3) ═══════════════
app.get('/api/report/:id', (req, res) => {
    const deviceId = req.params.id;
    const history = deviceHistory[deviceId];

    if (!history || history.length === 0) {
        return res.status(404).json({ error: 'No history for this device' });
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - 7);
    const prevWeekStart = new Date(weekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Bucket history entries by day
    const dailyBuckets = {};
    let todayUsage = 0, todayPeak = 0, todayLeaks = 0, todaySamples = 0;
    let yesterdayUsage = 0;
    let weekUsage = 0, weekLeaks = 0, weekPeak = 0;
    let prevWeekUsage = 0;
    let monthUsage = 0, monthLeaks = 0, monthPeak = 0;
    let prevMonthUsage = 0;

    history.forEach(entry => {
        const ts = new Date(entry.timestamp);
        const dayKey = ts.toISOString().split('T')[0];
        const flow = entry.flow_rate || 0;

        if (!dailyBuckets[dayKey]) {
            dailyBuckets[dayKey] = { total_flow: 0, peak_flow: 0, samples: 0, leaks: 0 };
        }
        dailyBuckets[dayKey].total_flow += flow;
        dailyBuckets[dayKey].peak_flow = Math.max(dailyBuckets[dayKey].peak_flow, flow);
        dailyBuckets[dayKey].samples += 1;
        if (entry.leak_status) dailyBuckets[dayKey].leaks += 1;

        // Today
        if (ts >= todayStart) {
            todayUsage += flow;
            todayPeak = Math.max(todayPeak, flow);
            todaySamples += 1;
            if (entry.leak_status) todayLeaks += 1;
        }

        // Yesterday
        if (ts >= yesterdayStart && ts < todayStart) {
            yesterdayUsage += flow;
        }

        // This week
        if (ts >= weekStart) {
            weekUsage += flow;
            weekPeak = Math.max(weekPeak, flow);
            if (entry.leak_status) weekLeaks += 1;
        }

        // Previous week
        if (ts >= prevWeekStart && ts < weekStart) {
            prevWeekUsage += flow;
        }

        // This month
        if (ts >= monthStart) {
            monthUsage += flow;
            monthPeak = Math.max(monthPeak, flow);
            if (entry.leak_status) monthLeaks += 1;
        }

        // Previous month
        if (ts >= prevMonthStart && ts < monthStart) {
            prevMonthUsage += flow;
        }
    });

    // Compute consumption from total_consumption field (last - first in range)
    const todayEntries = history.filter(e => new Date(e.timestamp) >= todayStart);
    const weekEntries = history.filter(e => new Date(e.timestamp) >= weekStart);

    function consumptionDelta(entries) {
        if (entries.length < 2) return 0;
        const first = entries[0].total_consumption || 0;
        const last = entries[entries.length - 1].total_consumption || 0;
        return Math.max(0, last - first);
    }

    const todayConsumption = consumptionDelta(todayEntries);
    const weekConsumption = consumptionDelta(weekEntries);
    const monthEntries = history.filter(e => new Date(e.timestamp) >= monthStart);
    const monthConsumption = consumptionDelta(monthEntries);

    // Trends (percentage change)
    const dailyTrend = yesterdayUsage > 0
        ? parseFloat((((todayUsage - yesterdayUsage) / yesterdayUsage) * 100).toFixed(1))
        : null;
    const weeklyTrend = prevWeekUsage > 0
        ? parseFloat((((weekUsage - prevWeekUsage) / prevWeekUsage) * 100).toFixed(1))
        : null;
    const monthlyTrend = prevMonthUsage > 0
        ? parseFloat((((monthUsage - prevMonthUsage) / prevMonthUsage) * 100).toFixed(1))
        : null;

    // Daily breakdown (last 7 days)
    const dailyBreakdown = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(todayStart);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        const bucket = dailyBuckets[key];
        dailyBreakdown.push({
            date: key,
            label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            avg_flow: bucket ? parseFloat((bucket.total_flow / bucket.samples).toFixed(2)) : 0,
            peak_flow: bucket ? parseFloat(bucket.peak_flow.toFixed(2)) : 0,
            samples: bucket ? bucket.samples : 0,
            leaks: bucket ? bucket.leaks : 0
        });
    }

    res.json({
        device_id: deviceId,
        generated_at: now.toISOString(),
        today: {
            consumption: parseFloat(todayConsumption.toFixed(3)),
            avg_flow: todaySamples > 0 ? parseFloat((todayUsage / todaySamples).toFixed(2)) : 0,
            peak_flow: parseFloat(todayPeak.toFixed(2)),
            leak_events: todayLeaks,
            trend_vs_yesterday: dailyTrend
        },
        week: {
            consumption: parseFloat(weekConsumption.toFixed(3)),
            avg_flow: weekEntries.length > 0 ? parseFloat((weekUsage / weekEntries.length).toFixed(2)) : 0,
            peak_flow: parseFloat(weekPeak.toFixed(2)),
            leak_events: weekLeaks,
            trend_vs_prev_week: weeklyTrend
        },
        month: {
            consumption: parseFloat(monthConsumption.toFixed(3)),
            avg_flow: monthEntries.length > 0 ? parseFloat((monthUsage / monthEntries.length).toFixed(2)) : 0,
            peak_flow: parseFloat(monthPeak.toFixed(2)),
            leak_events: monthLeaks,
            trend_vs_prev_month: monthlyTrend
        },
        daily_breakdown: dailyBreakdown
    });
});

app.post('/api/settings/test-email', (req, res) => {
    const { email } = appSettings;
    if (!email.recipient || !email.gmailUser || !email.gmailAppPassword) {
        return res.status(400).json({ error: 'Email settings are incomplete. Configure Gmail user, app password, and recipient first.' });
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: email.gmailUser, pass: email.gmailAppPassword }
    });

    transporter.sendMail({
        from: `"FlowGuard+ Alert" <${email.gmailUser}>`,
        to: email.recipient,
        subject: '✅ FlowGuard+ Test Alert',
        html: '<h2>FlowGuard+ Email Alert Test</h2><p>If you received this, email alerts are working correctly.</p><p style="color:#666;font-size:13px;">— FlowGuard+ Monitoring System</p>'
    }, (err) => {
        if (err) {
            console.error('[Email] Test failed:', err.message);
            res.status(500).json({ error: err.message });
        } else {
            console.log('[Email] Test email sent to', email.recipient);
            res.json({ status: 'OK', message: `Test email sent to ${email.recipient}` });
        }
    });
});

// ═══════════════ ENDPOINT: Event log for a device ═══════════════
app.get('/api/events/:id', (req, res) => {
    const deviceId = req.params.id;
    const events = deviceEvents[deviceId] || [];
    res.json({ device_id: deviceId, events: [...events].reverse() });
});

// ═══════════════ ENDPOINT: Demo — simulate a leak ═══════════════
app.post('/api/demo/simulate-leak', (req, res) => {
    const { device_id, leak_type = 'burst' } = req.body;

    const validLeakTypes = ['burst', 'prolonged', 'closed_valve'];
    if (!validLeakTypes.includes(leak_type)) {
        return res.status(400).json({ error: `Invalid leak_type. Valid: ${validLeakTypes.join(', ')}` });
    }

    // Pick the target device — use the first known device or a demo one
    const knownDevices = Object.keys(devices);
    const targetId = device_id || knownDevices[0] || 'demo-device-01';

    const flowRates = { burst: 12.5, prolonged: 3.8, closed_valve: 2.1 };
    const flowRate = flowRates[leak_type];

    const prevState = devices[targetId];

    const demoData = {
        device_id: targetId,
        flow_rate: flowRate,
        total_consumption: (prevState ? prevState.total_consumption || 0 : 0) + 0.05,
        leak_status: true,
        leak_type,
        water_loss: (prevState ? prevState.water_loss || 0 : 0) + flowRate * (2 / 60),
        valve_open: false,
        last_seen: new Date().toISOString(),
        run_start: prevState && prevState.run_start ? prevState.run_start : new Date().toISOString(),
        anomaly: null
    };

    devices[targetId] = demoData;

    if (!deviceHistory[targetId]) deviceHistory[targetId] = [];
    deviceHistory[targetId].push({ ...demoData, timestamp: new Date().toISOString() });
    if (deviceHistory[targetId].length > MAX_HISTORY) deviceHistory[targetId].shift();
    saveHistory();

    logEvent(targetId, 'leak_detected', `[DEMO] Leak: ${leak_type}`, { leak_type, flow_rate: flowRate });
    console.log(`[DEMO] Simulated ${leak_type} leak on ${targetId} @ ${flowRate} L/min`);

    sendLeakEmail(demoData);

    broadcast({
        type: 'UPDATE',
        data: { ...demoData, alert: 'LEAK_DETECTED' }
    });

    res.json({ status: 'OK', device_id: targetId, leak_type, flow_rate: flowRate });
});

// ═══════════════ ENDPOINT: Demo — resolve simulated leak ═══════════════
app.post('/api/demo/resolve-leak', (req, res) => {
    const { device_id } = req.body;
    const knownDevices = Object.keys(devices);
    const targetId = device_id || knownDevices[0];

    if (!targetId || !devices[targetId]) {
        return res.status(404).json({ error: 'No device to resolve' });
    }

    devices[targetId].leak_status = false;
    devices[targetId].leak_type = 'none';
    devices[targetId].flow_rate = 0;
    devices[targetId].water_loss = 0;
    devices[targetId].run_start = null;
    devices[targetId].last_seen = new Date().toISOString();

    logEvent(targetId, 'leak_resolved', '[DEMO] Leak resolved');
    console.log(`[DEMO] Resolved leak on ${targetId}`);

    broadcast({ type: 'UPDATE', data: { ...devices[targetId] } });
    res.json({ status: 'OK', device_id: targetId });
});

server.listen(port, () => {
    console.log('\n=====================================');
    console.log(`  FlowGuard+ Backend running on port ${port}`);
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log('=====================================\n');
});
