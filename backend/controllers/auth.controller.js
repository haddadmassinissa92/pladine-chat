// controllers/auth.controller.js

// Importation des outils de hachage de mot de passe, de gestion des jetons (JWT) et du modèle utilisateur
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/user.model");
const logger = require("../logger");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../email.service");

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
// hache le mot de passe pour la sécurité, enregistre le nouveau profil et connecte directement.
//
// NOTE TEMPORAIRE : la vérification d'email par lien (voir verifyEmail plus
// bas) est prête côté code, mais désactivée pour l'instant — Resend, sans
// domaine vérifié, ne peut envoyer qu'à l'adresse du compte Resend
// lui-même, ce qui bloquait la création de comptes de test. Dès qu'un nom
// de domaine est vérifié sur Resend, il suffira de remettre le bloc
// commenté ci-dessous pour réactiver la vérification obligatoire.
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

    // Insertion du nouvel utilisateur dans la base de données, déjà
    // considéré comme vérifié tant que la vérification par email est
    // désactivée (voir note ci-dessus)
    const newUser = await User.create({
      username,
      email,
      password: hashedPassword,
      isVerified: true,
    });

    // Génération instantanée de la session active du nouvel inscrit
    generateTokenAndSetCookie(newUser._id, res);

    // Renvoi des informations publiques du compte créé sans le mot de passe
    res.status(201).json({
      _id: newUser._id,
      username: newUser.username,
      email: newUser.email,
      avatar: newUser.avatar,
      mutedConversations: newUser.mutedConversations,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'inscription");
    res.status(500).json({ message: "Erreur serveur lors de l'inscription." });
  }
};

// Confirme l'adresse email via le jeton reçu par email, active le compte,
// puis ouvre directement une session (l'utilisateur n'a pas besoin de se
// reconnecter juste après avoir confirmé son email)
exports.verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Ce lien de confirmation est invalide ou a expiré.",
      });
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save();

    generateTokenAndSetCookie(user._id, res);

    res.status(200).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      mutedConversations: user.mutedConversations,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la vérification de l'email");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Renvoie un nouvel email de confirmation (compte créé mais email jamais
// reçu ou perdu). Répond toujours le même message générique, qu'un compte
// existe ou non avec cette adresse, pour ne pas laisser deviner quels
// emails sont déjà enregistrés.
exports.resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user && !user.isVerified) {
      const verificationToken = crypto.randomBytes(32).toString("hex");
      user.verificationToken = verificationToken;
      user.verificationTokenExpires = Date.now() + 24 * 60 * 60 * 1000;
      await user.save();
      await sendVerificationEmail(user, verificationToken);
    }

    res.status(200).json({
      message:
        "Si un compte existe avec cette adresse et n'est pas encore confirmé, un nouvel email vient d'être envoyé.",
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du renvoi de l'email de vérification");
    res.status(500).json({ message: "Erreur serveur." });
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

    // Le compte doit être confirmé par email avant de pouvoir se connecter
    // (désactivé temporairement — voir la note dans signup ci-dessus)
    // if (!user.isVerified) {
    //   return res.status(403).json({
    //     message: "Confirme ton adresse email avant de te connecter (vérifie ta boîte mail).",
    //     needsVerification: true,
    //   });
    // }

    // Renouvellement et attribution du cookie de session d'authentification
    generateTokenAndSetCookie(user._id, res);

    // Renvoi les données de l'utilisateur confirmant la réussite de l'authentification
    res.status(200).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      avatar: user.avatar,
      mutedConversations: user.mutedConversations,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la connexion");
    res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
};

// Envoie un email de réinitialisation de mot de passe. Répond toujours le
// même message générique, qu'un compte existe ou non avec cette adresse.
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });

    if (user) {
      const resetToken = crypto.randomBytes(32).toString("hex");
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 heure
      await user.save();
      await sendPasswordResetEmail(user, resetToken);
    }

    res.status(200).json({
      message:
        "Si un compte existe avec cette adresse, un email de réinitialisation vient d'être envoyé.",
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la demande de réinitialisation");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Valide le jeton reçu par email et enregistre le nouveau mot de passe.
// L'utilisateur doit ensuite se reconnecter normalement.
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Ce lien de réinitialisation est invalide ou a expiré.",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.status(200).json({ message: "Mot de passe réinitialisé. Tu peux te reconnecter." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la réinitialisation du mot de passe");
    res.status(500).json({ message: "Erreur serveur." });
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
