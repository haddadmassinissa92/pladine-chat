const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    // Nom d'utilisateur choisis 
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // L'email de l'utilisateur
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    // Le mot de passe
    password: {
      type: String,
      required: true,
    },

    // L'image avatar de l'utilisateur
    avatar: {
      type: String,
      default: "",
    },

    // boolean pour savoir si l'utilisateur est connecter ou pas
    isOnline: {
      type: Boolean,
      default: false,
    },

    // pour le message vu et ca precise l'heure de la vue du message
    lastSeen: {
      type: Date,
      default: Date.now,
    },

    // les utilisateurs bloquer
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
