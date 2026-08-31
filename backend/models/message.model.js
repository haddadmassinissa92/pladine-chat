// message.model.js

// Importation de Mongoose.
const mongoose = require("mongoose");

// Définition du schéma de message.
const messageSchema = new mongoose.Schema(
  {
    // Référence à l'utilisateur qui envoie le message.
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Référence à l'utilisateur qui reçoit le message.
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Référence au groupe dans lequel le message est envoyé.
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    // Contenu textuel du message.
    text: {
      type: String,
      trim: true,
    },

    // URL ou chemin du fichier audio joint.
    audio: {
      type: String,
      default: "",
    },

    // URL ou chemin de l'image jointe.
    image: {
      type: String,
      default: "",
    },

    // État d'avancement de la distribution du message.
    status: {
      type: String,
      enum: ["sent", "delivered", "read"],
      default: "sent",
    },

    // Date et heure précises de la lecture du message.
    readAt: {
      type: Date,
      default: null,
    },

    // Liste des réactions et émojis laissés par les utilisateurs.
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

    // Métadonnées extraites pour l'aperçu visuel d'un lien web.
    linkPreview: {
      url: String,
      title: String,
      description: String,
      image: String,
    },

    // Indicateur de mise en attente de modération ou de validation.
    pendingApproval: {
      type: Boolean,
      default: false,
    },

    // Indicateur stipulant si le contenu textuel a été modifié après envoi.
    edited: {
      type: Boolean,
      default: false,
    },

    // Référence au message d'origine en cas de réponse ciblée.
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  // Options du schéma pour la gestion automatique des dates de création et de modification.
  { timestamps: true }
);

// Exportation du modèle Mongoose pour l'utiliser dans l'application.
module.exports = mongoose.model("Message", messageSchema);
