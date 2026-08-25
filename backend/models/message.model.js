// message.model.js

// Importation de Mongoose
const mongoose = require("mongoose");

// Définition du schéma de message
const messageSchema = new mongoose.Schema(
  {
    // Référence à l'utilisateur qui envoie le message
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Référence à l'utilisateur qui reçoit le message
    // Ou à un groupe si le message est envoyé dans un groupe
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    // Contenu textuel du message
    text: {
      type: String,
      trim: true,
    },

    audio: {
      type: String,
      default: "",
    },

    // URL de l'image associée au message (si applicable)
    image: {
      type: String,
      default: "",
    },

    // Statut du message (envoyé, livré, lu)
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },

    // Indique si le message a été modifié
    edited: {
      type: Boolean,
      default: false,
    },

    // Référence à un message auquel ce message répond (si applicable)
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  // Options du schéma pour inclure les timestamps (createdAt et updatedAt)
  // pour gerer automatiquement les dates de création et de mise à jour des messages
  { timestamps: true },
);

// Création du modèle de message
module.exports = mongoose.model("Message", messageSchema);
