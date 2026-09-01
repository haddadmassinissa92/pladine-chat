// routes/auth.route.js

// Importation du framework Express et initialisation du Router de express
// pour definir les routes de l'application
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes, pour se
// protéger des tentatives de force brute sur la connexion et l'inscription
const rateLimit = require('express-rate-limit');

// Importation des fonctions de controller d'accès et du middleware de protection de session
const { checkAuth } = require('../controllers/auth.controller');
const { signup, login, logout } = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

// Limiteur pour la connexion : 10 tentatives maximum par adresse IP toutes
// les 15 minutes. Volontairement plus permissif que pour l'inscription,
// car un utilisateur légitime peut se tromper de mot de passe plusieurs fois.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message:
      'Trop de tentatives de connexion. Réessaie dans quelques minutes.',
  },
});

// Limiteur pour l'inscription : 5 comptes maximum créés par adresse IP
// toutes les 60 minutes, pour empêcher la création automatisée de comptes
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Trop de comptes créés depuis cette adresse. Réessaie plus tard.",
  },
});

// Enregistrement des points d'accès (endpoints) publics gérant l'inscription, 
// la connexion et la déconnexion
router.post('/signup', signupLimiter, signup);
router.post('/login', loginLimiter, login);
router.post('/logout', logout);

// Enregistrement du point d'accès sécurisé permettant au client de 
// valider la persistance de sa session active
router.get('/me', protect, checkAuth);

// Publication et exportation du routeur configuré pour l'intégrer au serveur principal Express
module.exports = router;
