const { Server } = require("socket.io");
const http = require("http");
const express = require("express");
const logger = require("./logger");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 60000,
});

// Garde en mémoire qui est connecté : { userId: socketId }
const userSocketMap = {};

function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

io.on("connection", (socket) => {
  logger.info({ socketId: socket.id }, "Connexion socket établie");

  const userId = socket.handshake.query.userId;
  if (userId) {
    userSocketMap[userId] = socket.id;
  }

  // Informe tout le monde de la liste des utilisateurs en ligne
  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  // Indicateur "en train d'écrire..."
  socket.on("typing", ({ receiverId, senderId }) => {
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("userTyping", { senderId });
    }
  });

  socket.on("stopTyping", ({ receiverId, senderId }) => {
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("userStopTyping", { senderId });
    }
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Connexion socket fermée");
    if (userSocketMap[userId] === socket.id) {
      delete userSocketMap[userId];
      io.emit("getOnlineUsers", Object.keys(userSocketMap));
    }
  });
});

//
function getOnlineUserIds() {
  return Object.keys(userSocketMap);
}

module.exports = { app, server, io, getReceiverSocketId, getOnlineUserIds };
