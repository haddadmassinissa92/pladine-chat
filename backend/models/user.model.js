// user.model.js

// Importation du module Mongoose
const mongoose = require("mongoose");

// Définition du schéma principal pour la collection des utilisateurs
const userSchema = new mongoose.Schema(
  {
    // Nom unique servant d'identifiant public à l'utilisateur
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Adresse de messagerie électronique unique et normalisée en minuscules
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    // Empreinte sécurisée ou clé secrète d'authentification du compte
    password: {
      type: String,
      required: true,
    },

    // Lien ou chemin d'accès vers la photographie de profil de l'utilisateur
    avatar: {
      type: String,
      default: "",
    },

    // Indicateur de présence stipulant si l'utilisateur est actuellement connecté
    isOnline: {
      type: Boolean,
      default: false,
    },

    // Horodatage précis marquant la dernière activité ou déconnexion constatée
    lastSeen: {
      type: Date,
      default: Date.now,
    },

    // Tableau stockant les identifiants des profils mis en liste noire par cet utilisateur
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Identifiants (contact ou groupe) pour lesquels les notifications push
    // sont coupées. Stocké côté serveur : c'est le serveur qui décide
    // d'envoyer ou non une notification push lors d'un nouveau message.
    mutedConversations: {
      type: [String],
      default: [],
    },
  },
  // Injection automatique des propriétés temporelles de création et d'édition du compte
  { timestamps: true }
);

// Publication et exportation du modèle fonctionnel sous l'entité User
module.exports = mongoose.model("User", userSchema);
