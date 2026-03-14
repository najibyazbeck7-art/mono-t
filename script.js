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
    
    // Get current state from button text (shows what action will happen)
    const actionText = btn.innerText;
    const nextState = (actionText === "ON") ? "ON" : "OFF";
    
    addLog(`Button shows "${actionText}" - will send ${nextState}`, "info");
    
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
    const onInput = document.getElementById(`${id}-min-on`);
    const offInput = document.getElementById(`${id}-min-off`);
    const setBtn = event.target;
    
    const onSeconds = parseInt(onInput.value) || 0;
    const offSeconds = parseInt(offInput.value) || 0;
    
    addLog(`${id} Timer: ${onSeconds}s ON / ${offSeconds}s OFF`, "info");
    
    // Save to persistent storage
    saveTimerSettings(id, onSeconds, offSeconds);
    
    // Stop existing timer if running
    if (activeCycles[id]) {
        clearInterval(activeCycles[id]);
        delete activeCycles[id];
        addLog(`Stopped existing timer for ${id}`, "info");
        setBtn.textContent = "SET";
        setBtn.style.background = "#10b981";
        
        // Clear countdown and turn OFF
        const countdown = document.getElementById(`${id}-countdown`);
        if (countdown) countdown.textContent = "";
        
        // Send stop instruction to ESP32
        sendTimerInstructionToESP32(id, 0, 0, false);
        
        // Convert to relay number and send OFF command
        let relayNumber;
        switch(id) {
            case 'at': relayNumber = 1; break;
            case 'h1': relayNumber = 2; break;
            case 'h2': relayNumber = 3; break;
            case 'h3': relayNumber = 4; break;
            default: relayNumber = parseInt(id); break;
        }
        
        publishCommand(relayNumber, "OFF");
        return;
    }
    
    // Start timer if both values > 0
    if (onSeconds > 0 && offSeconds > 0) {
        addLog(`Starting timer for ${id}: ${onSeconds}s ON → ${offSeconds}s OFF`, "info");
        setBtn.textContent = "STOP";
        setBtn.style.background = "#ef4444";
        
        // Send timer instruction to ESP32 via MQTT
        sendTimerInstructionToESP32(id, onSeconds, offSeconds, true);
        
        // Also start visual timer in web app for feedback
        startTimerLoop(id, onSeconds, offSeconds);
    } else {
        addLog("Both ON and OFF values must be > 0", "error");
    }
}

function sendTimerInstructionToESP32(id, onSeconds, offSeconds, isActive) {
    // Convert to relay number
    let relayNumber;
    switch(id) {
        case 'at': relayNumber = 1; break;
        case 'h1': relayNumber = 2; break;
        case 'h2': relayNumber = 3; break;
        case 'h3': relayNumber = 4; break;
        default: relayNumber = parseInt(id); break;
    }
    
    // Create simple timer instruction that ESP32 can interpret
    const instruction = {
        relay: relayNumber,
        onTime: onSeconds,
        offTime: offSeconds,
        enabled: isActive,
        mode: "timer"
    };
    
    // Send to ESP32 using a topic it can understand
    const topic = `home/relay/${relayNumber}/timer`;
    const message = new Paho.MQTT.Message(JSON.stringify(instruction));
    message.destinationName = topic;
    message.retained = true; // Keep message for ESP32 to read anytime
    
    addLog(`Sending timer instruction to ESP32: relay=${relayNumber}, on=${onSeconds}s, off=${offSeconds}s, enabled=${isActive}`, "info");
    
    if (client.isConnected()) {
        client.send(message);
        addLog(`Timer instruction sent to ESP32: ${topic}`, "info");
        addLog(`ESP32 will now run timer independently even if web app closes`, "info");
    } else {
        addLog("ERROR: MQTT not connected - cannot send timer instruction", "error");
    }
}

function startTimerLoop(id, onSeconds, offSeconds) {
    addLog(`=== startTimerLoop called for ${id} ===`, "info");
    addLog(`Parameters: onSeconds=${onSeconds}, offSeconds=${offSeconds}`, "info");
    
    let isOnPhase = false;
    let currentSeconds = 0;
    let targetSeconds = offSeconds; // Start with OFF phase
    const countdown = document.getElementById(`${id}-countdown`);
    
    addLog(`Countdown element found: ${!!countdown}`, "info");
    
    // Convert to relay number
    let relayNumber;
    switch(id) {
        case 'at': relayNumber = 1; break;
        case 'h1': relayNumber = 2; break;
        case 'h2': relayNumber = 3; break;
        case 'h3': relayNumber = 4; break;
        default: relayNumber = parseInt(id); break;
    }
    
    // Turn OFF initially
    publishCommand(relayNumber, "OFF");
    isOnPhase = false;
    currentSeconds = 0;
    targetSeconds = offSeconds;
    
    addLog(`${id} Timer: Starting with OFF for ${offSeconds}s`, "info");
    
    activeCycles[id] = setInterval(() => {
        currentSeconds++;
        
        // Update countdown
        if (countdown) {
            const phase = isOnPhase ? "ON" : "OFF";
            const remaining = targetSeconds - currentSeconds;
            countdown.textContent = `${phase}: ${remaining}s`;
            countdown.style.color = isOnPhase ? "#10b981" : "#ef4444";
        }
        
        // Check if phase is complete
        if (currentSeconds >= targetSeconds) {
            // Switch phase
            isOnPhase = !isOnPhase;
            currentSeconds = 0;
            targetSeconds = isOnPhase ? onSeconds : offSeconds;
            
            const command = isOnPhase ? "ON" : "OFF";
            addLog(`${id} Timer: Switching to ${command} for ${targetSeconds}s`, "info");
            
            // Send MQTT command
            publishCommand(relayNumber, command);
        }
    }, 1000);
}

function updateRelayUI(id, state) {
    const btn = document.getElementById(`${id}-btn`);
    const led = document.getElementById(`${id}-led`);
    const card = document.getElementById(`${id}-card`);
    const stateIndicator = document.getElementById(`${id}-state`);
    const isActive = (state === "ON");

    if (btn) {
        // Button logic: Green when OFF (ready to turn ON), Red when ON (ready to turn OFF)
        btn.innerText = isActive ? "OFF" : "ON";
        btn.classList.toggle("active", isActive);
        
        // Update button color based on state
        if (isActive) {
            // Relay is ON - show red OFF button
            btn.style.background = "#ef4444";
            btn.style.borderColor = "#dc2626";
        } else {
            // Relay is OFF - show green ON button
            btn.style.background = "#10b981";
            btn.style.borderColor = "#059669";
        }
        
        stateIndicator.innerText = state;
    }

    if (led) led.classList.toggle("active", isActive);
    if (card) card.classList.toggle("active", isActive);
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

// --- 7. PERSISTENT STORAGE ---
function saveTimerSettings(id, onSeconds, offSeconds) {
    const settings = {
        onSeconds: onSeconds,
        offSeconds: offSeconds,
        timestamp: Date.now(),
        isActive: !!activeCycles[id],
        buttonState: activeCycles[id] ? "STOP" : "SET"
    };
    
    localStorage.setItem(`timer-${id}`, JSON.stringify(settings));
    addLog(`Saved timer settings for ${id}: ${onSeconds}s ON / ${offSeconds}s OFF (active: ${settings.isActive})`, "info");
    
    // Also save to MQTT server for persistence
    const mqttTopic = `home/timer/${id}`;
    const mqttMessage = JSON.stringify(settings);
    
    if (client.isConnected()) {
        const message = new Paho.MQTT.Message(mqttMessage);
        message.destinationName = mqttTopic;
        message.retained = true;
        client.send(message);
        addLog(`Synced timer settings to MQTT server: ${mqttTopic}`, "info");
    }
}

function loadTimerSettings(id) {
    const saved = localStorage.getItem(`timer-${id}`);
    if (saved) {
        try {
            const settings = JSON.parse(saved);
            addLog(`Loaded timer settings for ${id}: ${settings.onSeconds}s ON / ${settings.offSeconds}s OFF`, "info");
            
            // Update UI inputs
            const onInput = document.getElementById(`${id}-min-on`);
            const offInput = document.getElementById(`${id}-min-off`);
            if (onInput) onInput.value = settings.onSeconds;
            if (offInput) offInput.value = settings.offSeconds;
            
            // Always restore button state first
            const setBtn = document.querySelector(`#${id}-card .btn-set`);
            if (setBtn) {
                addLog(`Restoring ${id} button state: ${settings.buttonState || "SET"}`, "info");
                setBtn.textContent = settings.buttonState || "SET";
                setBtn.style.background = settings.buttonState === "STOP" ? "#ef4444" : "#10b981";
            }
            
            // Auto-start timer if it was active
            if (settings.isActive && settings.onSeconds > 0 && settings.offSeconds > 0) {
                addLog(`Auto-starting timer for ${id} (was active)`, "info");
                
                // Start timer
                startTimerLoop(id, settings.onSeconds, settings.offSeconds);
            }
            
            return settings;
        } catch (error) {
            addLog(`Error loading timer settings for ${id}: ${error}`, "error");
        }
    }
    return null;
}

function applySavedTimerSettings() {
    const relays = ['at', 'h1', 'h2', 'h3'];
    relays.forEach(id => {
        loadTimerSettings(id);
    });
    
    // Add recovery check after 5 seconds
    setTimeout(() => {
        checkAndRecoverTimers();
    }, 5000);
}

function checkAndRecoverTimers() {
    const relays = ['at', 'h1', 'h2', 'h3'];
    relays.forEach(id => {
        const saved = localStorage.getItem(`timer-${id}`);
        if (saved) {
            try {
                const settings = JSON.parse(saved);
                addLog(`Checking ${id}: active=${settings.isActive}, running=${!!activeCycles[id]}`, "info");
                
                // Always restore button state first
                const setBtn = document.querySelector(`#${id}-card .btn-set`);
                if (setBtn) {
                    setBtn.textContent = settings.buttonState || "SET";
                    setBtn.style.background = settings.buttonState === "STOP" ? "#ef4444" : "#10b981";
                }
                
                // If timer was active but not running, restart it
                if (settings.isActive && settings.onSeconds > 0 && settings.offSeconds > 0 && !activeCycles[id]) {
                    addLog(`Recovering lost timer for ${id}`, "info");
                    
                    // Restart timer
                    startTimerLoop(id, settings.onSeconds, settings.offSeconds);
                }
            } catch (error) {
                addLog(`Error checking timer for ${id}: ${error}`, "error");
            }
        }
    });
}

// --- DEBUG FUNCTIONS ---
function testMQTT() {
    addLog("=== MQTT TEST START ===", "info");
    addLog("Testing direct MQTT command...", "info");
    
    // Test direct command to AT relay
    addLog("Sending ON command to relay 1...", "info");
    publishCommand(1, "ON");
    
    setTimeout(() => {
        addLog("Sending OFF command to relay 1...", "info");
        publishCommand(1, "OFF");
        addLog("=== MQTT TEST END ===", "info");
    }, 3000);
}

function testWithoutMQTT() {
    addLog("=== TESTING WITHOUT MQTT ===", "info");
    addLog("This will test if the timer logic works", "info");
    
    let isOn = false;
    let seconds = 0;
    const countdown = document.getElementById('at-countdown');
    
    const testInterval = setInterval(() => {
        seconds++;
        
        if (seconds <= 5) {
            // OFF phase
            if (countdown) {
                countdown.textContent = `OFF: ${6-seconds}s`;
                countdown.style.color = "#ef4444";
            }
            addLog(`Test OFF phase: ${6-seconds}s remaining`, "info");
        } else if (seconds <= 10) {
            // ON phase  
            if (countdown) {
                countdown.textContent = `ON: ${11-seconds}s`;
                countdown.style.color = "#10b981";
            }
            addLog(`Test ON phase: ${11-seconds}s remaining`, "info");
        } else {
            // Reset
            seconds = 0;
            addLog("Test loop complete - restarting", "info");
        }
    }, 1000);
    
    // Store for cleanup
    activeCycles['test'] = testInterval;
    
    setTimeout(() => {
        clearInterval(testInterval);
        delete activeCycles['test'];
        if (countdown) countdown.textContent = "";
        addLog("=== TEST COMPLETE ===", "info");
    }, 12000);
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
    applySavedTimerSettings(); // Load saved timer settings
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
    console.log("Type 'testMQTT()' to test direct MQTT commands");
    console.log("Type 'testWithoutMQTT()' to test timer logic only");
    console.log("Type 'stopAllCycles()' to stop all cycles");
    console.log("===========================");
});
