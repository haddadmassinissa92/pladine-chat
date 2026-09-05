// routes/auth.route.js

// Importation du framework Express et initialisation du Router de express
// pour definir les routes de l'application
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes, pour se
// protéger des tentatives de force brute sur la connexion et l'inscription
const rateLimit = require('express-rate-limit');

// Importation de l'outil de validation des données envoyées par le client
const { body, validationResult } = require('express-validator');

// Importation des fonctions de controller d'accès et du middleware de protection de session
const { checkAuth } = require('../controllers/auth.controller');
const {
  signup,
  login,
  logout,
  logoutAllDevices,
  verifyEmail,
  resendVerificationEmail,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

// Middleware neutre, utilisé à la place des limiteurs en environnement de
// test, pour que les suites de tests ne se bloquent pas elles-mêmes en
// enchaînant plusieurs appels rapprochés
const noLimit = (req, res, next) => next();

// Limiteur pour la connexion : 10 tentatives maximum par adresse IP toutes
// les 15 minutes. Volontairement plus permissif que pour l'inscription,
// car un utilisateur légitime peut se tromper de mot de passe plusieurs fois.
const loginLimiter =
  process.env.NODE_ENV === 'test'
    ? noLimit
    : rateLimit({
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
const signupLimiter =
  process.env.NODE_ENV === 'test'
    ? noLimit
    : rateLimit({
        windowMs: 60 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          message:
            "Trop de comptes créés depuis cette adresse. Réessaie plus tard.",
        },
      });

// Limiteur pour les emails de vérification/réinitialisation : 5 demandes
// maximum par adresse IP toutes les 15 minutes. Protège le quota d'envoi
// d'emails (limité côté Resend) contre un abus, et empêche de spammer la
// boîte mail de quelqu'un d'autre en boucle.
const emailActionLimiter =
  process.env.NODE_ENV === 'test'
    ? noLimit
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          message: 'Trop de demandes. Réessaie dans quelques minutes.',
        },
      });

// Petit middleware réutilisable : vérifie si les règles de validation
// définies juste avant (via body(...).xxx()) ont été respectées. Si ce
// n'est pas le cas, renvoie une erreur 400 avec le premier message clair
// trouvé, sans jamais laisser une donnée invalide atteindre le contrôleur.
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  next();
};

// Règles de validation pour l'inscription : nom d'utilisateur et mot de
// passe avec des longueurs raisonnables, email au format valide
const signupValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 })
    .withMessage("Le nom d'utilisateur doit contenir entre 3 et 20 caractères.")
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage(
      "Le nom d'utilisateur ne peut contenir que des lettres, chiffres et underscores.",
    ),
  body('email')
    .trim()
    .isEmail()
    .withMessage('Adresse email invalide.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Le mot de passe doit contenir au moins 6 caractères.'),
];

// Règles de validation pour la connexion : on vérifie juste la présence
// et le format de base, la vraie vérification du mot de passe se fait
// ensuite dans le contrôleur en le comparant au hash stocké
const loginValidation = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.'),
  body('password').notEmpty().withMessage('Le mot de passe est requis.'),
];

// Règles de validation pour demander un renvoi d'email de vérification ou
// une réinitialisation de mot de passe : juste une adresse email valide
const emailOnlyValidation = [
  body('email').trim().isEmail().withMessage('Adresse email invalide.').normalizeEmail(),
];

// Règles de validation pour définir un nouveau mot de passe (après clic sur
// le lien de réinitialisation reçu par email)
const newPasswordValidation = [
  body('password')
    .isLength({ min: 6 })
    .withMessage('Le mot de passe doit contenir au moins 6 caractères.'),
];

// Enregistrement des points d'accès (endpoints) publics gérant l'inscription, 
// la connexion et la déconnexion
router.post('/signup', signupLimiter, signupValidation, validate, signup);
router.post('/login', loginLimiter, loginValidation, validate, login);
router.post('/logout', logout);
router.post('/logout-all-devices', protect, logoutAllDevices);

// Confirmation d'adresse email, et renvoi de l'email si besoin
router.get('/verify-email/:token', verifyEmail);
router.post('/resend-verification', emailActionLimiter, emailOnlyValidation, validate, resendVerificationEmail);

// Mot de passe oublié : demande du lien, puis définition du nouveau mot de passe
router.post('/forgot-password', emailActionLimiter, emailOnlyValidation, validate, forgotPassword);
router.post('/reset-password/:token', emailActionLimiter, newPasswordValidation, validate, resetPassword);

// Enregistrement du point d'accès sécurisé permettant au client de 
// valider la persistance de sa session active
router.get('/me', protect, checkAuth);

// Publication et exportation du routeur configuré pour l'intégrer au serveur principal Express
module.exports = router;
