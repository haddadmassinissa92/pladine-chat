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

// Garde en mémoire qui est actuellement dans chaque salle d'appel de groupe :
// { groupId: { userId: { socketId, userId, username, avatar } } }
const groupCallRooms = {};

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

  // --- Signalisation WebRTC pour les appels audio/vidéo 1-à-1 ---
  // Le serveur ne fait que relayer les messages entre les deux participants ;
  // toute la logique d'appel (flux média, connexion peer-to-peer) se passe
  // directement entre les deux navigateurs une fois la connexion établie.

  // L'appelant initie l'appel : on relaie son offre au destinataire, ou on
  // prévient immédiatement l'appelant si le destinataire n'est pas en ligne
  socket.on("callUser", ({ to, from, offer, callType, callerName, callerAvatar }) => {
    const receiverSocketId = getReceiverSocketId(to);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("incomingCall", {
        from,
        offer,
        callType,
        callerName,
        callerAvatar,
      });
    } else {
      io.to(socket.id).emit("callUnavailable", { to });
    }
  });

  // Le destinataire accepte l'appel : on relaie sa réponse à l'appelant
  socket.on("answerCall", ({ to, answer }) => {
    const callerSocketId = getReceiverSocketId(to);
    if (callerSocketId) {
      io.to(callerSocketId).emit("callAccepted", { answer });
    }
  });

  // Échange des "candidats" réseau nécessaires à l'établissement de la
  // connexion directe entre les deux navigateurs (protocole ICE)
  socket.on("iceCandidate", ({ to, candidate }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("iceCandidate", { candidate });
    }
  });

  // Le destinataire refuse l'appel
  socket.on("rejectCall", ({ to }) => {
    const callerSocketId = getReceiverSocketId(to);
    if (callerSocketId) {
      io.to(callerSocketId).emit("callRejected");
    }
  });

  // L'un des deux participants raccroche, à n'importe quel moment de l'appel
  socket.on("endCall", ({ to }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callEnded");
    }
  });

  // Un appel privé à 2 se transforme en appel de groupe : on prévient
  // l'autre participant pour qu'il rejoigne lui aussi la nouvelle "salle"
  socket.on("callUpgradedToGroup", ({ to, groupId, groupName }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("callUpgradedToGroup", { groupId, groupName });
    }
  });

  // --- Signalisation WebRTC pour les appels de groupe (topologie "mesh") ---
  // Chaque participant se connecte directement à chaque autre participant.
  // Le serveur garde en mémoire qui est actuellement "dans la salle" de
  // chaque appel de groupe : { groupId: { userId: socketId } }

  // L'initiateur prévient les membres du groupe (hors lui-même) qu'un appel démarre
  socket.on("startGroupCall", ({ groupId, targetUserIds, callType, callerName, callerAvatar, callerId }) => {
    targetUserIds.forEach((userId) => {
      const targetSocketId = getReceiverSocketId(userId);
      if (targetSocketId) {
        io.to(targetSocketId).emit("incomingGroupCall", {
          groupId,
          callType,
          callerName,
          callerAvatar,
          callerId,
        });
      }
    });
  });

  // Un participant rejoint effectivement la salle d'appel (à l'initiation ou
  // en acceptant) : on l'ajoute à la liste, et on lui renvoie qui s'y trouve déjà
  socket.on("joinGroupCall", ({ groupId, userId, username, avatar }) => {
    if (!groupCallRooms[groupId]) groupCallRooms[groupId] = {};

    // Liste des participants déjà présents, AVANT d'ajouter le nouvel arrivant
    const existingParticipants = Object.values(groupCallRooms[groupId]).map(
      (p) => ({ userId: p.userId, username: p.username, avatar: p.avatar }),
    );

    groupCallRooms[groupId][userId] = { socketId: socket.id, userId, username, avatar };

    // On renvoie au nouvel arrivant la liste de ceux déjà présents, pour
    // qu'il initie une connexion directe vers chacun d'eux
    io.to(socket.id).emit("groupCallParticipants", { groupId, participants: existingParticipants });

    // On prévient les participants déjà présents qu'quelqu'un vient de rejoindre
    existingParticipants.forEach((p) => {
      const existingSocketId = getReceiverSocketId(p.userId);
      if (existingSocketId) {
        io.to(existingSocketId).emit("userJoinedGroupCall", { groupId, userId, username, avatar });
      }
    });
  });

  // Le nouvel arrivant envoie une offre à un participant déjà présent
  socket.on("groupCallOffer", ({ to, from, offer, groupId, fromUsername, fromAvatar }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("incomingGroupCallOffer", {
        from,
        offer,
        groupId,
        fromUsername,
        fromAvatar,
      });
    }
  });

  // Le participant déjà présent répond à l'offre du nouvel arrivant
  socket.on("groupCallAnswer", ({ to, from, answer }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("groupCallAnswerReceived", { from, answer });
    }
  });

  // Échange des candidats ICE entre deux participants précis d'un appel de groupe
  socket.on("groupIceCandidate", ({ to, from, candidate }) => {
    const targetSocketId = getReceiverSocketId(to);
    if (targetSocketId) {
      io.to(targetSocketId).emit("groupIceCandidate", { from, candidate });
    }
  });

  // Un participant quitte la salle d'appel : on le retire et on prévient les autres
  socket.on("leaveGroupCall", ({ groupId, userId }) => {
    if (groupCallRooms[groupId]) {
      delete groupCallRooms[groupId][userId];
      if (Object.keys(groupCallRooms[groupId]).length === 0) {
        delete groupCallRooms[groupId];
      } else {
        Object.values(groupCallRooms[groupId]).forEach((p) => {
          const socketId = getReceiverSocketId(p.userId);
          if (socketId) io.to(socketId).emit("userLeftGroupCall", { groupId, userId });
        });
      }
    }
  });

  socket.on("disconnect", () => {
    logger.info({ socketId: socket.id }, "Connexion socket fermée");
    if (userSocketMap[userId] === socket.id) {
      delete userSocketMap[userId];
      io.emit("getOnlineUsers", Object.keys(userSocketMap));
    }

    // Retire cet utilisateur de toute salle d'appel de groupe où il se
    // trouvait, et prévient les autres participants restants
    Object.keys(groupCallRooms).forEach((groupId) => {
      if (groupCallRooms[groupId][userId]) {
        delete groupCallRooms[groupId][userId];
        if (Object.keys(groupCallRooms[groupId]).length === 0) {
          delete groupCallRooms[groupId];
        } else {
          Object.values(groupCallRooms[groupId]).forEach((p) => {
            io.to(p.socketId).emit("userLeftGroupCall", { groupId, userId });
          });
        }
      }
    });
  });
});

//
function getOnlineUserIds() {
  return Object.keys(userSocketMap);
}

module.exports = { app, server, io, getReceiverSocketId, getOnlineUserIds };
