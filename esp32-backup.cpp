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

// Initializing the network clients
WiFiClientSecure espClient;
PubSubClient mqttClient(espClient);

/* * 4. FUNCTION: setRelay
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

/* * 5. FUNCTION: mqttCallback
 * This is the "Ear." It listens for commands coming from your phone dashboard.
 * If it hears "home/relay/1" with the message "ON", it triggers setRelay.
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    char message[10];
    if (length > 9) length = 9; 
    memcpy(message, payload, length);
    message[length] = '\0'; // Converts the raw MQTT data into a readable string

    String top = String(topic);
    if (top.startsWith("home/relay/")) {
        // "11" is the length of "home/relay/". We take the number after it.
        int relayNum = top.substring(11).toInt(); 
        int index = relayNum - 1; // Computers count from 0, humans from 1.
        
        if (index >= 0 && index < numRelays) {
            if (strcmp(message, "ON") == 0) setRelay(index, true);
            else if (strcmp(message, "OFF") == 0) setRelay(index, false);
        }
    }
}

/* * 6. FUNCTION: reconnectMQTT
 * If your Wi-Fi blips, this loop runs until the connection is restored.
 * It also sets the "Last Will" (LWT) which tells your dash if the unit dies.
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
      }
    } else {
      delay(5000); // Wait 5 seconds before trying again if it fails
    }
  }
}

/* * 7. SETUP: Runs ONCE when you power on or hit reset.
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
}

/* * 8. LOOP: Runs thousands of times per second.
 */
void loop() {
    esp_task_wdt_reset(); // "Feeding the dog": Prevents the watchdog from rebooting.

    // If connection drops, go back to the reconnect function.
    if (!mqttClient.connected()) {
        reconnectMQTT();
    }
    
    // This allows the MQTT library to process incoming data and heartbeats.
    mqttClient.loop();
    
    delay(10); // A tiny breather for the processor.
}
