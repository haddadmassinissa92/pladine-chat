// controllers/auth.controller.js

// Importation des outils de hachage de mot de passe, de gestion des jetons (JWT) et du modèle utilisateur
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/user.model");
const logger = require("../logger");

// Fonction utilitaire interne chargée de créer un jeton de session chiffré (valable 7 jours)
// et de l'injecter directement dans les cookies de réponse du navigateur pour sécuriser le stockage
const generateTokenAndSetCookie = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  // Configuration stricte du cookie (anti-XSS et sécurisé selon l'environnement de déploiement)
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
  });
};

// Fonction d'inscription : réceptionne les identifiants, vérifie les doublons en base de données,
// hache le mot de passe pour la sécurité, enregistre le nouveau profil et connecte automatiquement l'utilisateur
exports.signup = async (req, res) => {
  try {
    // Extraction des informations envoyées par le formulaire d'inscription
    const { username, email, password } = req.body;

    // Vérification de la disponibilité de l'adresse email et du nom d'utilisateur
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res
        .status(400)
        .json({ message: "Cet email ou nom d'utilisateur est déjà utilisé." });
    }

    // Cryptage irréversible du mot de passe brut avant enregistrement
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertion du nouvel utilisateur dans la base de données
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
    });

    // Génération instantanée de la session active du nouvel inscrit
    generateTokenAndSetCookie(newUser._id, res);

    // Renvoi des informations publiques du compte créé sans le mot de passe
    res.status(201).json({
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      avatar: newUser.avatar,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'inscription");
    res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
  }
};

// Fonction de connexion : recherche l'utilisateur par son email, valide la correspondance
// du mot de passe soumis avec l'empreinte hachée stockée, puis initialise le cookie de session
exports.login = async (req, res) => {
  try {
    // Extraction des données de connexion soumises par l'utilisateur
    const { email, password } = req.body;

    // Recherche de l'utilisateur par son adresse email unique
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(400)
        .json({ message: "Email ou mot de passe incorrect." });
    }

    // Comparaison sécurisée du mot de passe fourni avec celui stocké en base de données
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res
        .status(400)
        .json({ message: "Email ou mot de passe incorrect." });
    }

    // Renouvellement et attribution du cookie de session d'authentification
    generateTokenAndSetCookie(user._id, res);

    // Renvoi les données de l'utilisateur confirmant la réussite de l'authentification
    res.status(200).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la connexion");
    res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
};

// Fonction de déconnexion : supprime et invalide le cookie contenant le jeton d'accès
// pour déconnecter immédiatement le navigateur de l'utilisateur du serveur de chat
exports.logout = (req, res) => {
  // Suppression explicite du cookie de session avec les mêmes options d'environnement
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  });
  res.status(200).json({ message: "Déconnexion réussie." });
};

// Renvoie directement le profil complet de l'utilisateur connecté,
// préalablement extrait et injecté dans la requête par le middleware de protection (`req.user`)
exports.checkAuth = (req, res) => {
  // Renvoi immédiat des données de l'utilisateur authentifié au client (Frontend)
  res.status(200).json(req.user);
};
