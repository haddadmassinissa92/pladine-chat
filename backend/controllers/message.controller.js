// message.controller.js

// Importation des bibliothèques nécessaires
const cloudinary = require("cloudinary").v2;
const ogs = require("open-graph-scraper");

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

// Cherche la première URL présente dans un texte, ou null s'il n'y en a pas
const extractFirstUrl = (text) => {
  if (!text) return null;
  const match = text.match(/(https?:\/\/[^\s]+)/i);
  return match ? match[0] : null;
};

// Récupère l'aperçu (titre, description, image) d'une URL, puis met à jour le message
// correspondant en base et diffuse la mise à jour en temps réel. Cette fonction est
// volontairement asynchrone et non bloquante : le message est déjà envoyé et affiché
// avant que l'aperçu ne soit disponible, pour ne pas ralentir l'envoi.
const fetchAndAttachLinkPreview = async (message, url) => {
  try {
    const { result } = await ogs({ url, timeout: 5000 });

    const linkPreview = {
      url,
      title: result.ogTitle || result.twitterTitle || "",
      description: result.ogDescription || result.twitterDescription || "",
      image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || "",
    };

    // Si on n'a rien trouvé d'exploitable, on n'affiche pas d'aperçu
    if (!linkPreview.title && !linkPreview.description && !linkPreview.image) {
      return;
    }

    message.linkPreview = linkPreview;
    await message.save();

    // On réutilise l'événement "messageEdited" existant côté frontend, qui
    // remplace déjà un message par son _id dans la liste affichée
    if (message.group) {
      io.emit("messageEdited", message);
    } else {
      const receiverSocketId = getReceiverSocketId(message.receiver.toString());
      const senderSocketId = getReceiverSocketId(message.sender.toString());
      if (receiverSocketId) io.to(receiverSocketId).emit("messageEdited", message);
      if (senderSocketId) io.to(senderSocketId).emit("messageEdited", message);
    }
  } catch (error) {
    // Un lien qui échoue (page indisponible, timeout...) n'est pas grave :
    // le message reste affiché normalement, juste sans aperçu
    console.log("Aperçu de lien indisponible pour", url);
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

    // Si le texte contient un lien, on récupère son aperçu en arrière-plan,
    // sans faire attendre la réponse déjà envoyée ci-dessus
    const detectedUrl = extractFirstUrl(text);
    if (detectedUrl) {
      fetchAndAttachLinkPreview(newMessage, detectedUrl);
    }
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

// Ajoute ou retire une réaction (emoji) sur un message
exports.reactToMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    const myId = req.user._id;

    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }

    const existingIndex = message.reactions.findIndex(
      (r) => r.user.toString() === myId.toString() && r.emoji === emoji,
    );

    if (existingIndex !== -1) {
      // Déjà réagi avec cet emoji : on retire la réaction
      message.reactions.splice(existingIndex, 1);
    } else {
      // Retire une éventuelle autre réaction de cet utilisateur, puis ajoute la nouvelle
      message.reactions = message.reactions.filter(
        (r) => r.user.toString() !== myId.toString(),
      );
      message.reactions.push({ emoji, user: myId });
    }

    await message.save();
    await message.populate("reactions.user", "username");

    const payload = {
      messageId: message._id,
      reactions: message.reactions,
      groupId: message.group || null,
    };

    if (message.group) {
      io.emit("messageReaction", payload);
    } else {
      const receiverSocketId = getReceiverSocketId(message.receiver.toString());
      const senderSocketId = getReceiverSocketId(message.sender.toString());
      if (receiverSocketId)
        io.to(receiverSocketId).emit("messageReaction", payload);
      if (senderSocketId)
        io.to(senderSocketId).emit("messageReaction", payload);
    }

    res.status(200).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
