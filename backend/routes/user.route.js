// routes/user.route.js

// Import des bibliotheques necessaires
const express = require('express');

// Import de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

// Import de l'outil de validation des données envoyées par le client
const { body, param, validationResult } = require('express-validator');

// Import des middlewares multer pour les images et auth.middleware pour la protection
const upload = require('../middlewares/multer.middleware');
const { protect } = require('../middlewares/auth.middleware');

// Import des fonctionnalites de user.controller
const { 
  getUsersForSidebar, 
  updateProfile,
  changePassword,
  deleteAccount,
  toggleBlockUser,
  subscribeToPush,
  unsubscribeFromPush,
  toggleMuteConversation,
  discoverUsers,
  addContact,
  removeContact,
  getContactRequests,
  acceptContactRequest,
  declineContactRequest,
  getSentContactRequests,
  cancelContactRequest,
  getBlockedUsers,
  updateUsername,
  lookupUserByUsername,
 } = require('../controllers/user.controller');

// fonction qui recupere les utilisateurs connecter
const { getOnlineUserIds } = require('../socket');

// creation et demarrage du router
const router = express.Router();

// Limiteur anti-bruteforce sur le changement de mot de passe et la suppression
// de compte : ces deux actions exigent le mot de passe actuel, donc on limite
// les tentatives (5 par 15 minutes et par utilisateur connecté) pour empêcher
// quelqu'un ayant volé une session active de deviner le mot de passe par essais successifs
const passwordSensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user._id.toString(),
  message: {
    message: 'Trop de tentatives. Réessaie dans quelques minutes.',
  },
});

// Petit middleware réutilisable : vérifie si les règles de validation
// définies juste avant ont été respectées, et bloque la requête avec un
// message clair sinon, avant qu'elle n'atteigne le contrôleur
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ message: errors.array()[0].msg });
  }
  next();
};

// Règles de validation pour le changement de mot de passe : les deux champs
// sont requis, et le nouveau mot de passe doit respecter une longueur minimale
const changePasswordValidation = [
  body('currentPassword').notEmpty().withMessage('Le mot de passe actuel est requis.'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('Le nouveau mot de passe doit contenir au moins 6 caractères.'),
];

// Règle de validation pour la suppression de compte : le mot de passe de
// confirmation est requis
const deleteAccountValidation = [
  body('password').notEmpty().withMessage('Le mot de passe est requis pour confirmer.'),
];

// Règle de validation pour le blocage : l'identifiant ciblé doit être un
// identifiant MongoDB valide
const blockUserValidation = [
  param('id').isMongoId().withMessage('Utilisateur invalide.'),
];

// Règle de validation pour l'abonnement aux notifications push : l'objet
// de souscription envoyé par le navigateur doit contenir ces trois champs
const pushSubscribeValidation = [
  body('endpoint').isURL().withMessage('Souscription push invalide.'),
  body('keys.p256dh').notEmpty().withMessage('Souscription push invalide.'),
  body('keys.auth').notEmpty().withMessage('Souscription push invalide.'),
];

// Règle de validation pour le changement de nom d'utilisateur
const updateUsernameValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Le nom d\'utilisateur doit contenir entre 3 et 30 caractères.'),
];

// Règle de validation pour la recherche par nom d'utilisateur exact
const usernameParamValidation = [
  param('username').trim().notEmpty().withMessage('Nom d\'utilisateur requis.'),
];

// creation des routes
router.get('/', protect, getUsersForSidebar);
router.get('/discover', protect, discoverUsers);
router.post('/contacts/:id', protect, blockUserValidation, validate, addContact);
router.delete('/contacts/:id', protect, blockUserValidation, validate, removeContact);
router.get('/contact-requests', protect, getContactRequests);
router.post('/contact-requests/:id/accept', protect, blockUserValidation, validate, acceptContactRequest);
router.post('/contact-requests/:id/decline', protect, blockUserValidation, validate, declineContactRequest);
router.get('/contact-requests/sent', protect, getSentContactRequests);
router.delete('/contact-requests/:id', protect, blockUserValidation, validate, cancelContactRequest);
router.get('/blocked-list', protect, getBlockedUsers);
router.put('/username', protect, updateUsernameValidation, validate, updateUsername);
router.get('/lookup/:username', protect, usernameParamValidation, validate, lookupUserByUsername);
router.get('/online', protect, (req, res) => {
  res.status(200).json(getOnlineUserIds());
});
router.put('/profile', protect, upload.single('avatar'), updateProfile);
router.put(
  '/change-password',
  protect,
  passwordSensitiveLimiter,
  changePasswordValidation,
  validate,
  changePassword,
);
router.put('/block/:id', protect, blockUserValidation, validate, toggleBlockUser);
router.delete(
  '/account',
  protect,
  passwordSensitiveLimiter,
  deleteAccountValidation,
  validate,
  deleteAccount,
);
router.post(
  '/push-subscribe',
  protect,
  pushSubscribeValidation,
  validate,
  subscribeToPush,
);
router.post('/push-unsubscribe', protect, unsubscribeFromPush);
router.put('/mute/:id', protect, toggleMuteConversation);

// exporter le router
module.exports = router;
