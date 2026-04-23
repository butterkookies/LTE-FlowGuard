#pragma once

// ═══════════════ DEVICE CONFIGURATION ═══════════════
// These are fallback defaults. Values from platformio.ini
// build_flags (-D flags) take priority over these.
// See platformio.ini for how to add new devices.

#ifndef DEVICE_ID
#define DEVICE_ID "kitchen-sink-01"
#endif

// ═══════════════ NETWORK ═══════════════
#ifndef WIFI_SSID
#define WIFI_SSID "Wokwi-GUEST"
#endif

#ifndef WIFI_PASSWORD
#define WIFI_PASSWORD ""
#endif

#ifndef SERVER_URL
#define SERVER_URL "http://host.wokwi.internal:3000/api/data"
#endif

// ═══════════════ PINS ═══════════════
#define FLOW_SENSOR_PIN 34  // Potentiometer simulates flow pulses
#define SERVO_PIN 13        // Servo motor
#define LED_PIN 2           // Built-in LED heartbeat
#define LED_EXT_PIN 15      // External red LED heartbeat

// ═══════════════ TUNING ═══════════════
#define CALIBRATION_FACTOR 7.5
#define REPORT_INTERVAL_MS 2000

// ═══════════════ LEAK DETECTION THRESHOLDS ═══════════════
#define PROLONGED_FLOW_THRESHOLD_MS (30UL * 60 * 1000) // 30 min continuous flow
#define BURST_FLOW_RATE 15.0                           // L/min — sudden spike
#define CLOSED_VALVE_LEAK_THRESHOLD 0.1                // any flow when valve is closed
