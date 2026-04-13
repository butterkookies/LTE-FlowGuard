# Project TODO Roadmap

**Project:** FlowGuard+ — Simulated IoT + Real Web System Hybrid  
**Architecture:** Distributed device nodes (ESP32) → Node.js Backend → Web Dashboard  
**Simulation:** Wokwi extension in VS Code

---

## Phase 1: Environment Setup

### Task 1.1: Install VS Code Extensions
- Action: Install PlatformIO IDE and Wokwi Simulator extensions in VS Code
- Purpose: PlatformIO provides the ESP32 toolchain and build system; Wokwi enables in-editor IoT simulation without physical hardware
- Outcome: Both extensions are installed and visible in the VS Code sidebar
- Dependencies: None

### Task 1.2: Initialize PlatformIO ESP32 Project
- Action: Create a new PlatformIO project with board `esp32dev` and framework `arduino` inside a `firmware/` directory at the project root
- Purpose: Sets up the build environment, folder structure (`src/`, `lib/`, `include/`), and `platformio.ini` for ESP32 development
- Outcome: `firmware/platformio.ini` exists with `[env:esp32dev]` configured; `firmware/src/main.cpp` contains an empty `setup()` and `loop()`
- Dependencies: Task 1.1

### Task 1.3: Create Wokwi Configuration File
- Action: Create `firmware/wokwi.toml` with `[wokwi]` section pointing to `firmware = "..."` and `elf = "..."` build output paths
- Purpose: Tells the Wokwi extension where to find the compiled firmware for simulation
- Outcome: Wokwi can locate and load the compiled ESP32 binary
- Dependencies: Task 1.2

### Task 1.4: Create Initial Wokwi Circuit Diagram
- Action: Create `firmware/diagram.json` with a single ESP32 component and no peripherals yet
- Purpose: Defines the virtual hardware layout; starting minimal ensures the simulation boots before adding sensors
- Outcome: Running "Wokwi: Start Simulator" launches an ESP32 that prints to Serial Monitor
- Dependencies: Task 1.3

---

## Phase 2: IoT Simulation Layer (Wokwi)

### Task 2.1: Add Flow Sensor to Circuit Diagram
- Action: In `firmware/diagram.json`, add a pulse-based flow sensor (simulated using a potentiometer or digital input to generate pulses) connected to ESP32 GPIO pin (e.g., GPIO 34)
- Purpose: Simulates a YF-S201 water flow sensor; pulse frequency represents flow rate
- Outcome: The diagram shows an ESP32 with an input component wired to a GPIO pin
- Dependencies: Task 1.4

### Task 2.2: Add Servo Motor to Circuit Diagram
- Action: In `firmware/diagram.json`, add a servo motor component connected to ESP32 GPIO pin (e.g., GPIO 13)
- Purpose: Simulates the automatic faucet shutoff valve; servo position 0° = open, 90° = closed
- Outcome: The diagram shows an ESP32 with both a flow sensor input and a servo actuator
- Dependencies: Task 2.1

### Task 2.3: Implement Flow Rate Measurement in Firmware
- Action: In `firmware/src/main.cpp`, write interrupt-based pulse counting on the flow sensor GPIO pin. In `loop()`, calculate flow rate (L/min) and cumulative consumption (L) every 1 second using the formula: `flowRate = (pulseCount / calibrationFactor)`
- Purpose: Converts raw sensor pulses into meaningful water usage data
- Outcome: Serial Monitor prints `flow_rate` and `total_consumption` values every second
- Dependencies: Task 2.1

### Task 2.4: Implement Leak Detection Logic
- Action: In `firmware/src/main.cpp`, add threshold-based leak detection: if `flow_rate > 0` continuously for more than `LEAK_THRESHOLD_SECONDS` (e.g., 30 seconds) without dropping to 0, set `leak_status = true` and calculate `water_loss`
- Purpose: Detects abnormal continuous water flow that indicates a leak
- Outcome: When simulated flow exceeds the time threshold, Serial Monitor prints `LEAK DETECTED` and `water_loss` value
- Dependencies: Task 2.3

### Task 2.5: Implement Automatic Shutoff via Servo
- Action: In `firmware/src/main.cpp`, when `leak_status == true`, rotate the servo to 90° (closed position). When leak is manually reset, rotate back to 0° (open)
- Purpose: Provides automatic per-node valve shutoff — only the affected faucet closes, others remain operational
- Outcome: Servo visually moves in Wokwi when a leak is detected; stops when reset
- Dependencies: Task 2.2, Task 2.4

### Task 2.6: Implement WiFi Data Transmission
- Action: In `firmware/src/main.cpp`, use the ESP32 WiFi library to send JSON payloads via HTTP POST to `http://<backend-ip>:3000/api/data` every 2 seconds. Payload format: `{ "device_id": "kitchen", "flow_rate": 1.5, "total_consumption": 120.0, "leak_status": false, "water_loss": 0.0 }`
- Purpose: Bridges the simulated IoT device to the real web backend
- Outcome: With Wokwi's virtual WiFi, the ESP32 sends JSON data to the backend server endpoint
- Dependencies: Task 2.3, Task 2.4

---

## Phase 3: Backend / API Layer

### Task 3.1: Initialize Node.js Backend Project
- Action: Create a `backend/` directory at the project root. Run `npm init -y` inside it. Install dependencies: `npm install express cors ws`
- Purpose: Sets up the backend runtime with Express for REST API, CORS for cross-origin dashboard access, and `ws` for WebSocket real-time push
- Outcome: `backend/package.json` exists with all dependencies listed
- Dependencies: None (can be done in parallel with Phase 2)

### Task 3.2: Create Express Server with Data Ingestion Endpoint
- Action: Create `backend/server.js`. Set up Express on port 3000. Create `POST /api/data` endpoint that accepts JSON body `{ device_id, flow_rate, total_consumption, leak_status, water_loss }`, validates fields, and stores the data in an in-memory object keyed by `device_id`
- Purpose: Receives telemetry from each ESP32 device node and maintains current state
- Outcome: Sending a POST request with valid JSON returns `200 OK` and the data is stored in memory
- Dependencies: Task 3.1

### Task 3.3: Create Device Query Endpoints
- Action: In `backend/server.js`, add: (1) `GET /api/devices` — returns an array of all device states with their latest data; (2) `GET /api/devices/:id` — returns detailed data for a single device including history
- Purpose: Allows the frontend dashboard to fetch current and historical device data
- Outcome: GET requests return JSON arrays/objects with correct device data
- Dependencies: Task 3.2

### Task 3.4: Add WebSocket Server for Real-Time Updates
- Action: In `backend/server.js`, create a WebSocket server on the same HTTP server. When `POST /api/data` receives new data, broadcast the updated device state to all connected WebSocket clients as JSON
- Purpose: Enables the dashboard to receive live updates without polling
- Outcome: WebSocket clients connected to `ws://localhost:3000` receive real-time device data on every POST
- Dependencies: Task 3.2

### Task 3.5: Add Data History and Aggregation Logic
- Action: In `backend/server.js`, maintain a time-stamped history array per device (capped at 100 entries). Add `GET /api/summary` endpoint that returns: `total_consumption` (sum all devices), `total_water_loss` (sum all devices), `active_leaks` (count of devices with `leak_status: true`), and per-device breakdown
- Purpose: Provides aggregated data for the dashboard's overall summary view
- Outcome: `GET /api/summary` returns a complete system overview JSON object
- Dependencies: Task 3.3

---

## Phase 4: Frontend / Web Dashboard

### Task 4.1: Create Dashboard HTML Structure
- Action: Create `frontend/` directory at project root. Create `frontend/index.html` with semantic HTML5 structure: header with project title, summary cards section (Total Usage, Total Loss, Active Leaks), device table section, and a drill-down detail panel (initially hidden)
- Purpose: Establishes the page layout and element IDs that JavaScript will populate
- Outcome: Opening `index.html` in a browser shows the empty dashboard skeleton
- Dependencies: None (can be done in parallel with Phase 3)

### Task 4.2: Style the Dashboard with CSS
- Action: Create `frontend/styles.css`. Implement a modern dark-theme design with: card-based summary widgets with icons, a responsive device table with color-coded status indicators (green = normal, red = leak), a slide-in detail panel, and smooth transitions/animations
- Purpose: Creates a professional, visually clear monitoring interface suitable for academic presentation
- Outcome: The dashboard looks polished with clear visual hierarchy and status indicators
- Dependencies: Task 4.1

### Task 4.3: Implement Real-Time Data Rendering with JavaScript
- Action: Create `frontend/app.js`. On page load, connect to `ws://localhost:3000` via WebSocket. On each message, parse the JSON and update: summary cards (total consumption, total loss, active leaks), device table rows (one row per device with status, consumption, leak indicator)
- Purpose: Makes the dashboard live — data updates automatically without page refresh
- Outcome: When the backend broadcasts new data, the dashboard updates within 1 second
- Dependencies: Task 4.1, Task 4.2, Task 3.4

### Task 4.4: Implement Device Drill-Down View
- Action: In `frontend/app.js`, add click handler on each device table row. On click, fetch `GET /api/devices/:id` and display a detail panel showing: real-time flow rate, daily/weekly consumption (from history), leak event history, water loss estimation
- Purpose: Allows users to inspect individual device nodes as specified in `prompt.md` Section 3C
- Outcome: Clicking "Kitchen" in the table opens a panel with Kitchen-specific data and charts
- Dependencies: Task 4.3, Task 3.3

### Task 4.5: Add Visual Alerts for Leak Events
- Action: In `frontend/app.js`, when a device's `leak_status` is `true`: flash the device row red, show a toast notification at the top of the page with the device name and "LEAK DETECTED", and play a subtle CSS animation on the summary "Active Leaks" card
- Purpose: Ensures leak events are immediately noticeable to the user
- Outcome: Leak scenarios produce visible, attention-grabbing alerts on the dashboard
- Dependencies: Task 4.3

---

## Phase 5: Integration and Testing

### Task 5.1: Configure Wokwi Virtual WiFi to Reach Backend
- Action: Ensure the Wokwi simulation's ESP32 can reach `localhost:3000`. If Wokwi's virtual WiFi doesn't support localhost, create a `bridge/serial-bridge.js` script that reads Serial output from Wokwi and forwards it as HTTP POST requests to the backend
- Purpose: Establishes the critical link between simulated IoT and the real web system
- Outcome: Data flows from Wokwi ESP32 → Backend → Dashboard without manual intervention
- Dependencies: Task 2.6, Task 3.2

### Task 5.2: Multi-Device Simulation Test
- Action: Duplicate the firmware configuration to simulate 3 devices with different `device_id` values: `kitchen`, `bathroom`, `laundry`. Run all three in Wokwi (or sequentially with different IDs). Verify the dashboard shows all 3 devices in the table with independent data
- Purpose: Validates the distributed architecture — multiple nodes reporting to one central system
- Outcome: Dashboard shows 3 device rows with different consumption values
- Dependencies: Task 5.1, Task 4.3

### Task 5.3: Leak Detection End-to-End Test
- Action: In one device simulation (e.g., `bathroom`), trigger continuous flow beyond the leak threshold. Verify: (1) ESP32 sends `leak_status: true`, (2) servo rotates to closed, (3) backend updates state, (4) dashboard shows leak alert for Bathroom only, (5) Kitchen and Laundry remain unaffected
- Purpose: Validates the per-node leak isolation feature — the key innovation of the system
- Outcome: Only the Bathroom row turns red; other devices continue normal operation
- Dependencies: Task 5.2

### Task 5.4: Full System Stress and Edge Case Test
- Action: Test edge cases: (1) device goes offline — dashboard shows stale data indicator, (2) rapid data bursts — backend handles concurrent POSTs, (3) all devices leak simultaneously — dashboard shows 3 active leaks, (4) device recovery — leak clears and servo reopens
- Purpose: Ensures system robustness for demo and defense scenarios
- Outcome: All edge cases handled gracefully without crashes or incorrect data
- Dependencies: Task 5.3

---

## Phase 6: Documentation and Presentation

### Task 6.1: Create System Architecture Diagram
- Action: Create `Documentation/architecture.md` with a Mermaid diagram showing: 3 ESP32 nodes → HTTP/WiFi → Node.js Backend → WebSocket → Web Dashboard. Include data flow labels and component descriptions
- Purpose: Visual representation of the system for the PPT and defense
- Outcome: A clear, presentation-ready architecture diagram exists
- Dependencies: Task 5.3

### Task 6.2: Document System Flow with IPO Mapping
- Action: Create `Documentation/system-flow.md` with the Input → Process → Output mapping for each system interaction (normal usage, leak detection, recovery) and a Mermaid flowchart as specified in `flow-prompt.md`
- Purpose: Demonstrates understanding of the system behavior for academic evaluation
- Outcome: Complete system flow document with IPO steps and matching Mermaid diagram
- Dependencies: Task 6.1

### Task 6.3: Prepare PowerPoint Outline
- Action: Create `Documentation/ppt-outline.md` with a slide-by-slide outline: Title → Problem Statement → System Architecture → Components → Demo Flow → Results → Conclusion. Include notes on what to demo live
- Purpose: Structures the academic presentation for defense
- Outcome: A complete PPT outline ready to be converted into actual slides
- Dependencies: Task 6.1, Task 6.2

---

## Assumptions (Explicit)

1. **Wokwi WiFi**: Wokwi's ESP32 virtual WiFi can reach localhost. If not, a Serial-to-HTTP bridge script will be used as fallback (Task 5.1)
2. **Device Count**: Three nodes — Kitchen, Bathroom, Laundry — as specified in `prompt.md`
3. **Leak Detection**: Threshold-based logic (continuous flow > 30 seconds = leak). No ML or advanced anomaly detection
4. **No Authentication**: Dashboard is open; no login system required for academic scope
5. **In-Memory Storage**: No persistent database; data resets on server restart. Sufficient for simulation and demo purposes
6. **Single Machine**: All components (Wokwi, backend, frontend) run on the same development machine
