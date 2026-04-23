/**
 * FlowGuard+ Serial-to-HTTP Bridge (Bidirectional)
 * 
 * Connects to Wokwi's RFC2217 serial port (TCP) and:
 *   - Forwards ESP32 sensor data TO the backend (serial → HTTP POST)
 *   - Forwards dashboard commands TO the ESP32 (WebSocket → serial)
 * 
 * Usage:
 *   1. Start backend: node backend/server.js
 *   2. Start this bridge: node bridge/serial-bridge.js
 *   3. Start Wokwi simulator in VS Code
 *   4. Open http://localhost:3000
 */

const net = require('net');
const http = require('http');
const WebSocket = require('ws');

const WOKWI_SERIAL_PORT = 4000;
const BACKEND_URL = 'http://localhost:3000/api/data';
const WS_URL = 'ws://localhost:3000';
const RECONNECT_DELAY_MS = 3000;

let serialClient = null;
let wsClient = null;
let buffer = '';
let postCount = 0;

// ═══════════════ SERIAL → BACKEND (sensor data) ═══════════════

function postToBackend(jsonData) {
    const payload = JSON.stringify(jsonData);

    const url = new URL(BACKEND_URL);
    const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    };

    const req = http.request(options, (res) => {
        postCount++;
        res.resume();
        const valve = jsonData.valve_open !== undefined
            ? (jsonData.valve_open ? '🟢 OPEN' : '🔴 CLOSED')
            : '';
        process.stdout.write(
            `\r  [✓] #${postCount} | ${jsonData.flow_rate.toFixed(2)} L/min | ` +
            `${jsonData.leak_status ? '🚨 LEAK' : '✓ OK'} | Valve: ${valve}     `
        );
    });

    req.on('error', (err) => {
        console.error(`\n  [✗] POST failed: ${err.message}`);
    });

    req.write(payload);
    req.end();
}

function processLine(line) {
    const match = line.match(/\$\$JSON:(\{.*\})\$\$/);
    if (match) {
        try {
            const data = JSON.parse(match[1]);
            postToBackend(data);
        } catch (e) {
            // Skip malformed JSON
        }
    }
}

// ═══════════════ BACKEND → SERIAL (valve commands) ═══════════════

function connectWebSocket() {
    console.log('  [WS] Connecting to backend WebSocket...');

    wsClient = new WebSocket(WS_URL);

    wsClient.on('open', () => {
        console.log('  [WS] ✅ Connected to backend — listening for commands\n');
    });

    wsClient.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());

            if (msg.type === 'COMMAND' && msg.data) {
                const { device_id, command } = msg.data;
                const serialCmd = `$$CMD:${command}$$\n`;

                console.log(`\n  [CMD] Received: ${command} → ${device_id}`);

                // Forward command to ESP32 via serial
                if (serialClient && !serialClient.destroyed) {
                    serialClient.write(serialCmd);
                    console.log(`  [CMD] Sent to ESP32: ${serialCmd.trim()}`);
                } else {
                    console.log('  [CMD] ⚠ Serial not connected, command dropped');
                }
            }
        } catch (e) {
            // Ignore non-JSON messages
        }
    });

    wsClient.on('close', () => {
        console.log('\n  [WS] Disconnected. Reconnecting in 3s...');
        setTimeout(connectWebSocket, RECONNECT_DELAY_MS);
    });

    wsClient.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.log('  [WS] Backend not running. Retrying in 3s...');
        }
        // Don't reconnect here — 'close' event will handle it
    });
}

// ═══════════════ SERIAL CONNECTION ═══════════════

function connectSerial() {
    console.log(`  [Serial] Connecting to Wokwi on localhost:${WOKWI_SERIAL_PORT}...`);

    serialClient = new net.Socket();

    serialClient.connect(WOKWI_SERIAL_PORT, 'localhost', () => {
        console.log('  [Serial] ✅ Connected to Wokwi!');
        console.log('  [Serial] Turn the potentiometer to see data flow.\n');
        buffer = '';
    });

    serialClient.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
            processLine(line.trim());
        }
    });

    serialClient.on('close', () => {
        console.log('\n\n  [Serial] ⚠ Connection closed. Reconnecting in 3s...');
        setTimeout(connectSerial, RECONNECT_DELAY_MS);
    });

    serialClient.on('error', (err) => {
        if (err.code === 'ECONNREFUSED') {
            console.log('  [Serial] ⚠ Wokwi not running. Retrying in 3s...');
            console.log('           (Press F1 → "Wokwi: Start Simulator")');
        } else {
            console.log(`  [Serial] ⚠ Error: ${err.message}`);
        }
        // Don't reconnect here — 'close' event will handle it
    });
}

// ═══════════════ START ═══════════════

console.log('\n╔═══════════════════════════════════════════════╗');
console.log('║  FlowGuard+ Bidirectional Serial Bridge       ║');
console.log('╠═══════════════════════════════════════════════╣');
console.log(`║  Serial (Wokwi):  localhost:${WOKWI_SERIAL_PORT}               ║`);
console.log(`║  Backend:         ${BACKEND_URL}  ║`);
console.log(`║  WebSocket:       ${WS_URL}             ║`);
console.log('╠═══════════════════════════════════════════════╣');
console.log('║  Data: Wokwi → Bridge → Backend → Dashboard  ║');
console.log('║  Cmds: Dashboard → Backend → Bridge → Wokwi  ║');
console.log('╚═══════════════════════════════════════════════╝\n');

connectWebSocket();
connectSerial();
