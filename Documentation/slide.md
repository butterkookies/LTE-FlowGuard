# FlowGuard+ IoT Conceptual Design Presentation (GEE-LTE Final Exam)

## Enhanced Prompt (Reusable)
Use this improved prompt if you need to regenerate or refine this deck:

"Create a 10-15 minute IoT conceptual design presentation for our project FlowGuard+. Follow the GEE-LTE criteria exactly: Introduction, Problem Statement, Proposed IoT Solution, System Architecture, Components and Technologies, Data Flow Process, Wireframing, Use Case Scenario, Advantages and Innovation, Limitations and Challenges, Future Improvements, and Conclusion. Make the content specific to our existing implementation (ESP32 firmware, serial bridge, Node.js backend, WebSocket dashboard, leak detection logic, and valve control). Include slide-by-slide titles, complete bullet content, and concise speaker notes. Prioritize feasibility, practical architecture, and innovation to maximize rubric score."

---

## Slide 1 - Title and Team Introduction
**Title:** FlowGuard+ - Smart IoT Water Leak Detection and Automatic Shutoff System

**Slide Content:**
- Course: GEE-LTE (Living in the IT Era)
- Final Exam: IoT Conceptual Design Presentation
- Project Name: FlowGuard+
- Tagline: Real-time leak detection, alerting, and automatic water valve control
- Group Members: (Member 1), (Member 2)
- Date: April 2026

**Speaker Notes:**
Good day. We are presenting FlowGuard+, an IoT-based smart water monitoring and safety system. It detects abnormal water flow, sends alerts, and can automatically or remotely close a valve to reduce water waste and property damage.

---

## Slide 2 - Introduction
**Title:** Why Smart Water Monitoring Matters

**Slide Content:**
- Household and facility leaks often go unnoticed for hours
- Traditional monitoring is manual and reactive
- Unattended leaks increase:
	- Water bill cost
	- Water wastage
	- Structural/property damage risk
- IoT enables continuous sensing + immediate response

**Speaker Notes:**
Water leaks are common but often discovered too late. A manual approach cannot provide 24/7 observation. FlowGuard+ uses connected sensing and automation to shift from reactive repair to proactive prevention.

---

## Slide 3 - Problem Statement
**Title:** Real-World Problem We Address

**Slide Content:**
- Problem: Delayed detection of abnormal water flow in homes/buildings
- Core pain points:
	- No real-time visibility of flow per zone
	- No automated shutoff during critical leaks
	- Weak alerting if user is not watching manually
- Impact:
	- Higher utility cost
	- Water resource waste
	- Potential flooding and safety hazards

**Speaker Notes:**
Our problem is specific and highly relevant: people cannot monitor every faucet and pipeline all the time. A practical system should detect issues in real time and respond even before a person intervenes.

---

## Slide 4 - Proposed IoT Solution
**Title:** FlowGuard+ Conceptual Solution

**Slide Content:**
- Distributed ESP32-based monitoring nodes per water zone
- Continuous flow sensing and leak classification:
	- Burst leak (sudden high flow)
	- Prolonged leak (continuous long duration)
	- Closed-valve leak (flow while valve is closed)
- Automated local shutoff via servo valve for critical cases
- Remote control + live dashboard + alert notifications
- Historical logging + baseline profiling for anomaly detection

**Speaker Notes:**
FlowGuard+ combines on-device safety logic and cloud-connected visibility. The firmware can react immediately, while the backend and dashboard support remote operations, analytics, and long-term improvements.

---

## Slide 5 - System Architecture
**Title:** End-to-End Architecture

**Slide Content:**
- Layer 1: Edge Device (ESP32 firmware)
	- Reads flow sensor
	- Executes leak logic
	- Controls valve servo
- Layer 2: Bridge Service (Node serial bridge)
	- Converts Wokwi/serial telemetry to HTTP
	- Forwards backend commands to device
- Layer 3: Backend API + WebSocket (Node.js/Express)
	- Receives telemetry
	- Stores history/baseline
	- Broadcasts real-time updates
	- Manages valve override commands
- Layer 4: Web Dashboard (frontend)
	- Device table and status
	- Alerts and control buttons
	- Reports and trend views

**Speaker Notes:**
The design is modular. If one layer changes, others can remain stable through APIs and message contracts. This supports scalability from one device to multiple zones.

---

## Slide 6 - Components and Technologies
**Title:** Hardware and Software Stack

**Slide Content:**
- Hardware/Embedded:
	- ESP32 Dev Board
	- Flow sensor input (simulated in Wokwi via potentiometer)
	- Servo motor for shutoff valve
	- Status LEDs
- Firmware Libraries:
	- ArduinoJson
	- ESP32Servo
	- WiFi + HTTPClient
- Backend:
	- Node.js + Express + WebSocket
	- CORS, Nodemailer (email alerts)
	- JSON-based persistence (history, baselines, settings)
- Frontend:
	- HTML/CSS/JavaScript dashboard
	- Real-time status cards and charting

**Speaker Notes:**
We selected technologies that are realistic for student projects and practical for real deployment. ESP32 is low-cost and capable. Node.js handles real-time data efficiently.

---

## Slide 7 - Data Flow Process
**Title:** How Data Moves Through the System

**Slide Content:**
1. ESP32 samples flow signal every second
2. Firmware computes flow rate and total consumption
3. Leak detection logic determines status and leak type
4. Telemetry JSON sent every 2 seconds to backend API
5. Backend updates current state + stores history
6. Backend checks anomaly against hourly baseline
7. Backend pushes real-time updates via WebSocket
8. Dashboard renders status and notifies user
9. User command (open/close/reset) sent to backend
10. Backend broadcasts command, bridge forwards to ESP32

**Speaker Notes:**
The process is bidirectional: sensor data goes up to the dashboard, and control commands go down to the valve. This closes the loop between monitoring and action.

---

## Slide 8 - Wireframing (Dashboard Layout)
**Title:** UI Wireframe and Screen Zones

**Slide Content:**
- Header Area:
	- System name
	- Live connection status
- Summary Cards:
	- Total water usage
	- Active devices
	- Active leaks
	- Estimated water loss
- Main Device Table:
	- Device name
	- Status badge (Normal, Leak type, Anomaly, Offline)
	- Flow, usage, loss, valve state
	- Action buttons (Shut Off / Reopen / Reset)
- Detail Panel (on row click):
	- Historical flow chart
	- Daily/weekly report
	- Baseline profile chart
	- Per-device control section

**Speaker Notes:**
Our wireframe emphasizes quick decision-making. Users can detect problems in one glance and execute valve control immediately from either the table or detailed panel.

---

## Slide 9 - Use Case Scenario
**Title:** Scenario: Bathroom Leak Event

**Slide Content:**
- Step 1: Bathroom faucet remains open unexpectedly
- Step 2: Device reports continuous high flow
- Step 3: Firmware detects prolonged/burst condition
- Step 4: Valve closes automatically to reduce damage
- Step 5: Backend marks leak event and sends alert
- Step 6: Dashboard shows critical leak badge
- Step 7: User checks panel and reopens valve after fix

**Speaker Notes:**
This scenario demonstrates full lifecycle behavior: detect, classify, act, notify, and recover. It reflects our project simulation flow where one zone leaks while others remain normal.

---

## Slide 10 - Advantages and Innovation
**Title:** Strengths and Novel Features

**Slide Content:**
- Practical multi-zone monitoring using device IDs
- Leak type intelligence (not just binary leak/no-leak)
- Automatic + remote valve control for rapid response
- Real-time dashboard with live WebSocket updates
- Baseline anomaly detection by hour-of-day behavior
- Daily/weekly usage report for data-driven conservation
- Email alert integration for unattended monitoring

**Speaker Notes:**
Our innovation is not a single sensor, but a full IoT decision chain: interpretation, response, and user control. This improves originality and practical impact under the grading rubric.

---

## Slide 11 - Feasibility and Practicality
**Title:** Why This Design Is Realistic

**Slide Content:**
- Uses affordable and available components (ESP32 + servo)
- Modular architecture supports incremental deployment
- Local safety logic still works even with temporary backend issues
- Persistent storage for historical analysis is already implemented
- Current prototype tested in simulation and multi-device scenarios
- Can be adapted for homes, dorms, and small facilities

**Speaker Notes:**
FlowGuard+ is feasible because it avoids expensive proprietary infrastructure. It can start with one zone and expand gradually as budget permits.

---

## Slide 12 - Limitations and Challenges
**Title:** Current Constraints

**Slide Content:**
- Simulation-first setup; physical calibration still required
- Sensor noise can cause false positives without tuning
- Dependence on stable network for cloud sync and remote control
- Email/SMS alert reliability depends on external providers
- Security hardening (auth, encryption, role access) needs expansion
- Maintenance needed for valves and sensor longevity

**Speaker Notes:**
We recognize practical challenges. Honest limitations help us present a credible design and prepare for technical questions during Q&A.

---

## Slide 13 - Future Improvements
**Title:** Next Development Roadmap

**Slide Content:**
- Mobile app notifications (push, Telegram, SMS)
- Better ML-style anomaly prediction beyond static thresholds
- Smart cost estimation (local utility tariff integration)
- Auto-generated monthly conservation insights
- OTA firmware updates for easier device maintenance
- Security upgrades:
	- Device authentication tokens
	- Encrypted transport (TLS)
	- Role-based command permissions

**Speaker Notes:**
Future work focuses on reliability, analytics, and security. These upgrades transition FlowGuard+ from strong prototype to production-ready IoT solution.

---

## Slide 14 - Conclusion
**Title:** Key Takeaways

**Slide Content:**
- FlowGuard+ addresses a real and relevant water safety problem
- Delivers complete conceptual IoT architecture from edge to dashboard
- Demonstrates practical automation through valve shutoff and remote control
- Supports sustainability by reducing water waste and cost
- Project is feasible today and scalable for broader deployment

**Speaker Notes:**
In summary, FlowGuard+ proves that a student-built IoT system can be both innovative and practical. It combines monitoring, analytics, and immediate action to protect water resources and property.

---

## Slide 15 - Q&A Backup (Optional)
**Title:** Prepared Answers for Panel Questions

**Slide Content:**
- Why ESP32? Low cost, Wi-Fi capable, sufficient for edge logic
- How do you avoid false alarms? Threshold tuning + baseline anomaly profile
- What if internet is down? Device still performs local leak logic and valve actuation
- Can this scale? Yes, architecture supports many device IDs and zones
- What is the biggest risk? Sensor calibration and long-term hardware reliability

**Speaker Notes:**
Use this backup slide if the panel asks technical questions. Keep answers concise and evidence-based from your implementation.

---

## Suggested Timing (10-15 Minutes)
- Slide 1: 0:45
- Slide 2-4: 2:30
- Slide 5-7: 3:30
- Slide 8-9: 2:00
- Slide 10-13: 3:30
- Slide 14-15: 1:30

Total: ~13:45
