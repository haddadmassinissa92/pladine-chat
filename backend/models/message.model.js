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

    // creation d'un group
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    // Contenu textuel du message
    text: {
      type: String,
      trim: true,
    },

    // contenu pour un message audio
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

    // Indique l'heure dont un message precis a etais lu
    readAt: {
      type: Date,
      default: null,
    },

    // Ajoute une reaction comme l'ajout d'un emoji pour un message
    reactions: [
      {
        emoji: { type: String, required: true },
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
      },
    ],

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
