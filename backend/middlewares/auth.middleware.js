// Importation de la bibliothèque permettant de générer et vérifier les JSON Web Tokens
const jwt = require('jsonwebtoken');

// Importation du modèle User pour vérifier l'existence de l'utilisateur en base de données
const User = require('../models/user.model');

// Middleware de protection des routes exigeant une authentification préalable
exports.protect = async (req, res, next) => {
  try {
    // Extraction du jeton de sécurité stocké dans les cookies de la requête HTTP
    const token = req.cookies.token;

    // Bloc de sécurité : interruption si aucun jeton d'accès n'est présent
    if (!token) {
      return res.status(401).json({ message: 'Non autorisé, aucun token fourni.' });
    }

    // Décodage et vérification de la validité du jeton à l'aide de la clé secrète du serveur
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Recherche de l'utilisateur associé à l'ID du jeton en excluant le mot de passe par sécurité
    const user = await User.findById(decoded.userId).select('-password');

    // Bloc de sécurité : interruption si le compte utilisateur a été supprimé ou n'existe plus
    if (!user) {
      return res.status(401).json({ message: 'Utilisateur introuvable.' });
    }

    // Injection des données de l'utilisateur authentifié dans l'objet de requête (req)
    req.user = user;

    // Autorisation de passage permettant d'exécuter la fonction ou la route suivante
    next();
  } catch (error) {
    // Journalisation de l'erreur dans la console du serveur pour le débogage
    // Et la renvoi d'un refus d'accès en cas de jeton expiré, altéré ou corrompu
    console.error(error);
    res.status(401).json({ message: 'Non autorisé, token invalide.' });
  }
};
