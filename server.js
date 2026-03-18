// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve the zero-build frontend
app.use(express.static(__dirname));

// State management for room
const users = {}; 

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    // Initialize user state
    users[socket.id] = { id: socket.id, isMuted: false, isDeafened: false };

    // Send the joining user their ID and the list of existing users
    socket.emit('your-id', socket.id);
    socket.emit('all-users', Object.values(users).filter(u => u.id !== socket.id));
    
    // Notify others that a new user joined
    socket.broadcast.emit('user-joined', users[socket.id]);

    // WebRTC Signaling: Relay offers, answers, and ICE candidates
    socket.on('signal', (data) => {
        io.to(data.to).emit('signal', {
            from: socket.id,
            signal: data.signal
        });
    });

    // Real-time text chat
    socket.on('chat-message', (messageText) => {
        io.emit('chat-message', { sender: socket.id, text: messageText });
    });

    // Handle Mute/Deafen state changes
    socket.on('state-change', (state) => {
        users[socket.id] = { ...users[socket.id], ...state };
        io.emit('user-state-updated', users[socket.id]);
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        delete users[socket.id];
        io.emit('user-disconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
                     
