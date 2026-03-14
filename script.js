/* =========================================
    THERMO BETA - DASHBOARD LOGIC
   ========================================= */

const HOST = "64b3984aead9464a9b1aa9c3f34080bb.s1.eu.hivemq.cloud";
const PORT = 8884; 
const USER = "najibyazbeck";
const PASS = "Zaqwsx123*";
const CLIENT_ID = "THERMO_" + Math.random().toString(16).substr(2, 6);

let deferredPrompt;
let activeTimers = {}; 
let heartbeatTimeout; 
const client = new Paho.MQTT.Client(HOST, PORT, CLIENT_ID);

// --- 1. MQTT CONNECTION & HEARTBEAT ---

function connectMQTT() {
    console.log("Linking to Cloud...");
    client.connect({
        userName: USER, password: PASS, useSSL: true,
        onSuccess: () => {
            updateStatus("CHECKING...", "offline"); 
            client.subscribe("home/status/#"); 
            client.subscribe("home/relay/#");
            client.subscribe("home/availability");
            client.subscribe("home/name/#"); // Listen for cloud backup names
            console.log("Broker Connected.");
        },
        onFailure: (err) => {
            updateStatus("DISCONNECTED", "offline");
            console.log("Offline: Check Internet");
            setTimeout(connectMQTT, 5000);
        }
    });
}

client.onMessageArrived = (message) => {
    console.log(`=== MQTT MESSAGE RECEIVED ===`);
    console.log(`Topic: ${message.destinationName}`);
    console.log(`Payload: ${message.payloadString}`);
    console.log(`===========================`);
    
    const topic = message.destinationName;
    const payload = message.payloadString;

    // A. Handle Hardware Availability
    if (topic.includes("/availability")) {
        updateStatus(payload, payload === "ONLINE" ? "online" : "offline");
        console.log(`📍 Device status: ${payload}`);
        
        if (payload === "OFFLINE") {
            clearTimeout(heartbeatTimeout);
            return; 
        }
    }

    // B. Handle Relay State
    if (topic.includes("/status")) {
        const id = topic.split('/')[2];
        console.log(`🔄 Relay status update: ${id} = ${payload}`);
        updateRelayUI(id, payload);
        
        const currentBar = document.getElementById('status-pill').innerText;
        if (!currentBar.includes("OFFLINE")) updateStatus("ONLINE", "online");
    }

    // C. Handle Temperature Updates
    if (topic.includes("/temp")) {
        const id = topic.split('/')[2];
        updateTemperatureUI(id, payload);
        console.log(`🌡️ Temperature ${id}: ${payload}`);
    }

    // D. Handle Name Sync from Cloud
    if (topic.includes("/name/")) {
        const id = topic.split('/')[2];
        if (localStorage.getItem(`relay-name-${id}`) !== payload) {
            localStorage.setItem(`relay-name-${id}`, payload);
            applyCustomNames();
            console.log(`📝 Updated name for Relay ${id}: ${payload}`);
        }
    }

    // E. Heartbeat Timer (65s)
    if (payload !== "OFFLINE") {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
            updateStatus("OFFLINE (TIMEOUT)", "offline");
            console.log("❌ Signal Lost: Heartbeat Timeout");
        }, 65000);
    }
};

// --- 2. COMMANDS & UI ---

function toggleRelay(id) {
    console.log(`Toggle relay ${id} called`);
    
    // Check if MQTT is connected
    if (!client.isConnected()) {
        console.log("MQTT not connected - cannot toggle relay");
        updateStatus("OFFLINE", "offline");
        return;
    }
    
    const btn = document.getElementById(`${id}-btn`);
    if (!btn) {
        console.log(`Button not found for relay ${id}`);
        return;
    }
    
    const currentState = btn.innerText;
    const nextState = (currentState === "ON") ? "OFF" : "ON";
    
    console.log(`Toggling relay ${id}: ${currentState} -> ${nextState}`);
    
    // Send MQTT command using working format
    publishCommand(id, nextState);
    
    // Don't update UI immediately - let ESP32 respond with status
    console.log(`Waiting for ESP32 to confirm state change...`);
}

function publishCommand(num, val) {
    console.log(`=== PUBLISH COMMAND START ===`);
    console.log(`Relay: ${num}, Value: ${val}`);
    console.log(`MQTT Connected: ${client.isConnected()}`);
    console.log(`Host: ${HOST}, Port: ${PORT}`);
    
    if (!client.isConnected()) {
        console.log("❌ ERROR: MQTT not connected - cannot send command");
        return;
    }
    
    const topic = `home/relay/${num}`;
    const message = new Paho.MQTT.Message(val);
    message.destinationName = topic;
    message.retained = true; 
    
    console.log(`✅ Publishing to topic: ${topic}`);
    console.log(`✅ Message payload: ${val}`);
    console.log(`✅ Message retained: true`);
    
    try {
        client.send(message);
        console.log(`✅ Message sent successfully`);
    } catch (error) {
        console.log(`❌ ERROR sending message: ${error}`);
    }
    
    console.log(`=== PUBLISH COMMAND END ===`);

    if (val === "ON") {
        const input = document.getElementById(`timer-input-${num}`);
        const secs = input ? parseInt(input.value) : 0;
        if (secs > 0) startTimer(num, secs);
    } else {
        stopTimer(num);
    }
}

function sendConfig(id) {
    if (!client.isConnected()) return;
    
    const minOn = document.getElementById(`${id}-min-on`).value;
    const minOff = document.getElementById(`${id}-min-off`).value;
    
    const msg = new Paho.MQTT.Message(`${minOn},${minOff}`);
    msg.destinationName = `home/config/${id}`;
    client.send(msg);
    console.log(`Config sent for ${id}: ${minOn}/${minOff}`);
}

function updateRelayUI(id, state) {
    const btn = document.getElementById(`${id}-btn`);
    const led = document.getElementById(`${id}-led`);
    const card = document.getElementById(`${id}-card`);
    const stateIndicator = document.getElementById(`${id}-state`);
    const isActive = (state === "ON");

    if (btn) {
        btn.innerText = state;
        btn.style.backgroundColor = isActive ? "#059669" : "#0f172a";
    }
    if (led) {
        led.className = isActive ? "led-indicator active" : "led-indicator";
    }
    if (card) {
        card.className = isActive ? "relay-box active" : "relay-box";
    }
    if (stateIndicator) {
        stateIndicator.innerText = state;
    }
}

function updateTemperatureUI(id, temp) {
    const valElem = document.getElementById(`${id}-val`);
    if (valElem) valElem.innerText = temp;
}

function updateStatus(text, status) {
    const statusPill = document.getElementById('status-pill');
    if (!statusPill) return;
    statusPill.innerText = text;
    statusPill.className = (status === "online") ? 'status-pill is-online' : 'status-pill is-offline';
    statusPill.style.backgroundColor = (text === "DISCONNECTED") ? "#475569" : "";
}

// --- 3. UTILITIES ---

function startTimer(num, seconds) {
    stopTimer(num);
    let timeLeft = seconds;
    const display = document.getElementById(`countdown-${num}`);
    activeTimers[num] = setInterval(() => {
        timeLeft--;
        if (display) display.innerText = `⏱ ${timeLeft}s`;
        if (timeLeft <= 0) {
            publishCommand(num, "OFF");
            stopTimer(num);
        }
    }, 1000);
}

function stopTimer(num) {
    if (activeTimers[num]) {
        clearInterval(activeTimers[num]);
        delete activeTimers[num];
        const disp = document.getElementById(`countdown-${num}`);
        if(disp) disp.innerText = "";
    }
}

function saveLog(msg, color) {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    let logs = JSON.parse(localStorage.getItem('thermo_logs') || '[]');
    logs.push({ time, msg, color });
    if (logs.length > 20) logs.shift();
    localStorage.setItem('thermo_logs', JSON.stringify(logs));
}

function applyCustomNames() {
    for (let i = 1; i <= 6; i++) {
        const id = i === 1 ? 'at' : `h${i-1}`;
        const name = localStorage.getItem(`relay-name-${id}`);
        const label = document.querySelector(`#${id}-card .sensor-label`);
        if (name && label) label.innerText = name;
    }
}

function shareDashboard() {
    if (navigator.share) {
        navigator.share({ title: 'Thermo Hub', url: window.location.href });
    }
}

// --- 4. SENSOR SIMULATION (Temporary) ---
function simulateTemperature() {
    // Generate random temperatures for all sensors
    const sensors = ['at', 'h1', 'h2', 'h3', 'h4', 'h5'];
    sensors.forEach(sensor => {
        const mockTemp = (Math.random() * (26 - 22) + 22).toFixed(1);
        updateTemperatureUI(sensor, mockTemp);
    });
}

// Start simulation every 5 seconds
setInterval(simulateTemperature, 5000);

// --- 5. TEST FUNCTIONS ---
function testRelayControls() {
    console.log("Testing relay controls...");
    const testRelays = ['at', 'h1', 'h2', 'h3'];
    
    testRelays.forEach((relay, index) => {
        setTimeout(() => {
            console.log(`Testing relay ${relay}`);
            toggleRelay(relay);
        }, index * 1000); // Test each relay 1 second apart
    });
}

function discoverTopics() {
    console.log("=== DISCOVERING MQTT TOPICS ===");
    console.log("Click a relay button and watch which topic your ESP32 responds to...");
    console.log("Your ESP32 is publishing to these status topics:");
    console.log("- home/status/at, home/status/h1, home/status/h2, home/status/h3");
    console.log("But it might be listening to different topics for commands!");
    console.log("Watch the console above to see all topics being tried.");
}

function testSingleTopic(topic, relayId = 'at') {
    console.log(`Testing single topic: ${topic} for relay ${relayId}`);
    const message = new Paho.MQTT.Message("ON");
    message.destinationName = topic;
    message.retained = true;
    client.send(message);
    
    setTimeout(() => {
        const offMsg = new Paho.MQTT.Message("OFF");
        offMsg.destinationName = topic;
        offMsg.retained = true;
        client.send(offMsg);
        console.log("Sent OFF command");
    }, 2000);
}

// Init
window.addEventListener('DOMContentLoaded', () => {
    applyCustomNames();
    connectMQTT();
    simulateTemperature(); // Run once immediately
    
    // Add test button to console for debugging
    window.testRelays = testRelayControls;
    window.mqttStatus = () => {
        console.log("MQTT Connection Status:", client.isConnected());
        console.log("Client Info:", {
            host: HOST,
            port: PORT,
            clientId: CLIENT_ID,
            connected: client.isConnected()
        });
    };
    
    console.log("=== MQTT DEBUG COMMANDS ===");
    console.log("Type 'testRelays()' to test relay controls");
    console.log("Type 'mqttStatus()' to check MQTT connection");
    console.log("Type 'discoverTopics()' to see topic discovery guide");
    console.log("Type 'testSingleTopic(\"your/topic\")' to test specific topic");
    console.log("===========================");
});
