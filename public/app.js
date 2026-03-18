// public/app.js
const socket = io();

// State
let localStream;
let screenStream;
let myId = '';
const peers = {}; // Dictionary of RTCPeerConnections
let isMuted = false;
let isDeafened = false;

// DOM Elements
const userListEl = document.getElementById('user-list');
const chatMessagesEl = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const audioContainer = document.getElementById('audio-container');
const btnMute = document.getElementById('btn-mute');
const btnDeafen = document.getElementById('btn-deafen');
const btnScreen = document.getElementById('btn-screen');
const screenContainer = document.getElementById('screen-container');
const screenVideo = document.getElementById('screen-video');

// Free Google STUN Servers
const config = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

// 1. Initialize Media and Socket Connections
async function init() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
        console.error("Microphone access denied or not found.", err);
        // Continue without mic for MVP, though WebRTC requires handling empty streams carefully
    }
}

init();

// --- Socket Events ---
socket.on('your-id', (id) => { myId = id; });

socket.on('all-users', (users) => {
    users.forEach(user => {
        addUserToUI(user);
        createPeerConnection(user.id, true); // Create connection & initiate offer
    });
});

socket.on('user-joined', (user) => {
    addUserToUI(user);
    // We wait for the new user to initiate the offer, so we do nothing here WebRTC-wise
});

socket.on('user-disconnected', (id) => {
    if (peers[id]) {
        peers[id].close();
        delete peers[id];
    }
    const userEl = document.getElementById(`user-${id}`);
    if (userEl) userEl.remove();
    
    const audioEl = document.getElementById(`audio-${id}`);
    if (audioEl) audioEl.remove();
});

// Update UI when someone mutes/deafens
socket.on('user-state-updated', (user) => {
    const userEl = document.getElementById(`user-${user.id}`);
    if (userEl) {
        const statusSpan = userEl.querySelector('.status-indicators');
        let statusHtml = '';
        if (user.isMuted) statusHtml += '<span class="text-red-500 text-xs ml-2" title="Muted">🔇</span>';
        if (user.isDeafened) statusHtml += '<span class="text-red-500 text-xs ml-1" title="Deafened">🎧❌</span>';
        statusSpan.innerHTML = statusHtml;
    }
});

// --- WebRTC Signaling Logic ---
socket.on('signal', async (data) => {
    const { from, signal } = data;
    
    // If peer doesn't exist, they are initiating to us
    if (!peers[from]) {
        createPeerConnection(from, false);
    }

    const pc = peers[from];

    if (signal.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('signal', { to: from, signal: pc.localDescription });
    } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
    } else if (signal.candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(signal));
    }
});

function createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection(config);
    peers[peerId] = pc;

    // Add local audio tracks to the connection
    if (localStream) {
        localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    }
    // If we are already screen sharing, add that too
    if (screenStream) {
        screenStream.getTracks().forEach(track => pc.addTrack(track, screenStream));
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('signal', { to: peerId, signal: event.candidate });
        }
    };

    // Handle incoming tracks (Voice and Screen)
    pc.ontrack = (event) => {
        const track = event.track;
        if (track.kind === 'audio') {
            let audioEl = document.getElementById(`audio-${peerId}`);
            if (!audioEl) {
                audioEl = document.createElement('audio');
                audioEl.id = `audio-${peerId}`;
                audioEl.autoplay = true;
                audioEl.muted = isDeafened; // apply local deafen state
                audioContainer.appendChild(audioEl);
            }
            audioEl.srcObject = event.streams[0];
        } else if (track.kind === 'video') {
            screenContainer.classList.remove('hidden');
            screenVideo.srcObject = event.streams[0];
        }
    };

    // Renegotiation for dynamic track addition (like screen share)
    pc.onnegotiationneeded = async () => {
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socket.emit('signal', { to: peerId, signal: pc.localDescription });
        } catch (err) {
            console.error("Renegotiation error", err);
        }
    };

    return pc;
}

// --- Chat Logic ---
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
        socket.emit('chat-message', text);
        chatInput.value = '';
    }
});

socket.on('chat-message', (data) => {
    const isMe = data.sender === myId;
    const msgDiv = document.createElement('div');
    msgDiv.className = `flex flex-col ${isMe ? 'items-end' : 'items-start'}`;
    
    const bubble = document.createElement('div');
    bubble.className = `px-4 py-2 rounded-lg text-sm max-w-xs ${isMe ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-200 border border-gray-700'}`;
    bubble.textContent = data.text;
    
    const senderLabel = document.createElement('span');
    senderLabel.className = 'text-xs text-gray-500 mt-1';
    senderLabel.textContent = isMe ? 'You' : `User ${data.sender.substring(0, 4)}`;

    msgDiv.appendChild(bubble);
    msgDiv.appendChild(senderLabel);
    chatMessagesEl.appendChild(msgDiv);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
});

// --- UI / Control Logic ---
function addUserToUI(user) {
    if (document.getElementById(`user-${user.id}`)) return;
    const li = document.createElement('li');
    li.id = `user-${user.id}`;
    li.className = 'flex items-center text-sm text-gray-300 py-1';
    
    // Default avatar
    li.innerHTML = `
        <div class="w-6 h-6 rounded-full bg-gray-700 mr-2 flex items-center justify-center text-xs">U</div>
        <span class="truncate w-24">User ${user.id.substring(0,4)}</span>
        <span class="status-indicators flex items-center"></span>
    `;
    userListEl.appendChild(li);
}

btnMute.addEventListener('click', () => {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks()[0].enabled = !isMuted;
    
    btnMute.className = `p-2 rounded-md transition-colors ${isMuted ? 'bg-red-500/20 text-red-500' : 'bg-gray-800 hover:bg-gray-700'}`;
    socket.emit('state-change', { isMuted });
});

btnDeafen.addEventListener('click', () => {
    isDeafened = !isDeafened;
    
    // Mute all remote incoming audio locally
    document.querySelectorAll('audio').forEach(audioEl => {
        audioEl.muted = isDeafened;
    });

    btnDeafen.className = `p-2 rounded-md transition-colors ${isDeafened ? 'bg-red-500/20 text-red-500' : 'bg-gray-800 hover:bg-gray-700'}`;
    socket.emit('state-change', { isDeafened });
});

btnScreen.addEventListener('click', async () => {
    try {
        if (!screenStream) {
            // Start screen share
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            
            // Display locally
            screenContainer.classList.remove('hidden');
            screenVideo.srcObject = screenStream;
            btnScreen.classList.replace('bg-blue-600', 'bg-green-600');
            btnScreen.textContent = '🛑 Stop';

            const screenTrack = screenStream.getVideoTracks()[0];

            // Add track to all existing peer connections
            Object.values(peers).forEach(pc => {
                pc.addTrack(screenTrack, screenStream);
            });

            // Handle user stopping stream via browser UI (e.g. Chrome's "Stop sharing" banner)
            screenTrack.onended = () => { stopScreenShare(); };
        } else {
            // Stop screen share manually via button
            stopScreenShare();
        }
    } catch (err) {
        console.error("Screen share failed", err);
    }
});

function stopScreenShare() {
    if (!screenStream) return;
    screenStream.getTracks().forEach(track => track.stop());
    screenStream = null;
    screenContainer.classList.add('hidden');
    screenVideo.srcObject = null;
    btnScreen.classList.replace('bg-green-600', 'bg-blue-600');
    btnScreen.textContent = '🖥️ Share';

    // Remove the video sender from peers
    Object.values(peers).forEach(pc => {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender) pc.removeTrack(videoSender);
    });
          }
      
