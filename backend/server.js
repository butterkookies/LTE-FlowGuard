const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// In-memory data store for devices
const devices = {};
// History store: { device_id: [ { ...data, timestamp }, ... ] } capped at 100
const deviceHistory = {};
const MAX_HISTORY = 100;

// ── Server-side valve state (overrides ESP32 reports) ──
// When a command is issued from the dashboard, we store it here.
// ESP32 data cannot override this — only another command can.
const valveOverrides = {};  // { device_id: { valve_open: bool, leak_status: bool } }

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
    const { device_id, flow_rate, total_consumption, leak_status, water_loss, valve_open } = req.body;

    if (!device_id) {
        return res.status(400).json({ error: 'device_id is required' });
    }

    // Build device data from ESP32 report
    const deviceData = {
        device_id,
        flow_rate,
        total_consumption,
        leak_status,
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

        // If valve was commanded closed, mark as leak and keep loss data
        if (!override.valve_open) {
            // Keep the ESP32's leak_status if it detected one, or mark based on command
            deviceData.leak_status = override.leak_status !== undefined
                ? override.leak_status
                : leak_status;
        } else {
            // Valve was commanded open = leak reset
            deviceData.leak_status = false;
            deviceData.water_loss = 0;
        }
    }

    // Check if leak status just changed (for alert notification)
    const previousState = devices[device_id];
    const leakJustDetected = deviceData.leak_status && (!previousState || !previousState.leak_status);

    // Store/Update device state
    devices[device_id] = deviceData;

    // Append to history
    if (!deviceHistory[device_id]) {
        deviceHistory[device_id] = [];
    }
    deviceHistory[device_id].push({ ...deviceData, timestamp: new Date().toISOString() });
    if (deviceHistory[device_id].length > MAX_HISTORY) {
        deviceHistory[device_id].shift();
    }

    console.log(`[DATA] ${device_id}: ${flow_rate} L/min | Valve: ${deviceData.valve_open ? 'OPEN' : 'CLOSED'} | Leak: ${deviceData.leak_status}`);

    // Broadcast to dashboard
    broadcast({
        type: 'UPDATE',
        data: {
            ...deviceData,
            alert: leakJustDetected ? 'LEAK_DETECTED' : null
        }
    });

    res.status(200).json({ status: 'OK' });
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

    // ── Set server-side valve override ──
    if (command === 'VALVE_CLOSE') {
        valveOverrides[device_id] = { valve_open: false };
    } else if (command === 'VALVE_OPEN') {
        valveOverrides[device_id] = { valve_open: true, leak_status: false };
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

server.listen(port, () => {
    console.log('\n=====================================');
    console.log(`  FlowGuard+ Backend running on port ${port}`);
    console.log(`  Dashboard: http://localhost:${port}`);
    console.log('=====================================\n');
});
