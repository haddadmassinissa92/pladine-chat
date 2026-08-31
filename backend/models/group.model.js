// group.model.js

// Importation du module Mongoose
const mongoose = require("mongoose");

// Définition du schéma principal pour la collection des groupes
const groupSchema = new mongoose.Schema(
  {
    // Nom officiel du groupe de discussion
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Tableau des identifiants des utilisateurs membres actifs du groupe
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Tableau des identifiants des utilisateurs exclus ou bannis du groupe
    blockedMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Indicateur rendant le groupe visible et accessible via une recherche publique
    isDiscoverable: {
      type: Boolean,
      default: false,
    },

    // Tableau des identifiants des utilisateurs en attente d'approbation pour rejoindre le groupe
    joinRequests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Identifiant de l'utilisateur qui a initialement créé le groupe
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  // Injection automatique des propriétés temporelles de création et de modification du groupe
  { timestamps: true },
);

// Publication et exportation du modèle fonctionnel sous l'entité Group
module.exports = mongoose.model("Group", groupSchema);
