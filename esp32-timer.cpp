/* * 1. LIBRARIES: These import pre-written functions.
 * WiFi: Handles internet connection.
 * WiFiClientSecure: Allows encrypted (safe) connection to HiveMQ Cloud.
 * PubSubClient: The "MQTT" engine that talks to your dashboard.
 * esp_task_wdt: The "Watchdog" that reboots the chip if it freezes.
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <esp_task_wdt.h>

// 2. CONSTANTS: Fixed info like your login credentials.
const char* ssid = "Yazbeck-HKV";
const char* password = "20242024";

const char* mqtt_server = "64b3984aead9464a9b1aa9c3f34080bb.s1.eu.hivemq.cloud";
const int mqtt_port = 8883;
const char* mqtt_user = "najibyazbeck";
const char* mqtt_pass = "Zaqwsx123*";

// 3. HARDWARE MAPPING: Telling the ESP32 which physical pins are connected to relays.
const int numRelays = 4;
const int relayPins[numRelays] = {21, 26, 32, 33}; 
bool relayStates[numRelays] = {false, false, false, false}; // Keeps track of ON/OFF status

// 4. TIMER LOOP STRUCTURE: New timer functionality for each relay
struct TimerLoop {
  bool enabled = false;
  unsigned long onTime = 0;      // ON duration in milliseconds
  unsigned long offTime = 0;     // OFF duration in milliseconds
  unsigned long lastSwitch = 0;  // When the last switch happened
  bool isOnPhase = false;        // Current phase (true=ON, false=OFF)
};

TimerLoop timerLoops[numRelays]; // One timer per relay

// Initializing the network clients
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

/* * 5. FUNCTION: setRelay
 * This is the physical action. When called, it flips the electrical switch 
 * and sends a confirmation message back to your phone.
 */
void setRelay(int index, bool state) {
    if (index < 0 || index >= numRelays) return; // Safety check
    
    relayStates[index] = state;
    // digitalWrite sends the signal to the pin. 
    // LOW = Relay ON, HIGH = Relay OFF (Active Low logic).
    digitalWrite(relayPins[index], state ? LOW : HIGH);
    
    // This part sends the "ON" or "OFF" status back to HiveMQ so your dash updates.
    char statusTopic[40];
    sprintf(statusTopic, "home/relay/%d/status", index + 1); 
    mqttClient.publish(statusTopic, state ? "ON" : "OFF", true);
    
    Serial.printf("Relay %d is now %s\n", index + 1, state ? "ON" : "OFF");
}

/* * 6. FUNCTION: startTimerLoop
 * Configures and starts a timer loop for a specific relay
 */
void startTimerLoop(int relayNum, unsigned long onSeconds, unsigned long offSeconds) {
  int index = relayNum - 1;
  if (index < 0 || index >= numRelays) return;
  
  timerLoops[index].enabled = true;
  timerLoops[index].onTime = onSeconds * 1000;  // Convert to milliseconds
  timerLoops[index].offTime = offSeconds * 1000; // Convert to milliseconds
  timerLoops[index].lastSwitch = millis();
  timerLoops[index].isOnPhase = false; // Start with OFF phase
  
  // Turn relay OFF initially
  setRelay(index, false);
  
  Serial.printf("Timer loop started for Relay %d: %lus ON / %lus OFF\n", 
                relayNum, onSeconds, offSeconds);
}

/* * 7. FUNCTION: stopTimerLoop
 * Stops and disables a timer loop for a specific relay
 */
void stopTimerLoop(int relayNum) {
  int index = relayNum - 1;
  if (index < 0 || index >= numRelays) return;
  
  timerLoops[index].enabled = false;
  setRelay(index, false); // Turn OFF when stopping
  
  Serial.printf("Timer loop stopped for Relay %d\n", relayNum);
}

/* * 8. FUNCTION: updateTimerLoops
 * This is the core timer logic - runs in the main loop using millis()
 */
void updateTimerLoops() {
  unsigned long currentTime = millis();
  
  for (int i = 0; i < numRelays; i++) {
    if (!timerLoops[i].enabled) continue;
    
    TimerLoop& timer = timerLoops[i];
    unsigned long elapsed = currentTime - timer.lastSwitch;
    
    // Check if current phase is complete
    if ((timer.isOnPhase && elapsed >= timer.onTime) || 
        (!timer.isOnPhase && elapsed >= timer.offTime)) {
      
      // Switch phase
      timer.isOnPhase = !timer.isOnPhase;
      timer.lastSwitch = currentTime;
      
      // Update relay state
      setRelay(i, timer.isOnPhase);
      
      Serial.printf("Relay %d switched to %s phase\n", 
                    i + 1, timer.isOnPhase ? "ON" : "OFF");
    }
  }
}

/* * 9. FUNCTION: mqttCallback
 * Enhanced "Ear" that listens for both regular commands and timer loop commands
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    char message[50];
    if (length > 49) length = 49; 
    memcpy(message, payload, length);
    message[length] = '\0'; // Converts the raw MQTT data into a readable string

    String top = String(topic);
    
    // Debug: Log all received messages
    Serial.printf("MQTT Message - Topic: %s, Payload: %s, Length: %d\n", topic, message, length);
    
    // Handle regular relay commands (backward compatibility)
    if (top.startsWith("home/relay/") && !top.equals("home/relay/system/availability")) {
        // "11" is the length of "home/relay/". We take the number after it.
        int relayNum = top.substring(11).toInt(); 
        int index = relayNum - 1; // Computers count from 0, humans from 1.
        
        if (index >= 0 && index < numRelays) {
            // Check for timer loop commands first
            if (strncmp(message, "LOOP_", 5) == 0) {
                Serial.printf("TIMER COMMAND DETECTED: %s for Relay %d\n", message, relayNum);
                
                // Parse: LOOP_1_5_3 (relay, onTime, offTime)
                unsigned long onTime = 0, offTime = 0;
                char* token = strtok(message, "_");
                if (token) token = strtok(NULL, "_"); // Get relay number (skip)
                if (token) {
                    onTime = strtoul(token, NULL, 10);
                    token = strtok(NULL, "_");
                    if (token) offTime = strtoul(token, NULL, 10);
                }
                
                Serial.printf("PARSED TIMER: on=%lu, off=%lu\n", onTime, offTime);
                
                if (onTime > 0 && offTime > 0) {
                    Serial.printf("STARTING TIMER LOOP FOR RELAY %d\n", relayNum);
                    startTimerLoop(relayNum, onTime, offTime);
                    
                    // Send confirmation
                    char confirmTopic[40];
                    sprintf(confirmTopic, "home/relay/%d/loop", relayNum);
                    sprintf(message, "STARTED_%lu_%lu", onTime, offTime);
                    mqttClient.publish(confirmTopic, message, true);
                    
                    Serial.printf("TIMER LOOP CONFIRMATION SENT\n");
                } else {
                    Serial.printf("INVALID TIMER PARAMETERS for Relay %d: on=%lu, off=%lu\n", relayNum, onTime, offTime);
                }
            }
            // Handle regular ON/OFF commands
            else if (strcmp(message, "ON") == 0) {
                stopTimerLoop(relayNum); // Stop any running timer
                setRelay(index, true);
            }
            else if (strcmp(message, "OFF") == 0) {
                stopTimerLoop(relayNum); // Stop any running timer
                setRelay(index, false);
            }
            else if (strcmp(message, "STOP_TIMER") == 0) {
                stopTimerLoop(relayNum);
            }
        }
    }
}

/* * 10. FUNCTION: checkRetainedTimerMessages
 * Checks for retained timer messages on startup and restarts them
 */
void checkRetainedTimerMessages() {
  Serial.println("=== CHECKING RETAINED TIMER MESSAGES ===");
  
  // The retained messages should have been delivered automatically when we subscribed
  // This function is mainly for debugging
  
  for(int i=1; i<=4; i++) {
    Serial.printf("Relay %d timer enabled: %s\n", i, timerLoops[i-1].enabled ? "YES" : "NO");
    if (timerLoops[i-1].enabled) {
      Serial.printf("  - ON time: %lu ms\n", timerLoops[i-1].onTime);
      Serial.printf("  - OFF time: %lu ms\n", timerLoops[i-1].offTime);
      Serial.printf("  - Current phase: %s\n", timerLoops[i-1].isOnPhase ? "ON" : "OFF");
    }
  }
  
  Serial.println("==========================================");
}

/* * 11. FUNCTION: reconnectMQTT
 * Enhanced reconnection with timer topic subscriptions and retained message check
 */
void reconnectMQTT() {
  while (!mqttClient.connected()) {
    esp_task_wdt_reset(); // Don't reboot while we are trying to connect
    Serial.println("Attempting MQTT connection...");
    
    const char* willTopic = "home/relay/system/availability";
    
    // Connects using your HiveMQ username/password
    if (mqttClient.connect("ESP32_Relay_Unit", mqtt_user, mqtt_pass, 
                           willTopic, 1, true, "OFFLINE")) {
      
      Serial.println("CONNECTED TO HIVEMQ");
      mqttClient.publish(willTopic, "ONLINE", true);
      
      // Reports the local IP so you can find the device on your network.
      String ipLog = "System Online. IP: " + WiFi.localIP().toString();
      mqttClient.publish("home/relay/system/log", ipLog.c_str());
      
      // Subscribes to the topics so it can "hear" relay 1, 2, 3, and 4.
      for(int i=1; i<=4; i++) {
        char subTopic[30];
        sprintf(subTopic, "home/relay/%d", i);
        mqttClient.subscribe(subTopic);
        
        // Also subscribe to loop status topics
        sprintf(subTopic, "home/relay/%d/loop", i);
        mqttClient.subscribe(subTopic);
      }
      
      Serial.println("Subscribed to relay and loop topics");
      
      // Check for retained timer messages after connection
      delay(1000); // Give time for retained messages to be delivered
      checkRetainedTimerMessages();
      
    } else {
      delay(5000); // Wait 5 seconds before trying again if it fails
    }
  }
}

/* * 12. SETUP: Enhanced setup with timer initialization
 */
void setup() {
    Serial.begin(115200); // Opens the communication door for your USB cable
    delay(1000);

    // Watchdog: If the code hangs for 15 seconds, the ESP32 reboots itself automatically.
    esp_task_wdt_config_t twdt_config = {
        .timeout_ms = 15000, 
        .idle_core_mask = (1 << 0), 
        .trigger_panic = true        
    };
    esp_task_wdt_reconfigure(&twdt_config); 
    esp_task_wdt_add(NULL);

    // Initializing pins: Tells the ESP32 that these pins are for OUTPUT (sending power).
    for (int i = 0; i < numRelays; i++) {
        pinMode(relayPins[i], OUTPUT);
        digitalWrite(relayPins[i], HIGH); // Start with everything OFF
    }

    // Initialize timer loops
    for (int i = 0; i < numRelays; i++) {
        timerLoops[i].enabled = false;
    }

    // Wi-Fi Connection logic
    WiFi.begin(ssid, password);
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
        esp_task_wdt_reset();
    }
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // Security: Tells the ESP32 to ignore SSL certificates (easier for HiveMQ Cloud).
    espClient.setInsecure(); 
    mqttClient.setServer(mqtt_server, mqtt_port);
    mqttClient.setCallback(mqttCallback); // Links the "Ear" to the MQTT client
    mqttClient.setBufferSize(512); // Extra room for long messages
    
    Serial.println("ESP32 Relay Controller with Timer Loops initialized");
}

/* * 13. LOOP: Enhanced main loop with timer updates
 */
void loop() {
    esp_task_wdt_reset(); // "Feeding the dog": Prevents the watchdog from rebooting.

    // If connection drops, go back to the reconnect function.
    if (!mqttClient.connected()) {
        reconnectMQTT();
    }
    
    // This allows the MQTT library to process incoming data and heartbeats.
    mqttClient.loop();
    
    // Update all timer loops using millis() - this is the core timing logic
    updateTimerLoops();
    
    delay(10); // A tiny breather for the processor.
}
