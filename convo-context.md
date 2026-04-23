 How will a leak occur if the valve or faucet is either close or open? Is it unrealistic or redundant? 
 
 *  Executing task in folder FlowGuard: C:\Users\user\.platformio\penv\Scripts\platformio.exe run 

Processing esp32dev (platform: espressif32; board: esp32dev; framework: arduino)
---------------------------------------------------------------------------------------------------------------------------------------------------
Verbose mode can be enabled via `-v, --verbose` option
CONFIGURATION: https://docs.platformio.org/page/boards/espressif32/esp32dev.html
PLATFORM: Espressif 32 (6.13.0) > Espressif ESP32 Dev Module
HARDWARE: ESP32 240MHz, 320KB RAM, 4MB Flash
DEBUG: Current (cmsis-dap) External (cmsis-dap, esp-bridge, esp-prog, iot-bus-jtag, jlink, minimodule, olimex-arm-usb-ocd, olimex-arm-usb-ocd-h, olimex-arm-usb-tiny-h, olimex-jtag-tiny, tumpa)
PACKAGES: 
 - framework-arduinoespressif32 @ 3.20017.241212+sha.dcc1105b 
 - tool-esptoolpy @ 2.41100.0 (4.11.0) 
 - toolchain-xtensa-esp32 @ 8.4.0+2021r2-patch5
LDF: Library Dependency Finder -> https://bit.ly/configure-pio-ldf
LDF Modes: Finder ~ chain, Compatibility ~ soft
Found 35 compatible libraries
Scanning dependencies...
Dependency Graph
|-- ESP32Servo @ 1.2.1
|-- ArduinoJson @ 6.21.6
|-- HTTPClient @ 2.0.0
|-- WiFi @ 2.0.0
Building in release mode
Compiling .pio\build\esp32dev\src\main.cpp.o
src/main.cpp: In function 'void sendDataToBackend()':
src/main.cpp:87:47: error: 'DeserializationOk' was not declared in this scope
     if (deserializeJson(respDoc, response) == DeserializationOk) {
                                               ^~~~~~~~~~~~~~~~~
*** [.pio\build\esp32dev\src\main.cpp.o] Error 1
=========================================================== [FAILED] Took 9.81 seconds ===========================================================

 *  The terminal process "C:\Users\user\.platformio\penv\Scripts\platformio.exe 'run'" terminated with exit code: 1. 
 *  Terminal will be reused by tasks, press any key to close it. 