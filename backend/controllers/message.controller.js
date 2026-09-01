// message.controller.js

// Importation des bibliothèques nécessaires
const cloudinary = require("cloudinary").v2;
const ogs = require("open-graph-scraper");

// Importation des modèles
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Group = require("../models/group.model");
const logger = require("../logger");

// Récupère l'historique des messages entre l'utilisateur connecté et un autre utilisateur
const { getReceiverSocketId, io } = require("../socket");

// Nombre de messages chargés par page (premier chargement, puis à chaque remontée dans l'historique)
const MESSAGES_PER_PAGE = 30;

// Nombre maximal de résultats renvoyés par une recherche dans l'historique
const SEARCH_RESULTS_LIMIT = 200;

// Échappe les caractères spéciaux d'une chaîne pour l'utiliser sans risque
// dans une expression régulière (évite qu'un utilisateur casse la recherche
// ou fasse une injection avec des caractères comme . * + ? etc.)
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Construit le filtre de base d'une conversation (groupe ou privée), en tenant
// compte des règles de visibilité des messages en attente d'approbation.
// Factorisé pour être réutilisé à la fois par getMessages et searchMessages.
const buildBaseFilter = async (id, isGroup, myId) => {
  if (isGroup === "true") {
    const group = await Group.findById(id).select("members");
    const isMember = group?.members.some(
      (m) => m.toString() === myId.toString(),
    );

    if (isMember) {
      return { group: id, pendingApproval: { $ne: true } };
    }
    return { group: id, sender: myId, pendingApproval: true };
  }

  return {
    $or: [
      { sender: myId, receiver: id },
      { sender: id, receiver: myId },
    ],
  };
};

// Récupère les messages d'une conversation, avec pagination :
// - sans le paramètre "before" : renvoie les MESSAGES_PER_PAGE derniers messages (les plus récents)
// - avec "before" (date ISO) : renvoie les MESSAGES_PER_PAGE messages juste avant cette date
// Dans les deux cas, la réponse est triée du plus ancien au plus récent, et indique
// si d'autres messages plus anciens existent encore ("hasMore").
//
// Cas particulier des groupes découvrables : si l'utilisateur n'est pas encore membre
// du groupe, il ne voit QUE ses propres messages en attente d'approbation (son message
// de "candidature"), jamais les vrais messages échangés entre les membres. À l'inverse,
// les membres ne voient jamais les messages encore en attente d'approbation des autres.
exports.getMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { isGroup, before } = req.query;
    const myId = req.user._id;

    const baseFilter = await buildBaseFilter(id, isGroup, myId);

    // Si "before" est fourni, on ne prend que les messages plus anciens que cette date
    const filter = before
      ? { ...baseFilter, createdAt: { $lt: new Date(before) } }
      : baseFilter;

    // On récupère les messages les plus récents correspondant au filtre, triés du
    // plus récent au plus ancien, limités à une page, puis on les remet dans l'ordre
    // chronologique normal (du plus ancien au plus récent) pour l'affichage
    const messagesDesc = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(MESSAGES_PER_PAGE)
      .populate("replyTo", "text");

    const messages = messagesDesc.reverse();

    // S'il y a exactement autant de messages que la taille d'une page, il en reste
    // probablement encore d'autres plus anciens à charger
    const hasMore = messagesDesc.length === MESSAGES_PER_PAGE;

    res.status(200).json({ messages, hasMore });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la récupération des messages");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Recherche un mot ou une expression dans tout l'historique d'une conversation
// (pas seulement les messages déjà chargés côté client). Respecte les mêmes
// règles de visibilité que getMessages (groupe/privé, messages en attente).
// Renvoie les messages correspondants triés du plus ancien au plus récent,
// pour permettre une navigation "résultat précédent / suivant" côté frontend.
exports.searchMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const { isGroup, q } = req.query;
    const myId = req.user._id;

    if (!q || !q.trim()) {
      return res.status(200).json({ results: [] });
    }

    const baseFilter = await buildBaseFilter(id, isGroup, myId);

    const filter = {
      ...baseFilter,
      text: { $regex: escapeRegex(q.trim()), $options: "i" },
    };

    const results = await Message.find(filter)
      .sort({ createdAt: 1 })
      .limit(SEARCH_RESULTS_LIMIT)
      .select("_id text sender createdAt");

    res.status(200).json({ results });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la recherche dans les messages");
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
      logger.warn({ attempt: i + 1, err: error }, "Échec d'upload Cloudinary, nouvelle tentative");
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
    logger.info({ url }, "Aperçu de lien indisponible");
  }
};

// Envoie un nouveau message
exports.sendMessage = async (req, res) => {
  try {
    const { text, replyTo, groupId } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Pour une conversation privée (pas un groupe), on vérifie qu'aucune des deux
    // personnes n'a bloqué l'autre avant d'autoriser l'envoi
    if (!groupId) {
      const [sender, receiver] = await Promise.all([
        User.findById(senderId).select("blockedUsers"),
        User.findById(receiverId).select("blockedUsers"),
      ]);

      const senderBlockedReceiver = sender?.blockedUsers.some(
        (u) => u.toString() === receiverId,
      );
      const receiverBlockedSender = receiver?.blockedUsers.some(
        (u) => u.toString() === senderId.toString(),
      );

      if (senderBlockedReceiver || receiverBlockedSender) {
        return res.status(403).json({
          message: "Impossible d'envoyer ce message : utilisateur bloqué.",
        });
      }
    }

    // Détermine si l'expéditeur est déjà membre du groupe visé (le cas échéant),
    // et si son message doit être mis en attente d'approbation
    let isPendingApproval = false;
    let group = null;

    if (groupId) {
      group = await Group.findById(groupId);
      if (!group) {
        return res.status(404).json({ message: "Groupe introuvable." });
      }

      const isMember = group.members.some(
        (m) => m.toString() === senderId.toString(),
      );

      if (!isMember) {
        // Seuls les groupes découvrables acceptent un message de "candidature"
        // de la part d'un non-membre
        if (!group.isDiscoverable) {
          return res.status(403).json({
            message: "Tu dois être membre de ce groupe pour y écrire.",
          });
        }
        isPendingApproval = true;
      } else {
        // Un membre déjà bloqué dans le groupe ne peut pas écrire
        const isBlockedInGroup = group.blockedMembers?.some(
          (u) => u.toString() === senderId.toString(),
        );
        if (isBlockedInGroup) {
          return res.status(403).json({
            message: "Tu as été bloqué dans ce groupe et ne peux pas y écrire.",
          });
        }
      }
    }

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
      pendingApproval: isPendingApproval,
    });

    await newMessage.populate("replyTo", "text");

    if (groupId) {
      if (isPendingApproval) {
        // Le message est masqué aux membres tant qu'il n'est pas approuvé :
        // on ne le diffuse à personne d'autre qu'à l'expéditeur lui-même.
        // On enregistre aussi automatiquement une demande d'adhésion si ce
        // n'est pas déjà fait, pour que le créateur voie qu'il doit statuer.
        const alreadyRequested = group.joinRequests.some(
          (u) => u.toString() === senderId.toString(),
        );
        if (!alreadyRequested) {
          group.joinRequests.push(senderId);
          await group.save();
        }

        const creatorSocketId = getReceiverSocketId(group.createdBy.toString());
        if (creatorSocketId) {
          io.to(creatorSocketId).emit("joinRequestReceived", {
            groupId: group._id,
            groupName: group.name,
          });
        }
      } else {
        group.members.forEach((memberId) => {
          if (memberId.toString() === senderId.toString()) return;
          const memberSocketId = getReceiverSocketId(memberId.toString());
          if (memberSocketId) {
            io.to(memberSocketId).emit("newMessage", newMessage);
          }
        });
      }
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
    logger.error({ err: error }, "Erreur lors de l'envoi d'un message");
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
        {
          group: id,
          sender: { $ne: myId },
          status: { $ne: "read" },
          pendingApproval: { $ne: true },
        },
        { status: "read", readAt: new Date() },
      );

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
    logger.error({ err: error }, "Erreur lors du marquage des messages comme lus");
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
    logger.error({ err: error }, "Erreur lors de la suppression d'un message");
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
    logger.error({ err: error }, "Erreur lors de la modification d'un message");
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
    logger.error({ err: error }, "Erreur lors de l'ajout d'une réaction");
    res.status(500).json({ message: "Erreur serveur." });
  }
};
