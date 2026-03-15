# ESP32 Timer Debug Test

## Upload the Updated ESP32 Code First!

The updated code now has detailed debugging that will show us exactly what's happening.

## Test Steps:

### 1. Upload Updated Code
- Upload `c:\GitHub\mono-t\esp32-timer.cpp` to ESP32
- Open Serial Monitor (115200 baud)
- Look for: "ESP32 Relay Controller with Timer Loops initialized"

### 2. Test Basic Timer
- Set AT: 5s ON / 3s OFF → Click SET
- Check Serial Monitor for:
  ```
  MQTT Message - Topic: home/relay/1, Payload: LOOP_1_5_3, Length: 11
  TIMER COMMAND DETECTED: LOOP_1_5_3 for Relay 1
  PARSED TIMER: on=5, off=3
  STARTING TIMER LOOP FOR RELAY 1
  Timer loop started for Relay 1: 5s ON / 3s OFF
  ```

### 3. Test Cache Clear
- Clear browser cache
- Refresh page
- Check Serial Monitor for:
  ```
  === CHECKING RETAINED TIMER MESSAGES ===
  Relay 1 timer enabled: YES
    - ON time: 5000 ms
    - OFF time: 3000 ms
    - Current phase: OFF
  ==========================================
  ```

### 4. What to Tell Me:
1. What does Serial Monitor show when you click SET?
2. Does the relay physically turn ON/OFF?
3. What happens when you clear cache?
4. Any error messages in Serial Monitor?

This debugging will show us exactly where the issue is!
