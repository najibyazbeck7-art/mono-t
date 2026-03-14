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
let activeCycles = {}; // Store active cycle intervals
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
    const topic = message.destinationName;
    const payload = message.payloadString;

    addLog(`=== MQTT MESSAGE RECEIVED ===`, "received");
    addLog(`Topic: ${topic}`, "received");
    addLog(`Payload: ${payload}`, "received");
    addLog(`===========================`, "received");

    // A. Handle Hardware Availability
    if (topic.includes("/availability")) {
        updateStatus(payload, payload === "ONLINE" ? "online" : "offline");
        addLog(`📍 Device status: ${payload}`, "info");
        
        if (payload === "OFFLINE") {
            clearTimeout(heartbeatTimeout);
            return; 
        }
    }

    // B. Handle Relay State
    if (topic.includes("/status")) {
        const relayNum = topic.split('/')[2];
        addLog(`🔄 Relay status update: ${relayNum} = ${payload}`, "received");
        
        // Convert ESP32 number back to name for UI
        let relayId;
        switch(relayNum) {
            case '1': relayId = 'at'; break;
            case '2': relayId = 'h1'; break;
            case '3': relayId = 'h2'; break;
            case '4': relayId = 'h3'; break;
            default: relayId = relayNum; break;
        }
        
        addLog(`Converted relay ${relayNum} to UI ID: ${relayId}`, "received");
        updateRelayUI(relayId, payload);
        
        const currentBar = document.getElementById('status-pill').innerText;
        if (!currentBar.includes("OFFLINE")) updateStatus("ONLINE", "online");
    }

    // C. Handle Temperature Updates
    if (topic.includes("/temp")) {
        const id = topic.split('/')[2];
        updateTemperatureUI(id, payload);
        addLog(`🌡️ Temperature ${id}: ${payload}`, "received");
    }

    // D. Handle Name Sync from Cloud
    if (topic.includes("/name/")) {
        const id = topic.split('/')[2];
        if (localStorage.getItem(`relay-name-${id}`) !== payload) {
            localStorage.setItem(`relay-name-${id}`, payload);
            applyCustomNames();
            addLog(`📝 Updated name for Relay ${id}: ${payload}`, "received");
        }
    }

    // E. Heartbeat Timer (65s)
    if (payload !== "OFFLINE") {
        clearTimeout(heartbeatTimeout);
        heartbeatTimeout = setTimeout(() => {
            updateStatus("OFFLINE (TIMEOUT)", "offline");
            addLog("❌ Signal Lost: Heartbeat Timeout", "error");
        }, 65000);
    }
};

// --- 2. COMMANDS & UI ---

function toggleRelay(id) {
    addLog(`Toggle relay ${id} called`, "info");
    
    // Check if MQTT is connected
    if (!client.isConnected()) {
        addLog("MQTT not connected - cannot toggle relay", "error");
        updateStatus("OFFLINE", "offline");
        return;
    }
    
    const btn = document.getElementById(`${id}-btn`);
    if (!btn) {
        addLog(`Button not found for relay ${id}`, "error");
        return;
    }
    
    const currentState = btn.innerText;
    const nextState = (currentState === "ON") ? "OFF" : "ON";
    
    addLog(`Toggling relay ${id}: ${currentState} -> ${nextState}`, "info");
    
    // Convert name to number for ESP32 compatibility
    let relayNumber;
    switch(id) {
        case 'at': relayNumber = 1; break;
        case 'h1': relayNumber = 2; break;
        case 'h2': relayNumber = 3; break;
        case 'h3': relayNumber = 4; break;
        default: relayNumber = parseInt(id); break;
    }
    
    addLog(`Converted ${id} to relay number ${relayNumber}`, "info");
    
    // Send MQTT command using ESP32 format
    publishCommand(relayNumber, nextState);
    
    // Don't update UI immediately - let ESP32 respond with status
    addLog(`Waiting for ESP32 to confirm state change...`, "info");
}

function publishCommand(num, val) {
    addLog(`=== PUBLISH COMMAND START ===`, "info");
    addLog(`Relay: ${num}, Value: ${val}`, "info");
    addLog(`MQTT Connected: ${client.isConnected()}`, "info");
    addLog(`Host: ${HOST}, Port: ${PORT}`, "info");
    addLog(`Client object exists: ${!!client}`, "info");
    
    if (!client.isConnected()) {
        addLog("❌ ERROR: MQTT not connected - cannot send command", "error");
        addLog("Connection status: " + client.isConnected(), "error");
        return;
    }
    
    const topic = `home/relay/${num}`;
    addLog(`✅ Creating message for topic: ${topic}`, "sent");
    addLog(`✅ Message payload: ${val}`, "sent");
    
    const message = new Paho.MQTT.Message(val);
    message.destinationName = topic;
    message.retained = true; 
    
    addLog(`✅ Message object created: ${!!message}`, "sent");
    addLog(`✅ Message destination: ${message.destinationName}`, "sent");
    addLog(`✅ Message retained: ${message.retained}`, "sent");
    
    try {
        addLog(`🚀 About to call client.send()...`, "sent");
        client.send(message);
        addLog(`✅ Message sent successfully`, "sent");
        addLog(`📡 Check ESP32 for response on: home/relay/${num}/status`, "info");
    } catch (error) {
        addLog(`❌ ERROR sending message: ${error}`, "error");
        addLog(`❌ Error details: ${error.stack}`, "error");
    }
    
    addLog(`=== PUBLISH COMMAND END ===`, "info");

    if (val === "ON") {
        const input = document.getElementById(`timer-input-${num}`);
        const secs = input ? parseInt(input.value) : 0;
        if (secs > 0) startTimer(num, secs);
    } else {
        stopTimer(num);
    }
}

function sendConfig(id) {
    const minOnInput = document.getElementById(`${id}-min-on`);
    const minOffInput = document.getElementById(`${id}-min-off`);
    const setBtn = event.target;
    
    const secOn = parseInt(minOnInput.value) || 0;
    const secOff = parseInt(minOffInput.value) || 0;
    
    addLog(`Config for ${id}: ${secOn}s ON / ${secOff}s OFF`, "info");
    
    // Stop existing cycle if running
    if (activeCycles[id]) {
        clearInterval(activeCycles[id]);
        delete activeCycles[id];
        addLog(`Stopped existing cycle for ${id}`, "info");
        setBtn.textContent = "SET";
        setBtn.style.background = "#10b981";
        
        // Clear countdown
        const countdown = document.getElementById(`${id}-countdown`);
        if (countdown) countdown.textContent = "";
    }
    
    // Start new cycle if both values > 0
    if (secOn > 0 && secOff > 0) {
        addLog(`Starting cycle for ${id}: ${secOn}s ON → ${secOff}s OFF`, "info");
        setBtn.textContent = "STOP";
        setBtn.style.background = "#ef4444";
        
        // Start with ON phase
        startCycle(id, secOn, secOff);
    } else {
        addLog(`Invalid cycle values for ${id}. Both must be > 0`, "error");
    }
}

function startCycle(id, secOn, secOff) {
    let isOnPhase = false; // Start with OFF
    let countdownInterval;
    let phaseTimeout;
    
    function startPhase(duration, phase) {
        let timeLeft = duration;
        const countdown = document.getElementById(`${id}-countdown`);
        
        addLog(`${id} cycle: Starting ${phase} phase for ${duration} seconds`, "info");
        addLog(`${id} cycle: About to send MQTT command: ${phase}`, "info");
        
        // Send MQTT command immediately
        publishCommand(id, phase);
        addLog(`${id} cycle: MQTT command sent, waiting for device response...`, "info");
        
        // Clear existing timers
        if (countdownInterval) clearInterval(countdownInterval);
        if (phaseTimeout) clearTimeout(phaseTimeout);
        
        // Update countdown immediately
        if (countdown) {
            countdown.textContent = `${phase}: ${timeLeft}s`;
            countdown.style.color = phase === "ON" ? "#10b981" : "#ef4444";
        }
        
        // Update countdown every second
        countdownInterval = setInterval(() => {
            timeLeft--;
            if (countdown) {
                countdown.textContent = `${phase}: ${timeLeft}s`;
            }
            
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
            }
        }, 1000);
        
        // Set timer for next phase
        phaseTimeout = setTimeout(() => {
            // Toggle phase and start next
            isOnPhase = !isOnPhase;
            const nextDuration = isOnPhase ? secOn : secOff;
            const nextPhase = isOnPhase ? "ON" : "OFF";
            
            addLog(`${id} cycle: Phase complete, switching to ${nextPhase}`, "info");
            startPhase(nextDuration, nextPhase);
        }, duration * 1000);
    }
    
    // Start first phase immediately with OFF
    startPhase(secOff, "OFF");
    
    // Store the cycle info for cleanup
    activeCycles[id] = {
        clear: () => {
            if (countdownInterval) clearInterval(countdownInterval);
            if (phaseTimeout) clearTimeout(phaseTimeout);
            addLog(`Stopped cycle for ${id}`, "info");
        }
    };
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

// --- LOG WINDOW FUNCTIONS ---
function addLog(message, type = 'info') {
    const logContent = document.getElementById('log-content');
    if (!logContent) return;
    
    const timestamp = new Date().toLocaleTimeString([], { hour12: false });
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${type}`;
    logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> ${message}`;
    
    logContent.appendChild(logEntry);
    logContent.scrollTop = logContent.scrollHeight;
    
    // Keep only last 100 entries
    const entries = logContent.children;
    if (entries.length > 100) {
        logContent.removeChild(entries[0]);
    }
}

function toggleLog() {
    const logWindow = document.getElementById('log-window');
    if (logWindow) {
        logWindow.style.display = logWindow.style.display === 'none' ? 'block' : 'none';
    }
}

function clearLog() {
    const logContent = document.getElementById('log-content');
    if (logContent) {
        logContent.innerHTML = '';
        addLog('Log cleared', 'info');
    }
}

// --- CYCLE MANAGEMENT ---
function stopAllCycles() {
    addLog("Stopping all active cycles...", "info");
    Object.keys(activeCycles).forEach(id => {
        if (activeCycles[id] && activeCycles[id].clear) {
            activeCycles[id].clear();
        }
        // Clear countdown display
        const countdown = document.getElementById(`${id}-countdown`);
        if (countdown) countdown.textContent = "";
    });
    activeCycles = {};
}

// Cleanup on page unload
window.addEventListener('beforeunload', stopAllCycles);

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
    
    // Initialize log
    addLog('Thermo Beta Dashboard initialized', 'info');
    addLog('Connecting to MQTT broker...', 'info');
    
    console.log("=== MQTT DEBUG COMMANDS ===");
    console.log("Type 'testRelays()' to test relay controls");
    console.log("Type 'mqttStatus()' to check MQTT connection");
    console.log("Type 'stopAllCycles()' to stop all cycles");
    console.log("===========================");
});
