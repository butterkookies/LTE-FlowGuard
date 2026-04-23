#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <WiFi.h>

// WiFi Configuration (Wokwi Default)
const char *ssid = "Wokwi-GUEST";
const char *password = "";
const char *serverUrl = "http://host.wokwi.internal:3000/api/data";

// Pins
const int FLOW_SENSOR_PIN = 34; // Potentiometer simulates flow pulses
const int SERVO_PIN = 13;       // Servo motor
const int LED_PIN = 2;          // Built-in LED heartbeat
const int LED_EXT_PIN = 15;     // External red LED heartbeat

// Settings
const char *DEVICE_ID = "kitchen-sink-01";
const float CALIBRATION_FACTOR = 7.5;
const int LEAK_THRESHOLD_SECONDS = 10;
const int REPORT_INTERVAL_MS = 2000;

// Variables
volatile long pulseCount = 0;
float flowRate = 0.0;
float totalLiters = 0.0;
unsigned long lastMillis = 0;
unsigned long lastReportMillis = 0;
unsigned long flowStartTime = 0;
bool leakDetected = false;
bool wifiConnected = false;
bool valveOpen = true; // Track valve state
Servo shutoffValve;

// Serial command buffer
String serialCmdBuffer = "";

void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 5000) {
    delay(500);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\n[WiFi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    wifiConnected = false;
    Serial.println("\n[WiFi] Connection failed! Running in offline mode.");
  }
}

void sendDataToBackend() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  http.begin(serverUrl);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["flow_rate"] = flowRate;
  doc["total_consumption"] = totalLiters;
  doc["leak_status"] = leakDetected;
  doc["valve_open"] = valveOpen;
  doc["water_loss"] = leakDetected ? (flowRate * 0.5) : 0.0;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode > 0) {
    Serial.print("[HTTP] Data sent, response: ");
    Serial.println(httpResponseCode);
  } else {
    Serial.print("[HTTP] Error sending POST: ");
    Serial.println(http.errorToString(httpResponseCode).c_str());
  }
  http.end();
}

// Process incoming serial commands from the bridge
void processSerialCommand(String cmd) {
  cmd.trim();

  if (cmd == "$$CMD:VALVE_CLOSE$$") {
    valveOpen = false;
    shutoffValve.write(90); // Close valve
    Serial.println("\n>>> [CMD] VALVE CLOSED by remote command <<<");
  } else if (cmd == "$$CMD:VALVE_OPEN$$") {
    valveOpen = true;
    leakDetected = false;  // Reset leak state on manual reopen
    flowStartTime = 0;     // Reset flow timer
    shutoffValve.write(0); // Open valve
    Serial.println(
        "\n>>> [CMD] VALVE OPENED by remote command — Leak reset <<<");
  } else if (cmd == "$$CMD:RESET_LEAK$$") {
    leakDetected = false;
    flowStartTime = 0;
    Serial.println("\n>>> [CMD] LEAK RESET by remote command (valve unchanged) <<<");
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==============================");
  Serial.println("  FlowGuard+ SYSTEM ACTIVE  ");
  Serial.println("==============================");

  pinMode(FLOW_SENSOR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(LED_EXT_PIN, OUTPUT);

  // Startup self-test: blink LEDs 3 times
  Serial.println("[TEST] Starting LED blink test...");
  for (int i = 0; i < 3; i++) {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(LED_EXT_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(LED_EXT_PIN, LOW);
    delay(200);
  }
  Serial.println("[TEST] LED blink test complete.");

  // Initialize Servo and self-test
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);
  shutoffValve.setPeriodHertz(50);
  shutoffValve.attach(SERVO_PIN, 500, 2400);
  Serial.println("[TEST] Starting servo sweep test...");
  shutoffValve.write(90); // Close
  delay(500);
  shutoffValve.write(0); // Open
  delay(500);
  Serial.println("[TEST] Servo sweep test complete.");

  // WiFi (non-blocking — times out after 5s)
  connectWiFi();

  Serial.println("[OK] Valve opened. Monitoring flow...");
  Serial.println("[OK] Setup complete. Entering main loop.\n");
}

void loop() {
  unsigned long currentMillis = millis();

  // ── Check for incoming serial commands from bridge ──
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      processSerialCommand(serialCmdBuffer);
      serialCmdBuffer = "";
    } else {
      serialCmdBuffer += c;
    }
  }

  // Heartbeat blink (toggles every 500ms for visible blinking)
  bool ledState = (currentMillis / 500) % 2;
  digitalWrite(LED_PIN, ledState);
  digitalWrite(LED_EXT_PIN, ledState);

  // Every 1 second: Process Flow & Leak Logic
  if (currentMillis - lastMillis >= 1000) {
    int potValue = analogRead(FLOW_SENSOR_PIN);
    pulseCount = (potValue > 100) ? map(potValue, 0, 4095, 0, 100) : 0;

    flowRate = ((1000.0 / (currentMillis - lastMillis)) * pulseCount) /
               CALIBRATION_FACTOR;
    lastMillis = currentMillis;
    totalLiters += (flowRate / 60.0);

    // Only run leak detection if valve is open
    if (valveOpen && flowRate > 0.1) {
      if (flowStartTime == 0)
        flowStartTime = currentMillis;
      unsigned long duration = (currentMillis - flowStartTime) / 1000;

      if (!leakDetected && duration > LEAK_THRESHOLD_SECONDS) {
        leakDetected = true;
        valveOpen = false;
        shutoffValve.write(90); // Close
        Serial.println(
            "\n>>> [!] FATAL: LEAK DETECTED! SHUTTING OFF VALVE! <<<");
      }
    } else if (flowRate <= 0.1) {
      flowStartTime = 0;
    }

    Serial.print("Flow: ");
    Serial.print(flowRate, 2);
    Serial.print(" L/min | Total: ");
    Serial.print(totalLiters, 3);
    Serial.print(" L | Pot: ");
    Serial.print(potValue);
    Serial.print(" | Valve: ");
    Serial.print(valveOpen ? "OPEN" : "CLOSED");
    Serial.print(" | Status: ");
    Serial.println(leakDetected ? "LEAK" : "OK");

    // Machine-readable JSON line for the serial bridge
    Serial.print("$$JSON:{\"device_id\":\"");
    Serial.print(DEVICE_ID);
    Serial.print("\",\"flow_rate\":");
    Serial.print(flowRate, 2);
    Serial.print(",\"total_consumption\":");
    Serial.print(totalLiters, 3);
    Serial.print(",\"leak_status\":");
    Serial.print(leakDetected ? "true" : "false");
    Serial.print(",\"valve_open\":");
    Serial.print(valveOpen ? "true" : "false");
    Serial.print(",\"water_loss\":");
    Serial.print(leakDetected ? (flowRate * 0.5) : 0.0, 2);
    Serial.println("}$$");
  }

  // Every 2 seconds: Send telemetry to Backend
  if (currentMillis - lastReportMillis >= REPORT_INTERVAL_MS) {
    sendDataToBackend();
    lastReportMillis = currentMillis;
  }
}
