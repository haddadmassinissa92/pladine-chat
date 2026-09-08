// models/scheduledMessage.model.js

// Un message texte programmé, en attente d'être réellement envoyé à la
// date/heure choisie. Reste totalement invisible au destinataire (et
// n'apparaît pas dans l'historique de la conversation) tant qu'il n'a pas
// été converti en vrai Message par le service de diffusion (voir
// scheduledMessages.service.js) — ce document est ensuite supprimé.

const mongoose = require("mongoose");

const scheduledMessageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Un seul des deux est renseigné (conversation privée ou groupe)
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    text: {
      type: String,
      required: true,
    },

    scheduledFor: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("ScheduledMessage", scheduledMessageSchema);
