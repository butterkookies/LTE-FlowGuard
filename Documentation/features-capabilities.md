# FlowGuard+ Features and Capabilities

A. Smart Water Flow Monitoring
1. It can monitor water flow in real time using an ESP32-based sensing node.
2. It can measure flow rate continuously and convert sensor input into usable telemetry.
3. It can calculate total water consumption over time.
4. It can run as an edge device that keeps local monitoring active even before backend processing.

B. Leak Detection Intelligence
1. It can detect a burst leak when flow spikes above a configured threshold.
2. It can detect prolonged flow when water runs continuously for too long.
3. It can detect a closed-valve leak when flow is observed while the valve is supposed to be closed.
4. It can classify leak events into different types instead of using only a simple yes/no status.
5. It can reset leak state when the valve is reopened or when a reset command is received.

C. Automatic Valve Control
1. It can automatically shut off the valve when a critical leak is detected.
2. It can reopen the valve after the leak is cleared or manually reset.
3. It can enforce the correct valve position continuously using servo control.
4. It can respond to remote shutoff and reopen commands from the dashboard.
5. It can support a fail-safe style response by stopping dangerous flow as soon as a critical condition appears.

D. Real-Time Communication
1. It can send telemetry from the ESP32 to the backend over HTTP.
2. It can exchange commands between the dashboard and device using a WebSocket-enabled backend.
3. It can forward serial data from the Wokwi simulator to the backend through the bridge.
4. It can forward dashboard commands back to the ESP32 through the serial bridge.
5. It can keep the dashboard updated with live device state changes.

E. Multi-Device Monitoring
1. It can support multiple devices identified by unique device IDs.
2. It can monitor different zones such as kitchen sink, bathroom faucet, and garden hose.
3. It can display multiple devices in one dashboard view.
4. It can simulate several devices at once for testing and demonstration.
5. It can scale conceptually to more zones by adding more device configurations.

F. Dashboard and User Interface
1. It can show a live summary of total water usage.
2. It can show the number of active devices currently reporting.
3. It can show how many active leaks are present.
4. It can show total estimated water loss.
5. It can present each device in a table with its status, flow, consumption, loss, and valve state.
6. It can show clear status badges such as normal, anomaly, critical leak, or offline.
7. It can open a detailed panel for a selected device.
8. It can provide action buttons for shut off, reopen, and reset leak.
9. It can display live connection state for the backend link.

G. Historical Data and Reporting
1. It can store device history over time.
2. It can keep the latest entries per device for trend review.
3. It can provide a per-device detail history list.
4. It can generate daily and weekly usage summaries.
5. It can show daily breakdowns for recent days.
6. It can compute today and week consumption values.
7. It can track peak flow and average flow for reporting.
8. It can count leak events over time for analysis.

H. Baseline and Anomaly Detection
1. It can learn flow baselines from historical readings.
2. It can organize baseline data by hour of day.
3. It can compare current flow against the learned hourly average.
4. It can flag unusually high usage as an anomaly.
5. It can reduce false positives by requiring enough samples before trusting a baseline.
6. It can distinguish normal flow behavior from behavior that is unusual for that time slot.

I. Alerts and Notifications
1. It can display visual leak alerts on the dashboard.
2. It can show different alert styles depending on leak type severity.
3. It can send email alerts when a new leak is detected.
4. It can support a test email workflow for configuration validation.
5. It can notify users when a leak is resolved and the valve is reopened.
6. It can show anomaly alerts separately from leak alerts.

J. Data Persistence and Settings
1. It can persist device history to disk.
2. It can persist baseline profiles to disk.
3. It can persist alert settings such as email configuration.
4. It can load saved data on startup so the system does not begin from zero every time.
5. It can mask sensitive settings such as the email app password in responses.
6. It can maintain state across backend restarts better than an in-memory-only design.

K. Simulation and Testing
1. It can run in Wokwi for prototype simulation.
2. It can simulate flow sensor readings using a potentiometer input.
3. It can simulate servo-driven shutoff behavior.
4. It can test multiple device scenarios through a Node.js simulator.
5. It can demonstrate normal flow, leak buildup, leak detection, and recovery.
6. It can verify the full telemetry and control loop without physical hardware.

L. Project Deployment and Integration
1. It can run with PlatformIO for ESP32 firmware development.
2. It can use a Node.js backend for API and real-time messaging.
3. It can use a browser-based frontend dashboard.
4. It can be started as separate parts: firmware, bridge, backend, and frontend.
5. It can integrate cleanly with Wokwi serial transport during simulation.
6. It can be extended with additional devices by creating new build environments.

M. Innovation and Practical Use
1. It can combine sensing, detection, notification, and actuation in one IoT workflow.
2. It can support water conservation by reducing wasted flow.
3. It can help prevent property damage by acting quickly on dangerous leaks.
4. It can provide a more intelligent view than a simple threshold-only monitor.
5. It can serve as a practical conceptual design for homes, dorms, and small facilities.

N. Limitations It Already Addresses or Can Grow Into
1. It can operate in a prototype-friendly simulation environment.
2. It can be expanded into a real hardware deployment with proper calibration.
3. It can be improved with stronger authentication and transport security.
4. It can be improved with push notifications, mobile alerts, and richer analytics.
5. It can be upgraded with more advanced anomaly prediction and usage forecasting.
