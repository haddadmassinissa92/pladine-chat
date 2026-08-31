// controllers/message.controller.js

// Importation des bibliothèques tierces (Cloudinary pour les médias, Open Graph pour l'aperçu de liens)
const cloudinary = require("cloudinary").v2;
const ogs = require("open-graph-scraper");

// Importation des modèles de données Mongoose (structures de la base de données)
const Message = require("../models/message.model");
const User = require("../models/user.model");
const Group = require("../models/group.model");

// Importation du serveur de sockets pour la communication et les notifications en temps réel
const { getReceiverSocketId, io } = require("../socket");

// Nombre maximal de messages chargés simultanément par page d'historique
const MESSAGES_PER_PAGE = 30;

// Fonction d'extraction d'historique : applique un filtrage dynamique selon la nature de la discussion (privée ou collective),
// intègre une clause temporelle optionnelle pour la pagination, puis inverse l'ordre des résultats pour un affichage chronologique
exports.getMessages = async (req, res) => {
  try {
    // Récupération des paramètres d'identification, des options de ciblage et du curseur de pagination temporelle
    const { id } = req.params;
    const { isGroup, before } = req.query;
    const myId = req.user._id;

    // Détermination de l'arborescence de recherche documentaire en distinguant le canal groupe et le canal privé
    const baseFilter =
      isGroup === "true"
        ? { group: id }
        : {
            $or: [
              { sender: myId, receiver: id },
              { sender: id, receiver: myId },
            ],
          };

    // Injection restrictive d'une limite temporelle maximale si le curseur de rechargement est présent
    const filter = before
      ? { ...baseFilter, createdAt: { $lt: new Date(before) } }
      : baseFilter;

    // Extraction des documents correspondants indexés à rebours pour isoler la page de données la plus récente
    const messagesDesc = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(MESSAGES_PER_PAGE)
      .populate("replyTo", "text");

    // Inversion de l'alignement du tableau pour restituer une lecture naturelle du plus ancien au plus récent
    const messages = messagesDesc.reverse();

    // Évaluation quantitative déterminant s'il subsiste un reliquat de messages antérieurs à charger
    const hasMore = messagesDesc.length === MESSAGES_PER_PAGE;

    // Transmission du package de données de discussion accompagné de son indicateur de continuité
    res.status(200).json({ messages, hasMore });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction technique de stockage cloud : orchestre le téléversement d'une image encodée vers la plateforme Cloudinary,
// en déployant un mécanisme de relance séquentiel régressif en cas d'anomalie réseau ou de timeout
const uploadWithRetry = async (base64Image, retries = 2) => {
  // Boucle d'itération déterminant le nombre maximal d'essais alloués avant abandon définitif
  for (let i = 0; i <= retries; i++) {
    try {
      // Tentative d'expédition du flux de données multimédia vers l'espace de stockage distant
      return await cloudinary.uploader.upload(base64Image, {
        folder: "chat-app",
        timeout: 60000,
      });
    } catch (error) {
      // Déclenchement de l'exception si le seuil critique des tentatives autorisées est franchi
      if (i === retries) throw error;
      console.log(`Tentative ${i + 1} échouée, nouvelle tentative...`);
    }
  }
};

// Fonction de filtrage textuel : applique une expression régulière sur une chaîne de caractères
// afin d'isoler et de capturer l'adresse hypertexte initiale, ou renvoie une absence de résultat
const extractFirstUrl = (text) => {
  // Interruption immédiate du processus d'analyse si le corps du message est inexistant
  if (!text) return null;

  // Analyse de la correspondance structurelle avec un schéma standard d'adresse internet
  const match = text.match(/(https?:\/\/[^\s]+)/i);
  return match ? match[0] : null;
};

// Procédure asynchrone d'enrichissement d'information : interroge l'URL collectée pour extraire les métadonnées Open Graph,
// puis met à jour silencieusement le document de base et pousse l'affichage révisé aux terminaux connectés
const fetchAndAttachLinkPreview = async (message, url) => {
  try {
    // Requête HTTP d'extraction des propriétés structurelles de la page web avec garde-fou temporel
    const { result } = await ogs({ url, timeout: 5000 });

    // Agrégation et normalisation des propriétés descriptives et visuelles collectées
    const linkPreview = {
      url,
      title: result.ogTitle || result.twitterTitle || "",
      description: result.ogDescription || result.twitterDescription || "",
      image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || "",
    };

    // Interruption du traitement si aucune information exploitable n'a pu être extraite de la cible
    if (!linkPreview.title && !linkPreview.description && !linkPreview.image) {
      return;
    }

    // Assignation du bloc d'aperçu au sein du message et écriture en base de données
    message.linkPreview = linkPreview;
    await message.save();

    // Routage et diffusion de l'événement de mise à jour aux canaux de communication temps réel concernés
    if (message.group) {
      io.emit("messageEdited", message);
    } else {
      const receiverSocketId = getReceiverSocketId(message.receiver.toString());
      const senderSocketId = getReceiverSocketId(message.sender.toString());
      if (receiverSocketId)
        io.to(receiverSocketId).emit("messageEdited", message);
      if (senderSocketId) io.to(senderSocketId).emit("messageEdited", message);
    }
  } catch (error) {
    // Traitement d'erreur passif évitant de bloquer la distribution globale du message en cas d'échec du lien
    console.log("Aperçu de lien indisponible pour", url);
  }
};

// Fonction d'expédition globale : gère la sécurité des blocages, convertit et téléverse les fichiers médias (images/audio),
// enregistre le message en base, le distribue en temps réel (privé ou groupe) et lance l'extraction asynchrone des liens internet
exports.sendMessage = async (req, res) => {
  try {
    // Récupération du texte, de l'éventuelle réponse, de l'identifiant de
    // groupe et du destinataire privé
    const { text, replyTo, groupId } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Bloc de sécurité : contrôle mutuel de la liste des blocages
    // pour interdire l'envoi en discussion privée
    if (!groupId) {
      const [sender, receiver] = await Promise.all([
        User.findById(senderId).select("blockedUsers"),
        User.findById(receiverId).select("blockedUsers"),
      ]);

      // Vérification mutuelle des listes noires pour s'assurer qu'aucun
      // des deux utilisateurs n'a bloqué l'autre
      const senderBlockedReceiver = sender?.blockedUsers.some(
        (u) => u.toString() === receiverId,
      );
      const receiverBlockedSender = receiver?.blockedUsers.some(
        (u) => u.toString() === senderId.toString(),
      );

      // Bloc de sécurité : interruption immédiate et refus d'envoi
      // si l'un des deux utilisateurs a bloqué l'autre
      if (senderBlockedReceiver || receiverBlockedSender) {
        return res.status(403).json({
          message: "Impossible d'envoyer ce message : utilisateur bloqué.",
        });
      }
    }

    // Initialisation des variables destinées à accueillir les
    // URLs des fichiers stockés sur le cloud
    let imageUrl = "";
    let audioUrl = "";

    // Traitement et téléversement du fichier reçu (image ou note vocale)
    // vers Cloudinary après encodage Base64
    if (req.file) {
      const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      // Routage du téléversement : sépare les flux audio
      // (envoyés comme type vidéo sur Cloudinary) des images standards
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

    // Création et persistance du nouveau document de message avec
    // attribution dynamique des canaux
    const newMessage = await Message.create({
      sender: senderId,
      receiver: groupId ? null : receiverId,
      group: groupId || null,
      text,
      image: imageUrl,
      audio: audioUrl,
      replyTo: replyTo || null,
    });

    // Liaison dynamique pour récupérer le contenu textuel du
    // message d'origine en cas de réponse ciblée
    await newMessage.populate("replyTo", "text");

    // Acheminement et diffusion du message en temps réel via
    // WebSockets selon le type de conversation
    if (groupId) {
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

    // Renvoi immédiat du message créé au client émetteur pour stabiliser l'interface utilisateur
    res.status(201).json(newMessage);

    // Analyse passive du texte en arrière-plan pour générer l'aperçu visuel si une URL est détectée
    const detectedUrl = extractFirstUrl(text);
    if (detectedUrl) {
      fetchAndAttachLinkPreview(newMessage, detectedUrl);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de mise à jour d'état : bascule en lot le statut des messages entrants vers "lu",
// horodate l'action et pousse l'accusé de lecture instantané au canal privé ou à l'ensemble du groupe
exports.markMessagesAsRead = async (req, res) => {
  try {
    // Extraction des paramètres d'identification, du type de salon et de l'utilisateur actif
    const { id } = req.params;
    const { isGroup } = req.query;
    const myId = req.user._id;

    // Traitement par lots des messages et notification collective si le salon est un groupe de discussion
    if (isGroup === "true") {
      await Message.updateMany(
        { group: id, sender: { $ne: myId }, status: { $ne: "read" } },
        { status: "read", readAt: new Date() },
      );

      // Notification temps réel : parcourt les membres du groupe
      // pour envoyer l'accusé de lecture à tous les participants connectés (sauf l'auteur)
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
      // Traitement ciblé et envoi de l'accusé de lecture unique pour les
      // salons de discussion privée
      await Message.updateMany(
        { sender: id, receiver: myId, status: { $ne: "read" } },
        { status: "read", readAt: new Date() },
      );

      const senderSocketId = getReceiverSocketId(id);
      if (senderSocketId) {
        io.to(senderSocketId).emit("messagesRead", { readBy: myId });
      }
    }

    // Validation finale de l'opération envoyée en réponse au client
    res.status(200).json({ message: "Messages marqués comme lus." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


// Fonction de retrait documentaire : recherche l'élément ciblé, valide les droits de propriété de l'auteur,
// efface l'enregistrement de la base de données et synchronise la suppression sur le terminal distant
exports.deleteMessage = async (req, res) => {
  try {
    // Collecte de l'identifiant du message à détruire transmis dans les paramètres d'URL
    const { id } = req.params;
    const message = await Message.findById(id);

    // Bloc de sécurité : interruption de la procédure si le document n'existe pas ou a déjà été effacé
    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }

    // Bloc de sécurité : interdiction de suppression si l'utilisateur connecté n'est pas l'expéditeur d'origine
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Action non autorisée." });
    }

    // Suppression définitive du document de la base de données MongoDB
    await message.deleteOne();

    // Signalement de l'effacement par WebSocket pour actualiser instantanément l'affichage du destinataire
    const receiverSocketId = getReceiverSocketId(message.receiver.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageDeleted", { messageId: id });
    }

    // Notification de confirmation de suppression renvoyée à l'auteur
    res.status(200).json({ message: "Message supprimé." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de mise à jour textuelle : applique les modifications sur le contenu du message,
// bascule l'indicateur d'édition à vrai, puis propage la version révisée au destinataire en temps réel
exports.editMessage = async (req, res) => {
  try {
    // Extraction de l'identifiant du message cible et du nouveau texte envoyé par le client
    const { id } = req.params;
    const { text } = req.body;
    const message = await Message.findById(id);

    // Bloc de sécurité : avortement de la requête si le message est introuvable en base de données
    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }

    // Bloc de sécurité : rejet de la modification si l'appelant n'est pas le créateur originel du message
    if (message.sender.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Action non autorisée." });
    }

    // Assignation du nouveau texte et activation de la propriété de traçabilité des modifications
    message.text = text;
    message.edited = true;
    await message.save();

    // Acheminement instantané du message modifié via la liaison socket du destinataire direct
    const receiverSocketId = getReceiverSocketId(message.receiver.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("messageEdited", message);
    }

    // Renvoi du document mis à jour pour rafraîchir l'interface du client émetteur
    res.status(200).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction d'interactivité : bascule l'état d'une réaction émoji, nettoie les anciens choix de l'utilisateur,
// recalcule le tableau des mentions et distribue les nouvelles métadonnées aux canaux (privés ou collectifs)
exports.reactToMessage = async (req, res) => {
  try {
    // Récupération des paramètres d'URL, de l'émoji sélectionné et de l'auteur de la réaction
    const { id } = req.params;
    const { emoji } = req.body;
    const myId = req.user._id;

    // Validation documentaire préliminaire vérifiant la présence du message ciblé
    const message = await Message.findById(id);
    if (!message) {
      return res.status(404).json({ message: "Message introuvable." });
    }

    // Recherche de l'index d'une réaction identique précédemment soumise par ce même utilisateur
    const existingIndex = message.reactions.findIndex(
      (r) => r.user.toString() === myId.toString() && r.emoji === emoji,
    );

    // Retrait de la réaction si elle existait déjà (effet bascule), sinon remplacement et insertion du nouvel émoji
    if (existingIndex !== -1) {
      message.reactions.splice(existingIndex, 1);
    } else {
      message.reactions = message.reactions.filter(
        (r) => r.user.toString() !== myId.toString(),
      );
      message.reactions.push({ emoji, user: myId });
    }

    // Persistance des données révisées et jointure nominale pour afficher les auteurs des réactions
    await message.save();
    await message.populate("reactions.user", "username");

    // Préparation de l'objet de données centralisé destiné à la mise à jour des interfaces clients
    const payload = {
      messageId: message._id,
      reactions: message.reactions,
      groupId: message.group || null,
    };

    // Acheminement du flux de données en fonction du type de canal (diffusion globale pour un groupe ou ciblée pour un chat privé)
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

    // Restitution de l'état structurel final du message au client émetteur
    res.status(200).json(message);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
