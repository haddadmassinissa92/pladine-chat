const { Server } = require('socket.io');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    credentials: true,
  },
});

// Garde en mémoire qui est connecté : { userId: socketId }
const userSocketMap = {};

function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

io.on('connection', (socket) => {
  console.log('🔌 Connecté :', socket.id);

  const userId = socket.handshake.query.userId;
  if (userId) {
    userSocketMap[userId] = socket.id;
  }

  // Informe tout le monde de la liste des utilisateurs en ligne
  io.emit('getOnlineUsers', Object.keys(userSocketMap));

  // Indicateur "en train d'écrire..."
  socket.on('typing', ({ receiverId, senderId }) => {
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('userTyping', { senderId });
    }
  });

  socket.on('stopTyping', ({ receiverId, senderId }) => {
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('userStopTyping', { senderId });
    }
  });

  socket.on('disconnect', () => {
    console.log('❌ Déconnecté :', socket.id);
    delete userSocketMap[userId];
    io.emit('getOnlineUsers', Object.keys(userSocketMap));
  });
});

// 
function getOnlineUserIds() {
  return Object.keys(userSocketMap);
}

module.exports = { app, server, io, getReceiverSocketId, getOnlineUserIds };