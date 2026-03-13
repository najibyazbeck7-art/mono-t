/* SENSOR LOGIC */

// MQTT Client Setup
const client = new Paho.MQTT.Client("localhost", 9001, "thermo_client_" + Math.random().toString(16).substr(2, 8));

// Connection Options
const options = {
    timeout: 3,
    onSuccess: onConnect,
    onFailure: onFailure
};

// Connect to MQTT Broker
client.connect(options);

// Connection Success Handler
function onConnect() {
    console.log("Connected to MQTT Broker");
    
    // Update status pill
    const statusPill = document.getElementById('status-pill');
    if (statusPill) {
        statusPill.textContent = 'ONLINE';
        statusPill.className = 'status-pill is-online';
    }
    
    // Subscribe to all sensor topics
    client.subscribe("home/+/status");
    client.subscribe("home/+/temp");
}

// Connection Failure Handler
function onFailure(message) {
    console.log("Connection failed: " + message.errorMessage);
    
    // Update status pill
    const statusPill = document.getElementById('status-pill');
    if (statusPill) {
        statusPill.textContent = 'OFFLINE';
        statusPill.className = 'status-pill is-offline';
    }
    
    setTimeout(() => client.connect(options), 5000); // Retry after 5 seconds
}

// Update UI when a message arrives
client.onMessageArrived = (msg) => {
    const topic = msg.destinationName;
    const id = topic.split('/').pop(); // Extract 'at', 'h1', etc.
    const payload = msg.payloadString;

    // Handle Relay Status Updates
    if (topic.includes("status")) {
        const btn = document.getElementById(`${id}-btn`);
        const led = document.getElementById(`${id}-led`);
        const card = document.getElementById(`${id}-card`);
        const stateIndicator = document.getElementById(`${id}-state`);
        const isActive = (payload === "ON");

        if (btn) {
            btn.innerText = payload;
            btn.style.backgroundColor = isActive ? "#059669" : "#0f172a";
        }
        if (led) {
            led.className = isActive ? "led-indicator active" : "led-indicator";
        }
        if (card) {
            card.className = isActive ? "relay-box active" : "relay-box";
        }
        if (stateIndicator) {
            stateIndicator.innerText = payload;
        }
    } 
    
    // Handle Temperature Updates
    else if (topic.includes("temp")) {
        const valElem = document.getElementById(`${id}-val`);
        if (valElem) valElem.innerText = payload;
    }
};

// Toggle Relay Function
function toggleRelay(id) {
    const btn = document.getElementById(`${id}-btn`);
    const currentState = btn.innerText;
    const nextState = (currentState === "ON") ? "OFF" : "ON";
    
    const message = new Paho.MQTT.Message(nextState);
    message.destinationName = `home/relay/${id}`;
    message.retained = true;
    client.send(message);
}

// Send Threshold Config (Min On/Off)
function sendConfig(id) {
    const minOn = document.getElementById(`${id}-min-on`).value;
    const minOff = document.getElementById(`${id}-min-off`).value;
    
    const msg = new Paho.MQTT.Message(`${minOn},${minOff}`);
    msg.destinationName = `home/config/${id}`;
    client.send(msg);
    console.log(`Config sent for ${id}: ${minOn}/${minOff}`);
}
