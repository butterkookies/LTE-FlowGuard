# Leak Triggers

## Firmware (`src/main.cpp`) — 3 Hardware Leak Types

| Type              | Trigger Condition                             | Threshold                  | Action                                                   |
|-------------------|-----------------------------------------------|----------------------------|----------------------------------------------------------|
| LEAK_CLOSED_VALVE | Flow detected while valve is closed           | `flowRate > 0.1 L/min`     | Marks leak, does **not** close valve (already closed)   |
| LEAK_BURST        | Sudden flow rate spike while valve is open    | `flowRate > 15.0 L/min`    | Marks leak, closes valve immediately                     |
| LEAK_PROLONGED    | Continuous flow without stopping while valve is open | `flow > 0.1 L/min` for 30+ minutes | Marks leak, closes valve immediately                     |

Thresholds are defined in `src/config.h` (lines 36-38).

---

## Backend (`backend/server.js`) — 1 Software Anomaly Type

| Type                | Trigger Condition                                      | Threshold                                                                 | Action                                                             |
|---------------------|--------------------------------------------------------|---------------------------------------------------------------------------|--------------------------------------------------------------------|
| ANOMALY (`high_flow`) | Flow rate is unusually high relative to the historical baseline for that hour | `flowRate > 2.5×` the per-hour average (only fires if baseline has ≥ 5 samples and `flow > 0.5 L/min`) | Logged as an event, broadcast to dashboard as ANOMALY alert; does not close the valve |

This is configured in `server.js` (lines 26-28).

---

**Summary:** Firmware handles the three hard-threshold triggers (closed-valve, burst, prolonged) and closes the valve for burst/prolonged. The backend adds a fourth soft trigger (anomaly detector), which is advisory only and never actuates the valve.