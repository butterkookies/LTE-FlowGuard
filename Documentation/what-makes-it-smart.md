What makes it smart

  A dumb system compares flow against a fixed threshold: "if flow > 10 L/min, it's a leak." That fails
  immediately — a garden hose and a burst pipe have different normals.

  FlowGuard instead learns what normal looks like per device, per hour of the day, then flags deviations from
  that learned normal. It answers: "Is this flow abnormal for this location, right now?"

  ---
  The tools and approach

  1. Per-device, per-hour baseline profiling
  - In server.js: deviceBaselines[deviceId][hour] = { sum, count }
  - Every data report from the ESP32 updates a rolling average for that device's current hour slot (0–23)
  - Over time this builds a 24-slot usage fingerprint per device: kitchen sink at 2am should be near zero;
  garden hose at 6pm might be 4 L/min
  - Stored in baselines.json so it survives restarts and improves continuously

  2. Anomaly detection via ratio comparison
  - checkAnomaly() in server.js computes: current_flow / baseline_avg_for_this_hour
  - If the ratio exceeds 2.5× and flow is above a minimum (0.5 L/min), it flags an anomaly
  - Requires at least 5 samples before trusting the baseline — prevents false positives on a fresh device

  3. Leak type classification
  - Beyond just "leak yes/no", the system classifies why it's a leak:
    - burst — sudden spike in flow rate
    - prolonged — continuous flow beyond a time threshold
    - closed_valve — any flow detected while valve is commanded closed
  - Different types carry different severities and UI treatment

  4. Automated response
  - On leak detection, the server can auto-close the valve via valveOverrides, effectively making it a
  closed-loop control system — detect → decide → act — without human input

  5. Feedback loop via HTTP response
  - The ESP32 polls POST /api/data every ~2 seconds and reads the valve_open field in the response
  - The backend uses this to push valve commands back to hardware passively, without a separate command channel

  ---
  The combination of learned baselines + ratio-based anomaly detection + automated actuation is the intelligence
   stack. The rest — WebSocket streaming, charts, email alerts — makes the intelligence observable and
  actionable.