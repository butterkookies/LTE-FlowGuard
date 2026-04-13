/**
 * FlowGuard+ Multi-Device Simulator
 * 
 * Simulates 3 ESP32 devices sending telemetry to the backend.
 * Demonstrates the full pipeline: normal flow → leak detection → recovery.
 * 
 * Usage:
 *   node test/simulate-devices.js
 * 
 * Scenario timeline:
 *   0-8s   : All 3 devices report normal flow
 *   8-18s  : Bathroom flow spikes (simulating continuous use → leak)
 *   18s    : Bathroom leak detected! Valve shuts off.
 *   24s    : Bathroom leak resolved — flow stops, valve reopens.
 *   24s+   : All devices return to normal.
 */

const http = require('http');

const BACKEND_URL = 'http://localhost:3000/api/data';

// Device definitions
const devices = [
    { device_id: 'kitchen-sink-01', baseFlow: 1.2, totalConsumption: 0 },
    { device_id: 'bathroom-01', baseFlow: 0.8, totalConsumption: 0 },
    { device_id: 'laundry-01', baseFlow: 2.5, totalConsumption: 0 },
];

let tick = 0;
const TICK_INTERVAL_MS = 2000;

function sendData(device, flowRate, leakStatus) {
    device.totalConsumption += flowRate / 60.0 * (TICK_INTERVAL_MS / 1000);
    const waterLoss = leakStatus ? (flowRate * 0.5) : 0;

    const payload = JSON.stringify({
        device_id: device.device_id,
        flow_rate: parseFloat(flowRate.toFixed(2)),
        total_consumption: parseFloat(device.totalConsumption.toFixed(3)),
        leak_status: leakStatus,
        water_loss: parseFloat(waterLoss.toFixed(2)),
    });

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
        // silently consume response
        res.resume();
    });
    req.on('error', (err) => {
        process.stderr.write(`[ERROR] ${device.device_id}: ${err.message}\n`);
    });
    req.write(payload);
    req.end();
}

function simulate() {
    const elapsedSec = tick * (TICK_INTERVAL_MS / 1000);

    console.log(`\n[T=${elapsedSec.toFixed(0)}s] ────────────────────────────`);

    devices.forEach(device => {
        let flowRate, leakStatus;

        if (device.device_id === 'bathroom-01') {
            // Bathroom scenario: normal → spike → leak → recovery
            if (elapsedSec < 8) {
                // Normal flow
                flowRate = device.baseFlow + (Math.random() * 0.3 - 0.15);
                leakStatus = false;
            } else if (elapsedSec < 18) {
                // Continuous high flow (building toward leak threshold)
                flowRate = 4.5 + (Math.random() * 1.0);
                leakStatus = false;
            } else if (elapsedSec < 24) {
                // LEAK DETECTED — valve closed but water still measured
                flowRate = 5.2 + (Math.random() * 0.5);
                leakStatus = true;
            } else {
                // Recovery — leak resolved, flow drops to 0
                flowRate = 0;
                leakStatus = false;
            }
        } else {
            // Normal devices: slight random variation
            flowRate = device.baseFlow + (Math.random() * 0.4 - 0.2);
            if (flowRate < 0) flowRate = 0;
            leakStatus = false;
        }

        const status = leakStatus ? '🚨 LEAK' : '✓ OK';
        console.log(`  ${device.device_id.padEnd(20)} | ${flowRate.toFixed(2)} L/min | ${status}`);

        sendData(device, flowRate, leakStatus);
    });

    tick++;

    // Stop after 30 seconds of simulation
    if (elapsedSec >= 30) {
        console.log('\n═══════════════════════════════════');
        console.log('  Simulation complete.');
        console.log('  Bathroom: normal → leak → recovery');
        console.log('  Kitchen & Laundry: normal throughout');
        console.log('═══════════════════════════════════\n');
        clearInterval(interval);
    }
}

// Start
console.log('═══════════════════════════════════════════');
console.log('  FlowGuard+ Multi-Device Simulator');
console.log('  3 devices / 30-second scenario');
console.log('  Backend: ' + BACKEND_URL);
console.log('═══════════════════════════════════════════');

const interval = setInterval(simulate, TICK_INTERVAL_MS);
simulate(); // Run first tick immediately
