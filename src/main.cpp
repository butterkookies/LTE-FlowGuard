#include <Arduino.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <WiFi.h>

#include "config.h"

// Leak types
enum LeakType { LEAK_NONE, LEAK_BURST, LEAK_PROLONGED, LEAK_CLOSED_VALVE };

// Variables
volatile long pulseCount = 0;
float flowRate = 0.0;
float totalLiters = 0.0;
unsigned long lastMillis = 0;
unsigned long lastReportMillis = 0;
unsigned long flowStartTime = 0;
bool leakDetected = false;
LeakType leakType = LEAK_NONE;
bool wifiConnected = false;
bool valveOpen = true;
Servo shutoffValve;

// Serial command buffer
String serialCmdBuffer = "";

void connectWiFi() {
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

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
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<256> doc;
  doc["device_id"] = DEVICE_ID;
  doc["flow_rate"] = flowRate;
  doc["total_consumption"] = totalLiters;
  doc["leak_status"] = leakDetected;
  doc["valve_open"] = valveOpen;
  doc["water_loss"] = leakDetected ? (flowRate * 0.5) : 0.0;
  const char *httpLeakType = "none";
  if (leakDetected) {
    switch (leakType) {
    case LEAK_BURST:
      httpLeakType = "burst";
      break;
    case LEAK_PROLONGED:
      httpLeakType = "prolonged";
      break;
    case LEAK_CLOSED_VALVE:
      httpLeakType = "closed_valve";
      break;
    default:
      httpLeakType = "unknown";
      break;
    }
  }
  doc["leak_type"] = httpLeakType;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpResponseCode = http.POST(requestBody);
  if (httpResponseCode > 0) {
    Serial.print("[HTTP] Data sent, response: ");
    Serial.println(httpResponseCode);

    // Parse response for valve commands from the backend
    String response = http.getString();
    StaticJsonDocument<128> respDoc;
    if (deserializeJson(respDoc, response) == DeserializationError::Ok) {
      if (respDoc.containsKey("valve_open")) {
        bool desiredState = respDoc["valve_open"];
        if (!desiredState && valveOpen) {
          valveOpen = false;
          leakDetected = false;
          leakType = LEAK_NONE;
          flowStartTime = 0;
          shutoffValve.write(90);
          Serial.println("\n>>> [HTTP] VALVE CLOSED by server command <<<");
        } else if (desiredState && !valveOpen) {
          valveOpen = true;
          leakDetected = false;
          leakType = LEAK_NONE;
          flowStartTime = 0;
          shutoffValve.write(0);
          Serial.println("\n>>> [HTTP] VALVE OPENED by server command <<<");
        }
      }
    }
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
    leakDetected = false;
    leakType = LEAK_NONE;
    flowStartTime = 0;
    shutoffValve.write(90);
    Serial.println("\n>>> [CMD] VALVE CLOSED by remote command <<<");
  } else if (cmd == "$$CMD:VALVE_OPEN$$") {
    valveOpen = true;
    leakDetected = false;
    leakType = LEAK_NONE;
    flowStartTime = 0;
    shutoffValve.write(0);
    Serial.println(
        "\n>>> [CMD] VALVE OPENED by remote command — Leak reset <<<");
  } else if (cmd == "$$CMD:RESET_LEAK$$") {
    leakDetected = false;
    leakType = LEAK_NONE;
    flowStartTime = 0;
    Serial.println(
        "\n>>> [CMD] LEAK RESET by remote command (valve unchanged) <<<");
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

  // ── Continuous servo enforcement ──
  // Prevent servo drift: always write the correct position
  shutoffValve.write(valveOpen ? 0 : 90);

  // Every 1 second: Process Flow & Leak Logic
  if (currentMillis - lastMillis >= 1000) {
    int potValue = analogRead(FLOW_SENSOR_PIN);
    pulseCount = (potValue > 100) ? map(potValue, 0, 4095, 0, 100) : 0;

    // Always calculate real flow rate from the sensor
    flowRate = ((1000.0 / (currentMillis - lastMillis)) * pulseCount) /
               CALIBRATION_FACTOR;

    // Only accumulate consumption when valve is open (intentional use)
    if (valveOpen) {
      totalLiters += (flowRate / 60.0);
    }
    lastMillis = currentMillis;

    // ── Leak detection ──
    if (!leakDetected) {

      // 1) CRITICAL: Flow detected while valve is CLOSED → pipe burst
      if (!valveOpen && flowRate > CLOSED_VALVE_LEAK_THRESHOLD) {
        leakDetected = true;
        leakType = LEAK_CLOSED_VALVE;
        Serial.println(
            "\n>>> [!] LEAK: Flow detected while valve is CLOSED — "
            "possible pipe burst! <<<");
      }

      // 2) BURST: Sudden flow rate spike while valve is open
      else if (valveOpen && flowRate > BURST_FLOW_RATE) {
        leakDetected = true;
        leakType = LEAK_BURST;
        valveOpen = false;
        shutoffValve.write(90);
        Serial.println(
            "\n>>> [!] LEAK: Flow rate spike detected! SHUTTING OFF VALVE! <<<");
      }

      // 3) PROLONGED: Continuous flow for too long while valve is open
      else if (valveOpen && flowRate > 0.1) {
        if (flowStartTime == 0)
          flowStartTime = currentMillis;
        unsigned long duration = currentMillis - flowStartTime;

        if (duration > PROLONGED_FLOW_THRESHOLD_MS) {
          leakDetected = true;
          leakType = LEAK_PROLONGED;
          valveOpen = false;
          shutoffValve.write(90);
          Serial.println(
              "\n>>> [!] LEAK: Prolonged continuous flow (30+ min)! "
              "SHUTTING OFF VALVE! <<<");
        }
      } else if (flowRate <= 0.1) {
        flowStartTime = 0; // Reset timer when flow stops
      }
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
    if (!leakDetected) {
      Serial.println("OK");
    } else {
      switch (leakType) {
      case LEAK_BURST:
        Serial.println("LEAK:BURST");
        break;
      case LEAK_PROLONGED:
        Serial.println("LEAK:PROLONGED");
        break;
      case LEAK_CLOSED_VALVE:
        Serial.println("LEAK:CLOSED_VALVE");
        break;
      default:
        Serial.println("LEAK");
        break;
      }
    }

    // Machine-readable JSON line for the serial bridge
    const char *leakTypeStr = "none";
    if (leakDetected) {
      switch (leakType) {
      case LEAK_BURST:
        leakTypeStr = "burst";
        break;
      case LEAK_PROLONGED:
        leakTypeStr = "prolonged";
        break;
      case LEAK_CLOSED_VALVE:
        leakTypeStr = "closed_valve";
        break;
      default:
        leakTypeStr = "unknown";
        break;
      }
    }
    Serial.print("$$JSON:{\"device_id\":\"");
    Serial.print(DEVICE_ID);
    Serial.print("\",\"flow_rate\":");
    Serial.print(flowRate, 2);
    Serial.print(",\"total_consumption\":");
    Serial.print(totalLiters, 3);
    Serial.print(",\"leak_status\":");
    Serial.print(leakDetected ? "true" : "false");
    Serial.print(",\"leak_type\":\"");
    Serial.print(leakTypeStr);
    Serial.print("\",\"valve_open\":");
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
