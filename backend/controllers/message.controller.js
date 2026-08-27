// message.controller.js

// Importation des bibliothèques nécessaires
const cloudinary = require("cloudinary").v2;

// Importation du modèle de message
const Message = require("../models/message.model");

// Récupère l'historique des messages entre l'utilisateur connecté et un autre utilisateur
const { getReceiverSocketId, io } = require("../socket");

// Récupère l'historique des messages entre l'utilisateur connecté et un autre utilisateur
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { isGroup } = req.query;
    const myId = req.user._id;

    let messages;
    if (isGroup === "true") {
      messages = await Message.find({ group: id })
        .sort({ createdAt: 1 })
        .populate("replyTo", "text");
    } else {
      messages = await Message.find({
        $or: [
          { sender: myId, receiver: id },
          { sender: id, receiver: myId },
        ],
      })
        .sort({ createdAt: 1 })
        .populate("replyTo", "text");
    }

    res.status(200).json(messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction pour uploader une image sur Cloudinary avec des tentatives de retry
const uploadWithRetry = async (base64Image, retries = 2) => {
  for (let i = 0; i <= retries; i++) {
    try {
      return await cloudinary.uploader.upload(base64Image, {
        folder: "chat-app",
        timeout: 60000,
      });
    } catch (error) {
      if (i === retries) throw error;
      console.log(`Tentative ${i + 1} échouée, nouvelle tentative...`);
    }
  }
};

// Envoie un nouveau message
exports.sendMessage = async (req, res) => {
  try {
    const { text, replyTo, groupId } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let imageUrl = "";
    let audioUrl = "";

    if (req.file) {
      const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      if (req.file.mimetype.startsWith("audio/")) {
        const uploadResponse = await cloudinary.uploader.upload(base64File, {
          folder: "chat-app",
          resource_type: "video",
        });
        audioUrl = uploadResponse.secure_url;
      } else {
        const uploadResponse = await uploadWithRetry(base64File);
        imageUrl = uploadResponse.secure_url;
      }
    }

    const newMessage = await Message.create({
      sender: senderId,
      receiver: groupId ? null : receiverId,
      group: groupId || null,
      text,
      image: imageUrl,
      audio: audioUrl,
      replyTo: replyTo || null,
    });

    await newMessage.populate("replyTo", "text");

    if (groupId) {
      const Group = require("../models/group.model");
      const group = await Group.findById(groupId);
      group.members.forEach((memberId) => {
        if (memberId.toString() === senderId.toString()) return;
        const memberSocketId = getReceiverSocketId(memberId.toString());
        if (memberSocketId) {
          io.to(memberSocketId).emit("newMessage", newMessage);
        }
      });
    } else {
      const receiverSocketId = getReceiverSocketId(receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("newMessage", newMessage);
      }
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Marque les messages comme lus
exports.markMessagesAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const { isGroup } = req.query;
    const myId = req.user._id;

    if (isGroup === "true") {
      await Message.updateMany(
        { group: id, sender: { $ne: myId }, status: { $ne: "read" } },
        { status: "read", readAt: new Date() },
      );

      const Group = require("../models/group.model");
      const group = await Group.findById(id);
      group.members.forEach((memberId) => {
        if (memberId.toString() === myId.toString()) return;
        const memberSocketId = getReceiverSocketId(memberId.toString());
        if (memberSocketId) {
          io.to(memberSocketId).emit("messagesRead", {
            readBy: myId,
            groupId: id,
          });
        }
      });
    } else {
      await Message.updateMany(
        { sender: id, receiver: myId, status: { $ne: "read" } },
        { status: "read", readAt: new Date() },
      );

      const senderSocketId = getReceiverSocketId(id);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messagesRead", { readBy: myId });
      }
    }

    res.status(200).json({ message: "Messages marqués comme lus." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Supprime un message
exports.deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Action non autorisée." });
    }

    await message.deleteOne();

    const receiverSocketId = getReceiverSocketId(message.receiver.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", { messageId: id });
    }

    res.status(200).json({ message: "Message supprimé." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Modifie un message
exports.editMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Action non autorisée." });
    }

    message.text = text;
    message.edited = true;
    await message.save();

    const receiverSocketId = getReceiverSocketId(message.receiver.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageEdited", message);
    }

    res.status(200).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
