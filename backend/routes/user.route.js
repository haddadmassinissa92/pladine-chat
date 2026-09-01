// routes/user.route.js

// Import des bibliotheques necessaires
const express = require('express');

// Import de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

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

// creation des routes
router.get('/', protect, getUsersForSidebar);
router.get('/online', protect, (req, res) => {
  res.status(200).json(getOnlineUserIds());
});
router.put('/profile', protect, upload.single('avatar'), updateProfile);
router.put('/change-password', protect, passwordSensitiveLimiter, changePassword);
router.put('/block/:id', protect, toggleBlockUser);
router.delete('/account', protect, passwordSensitiveLimiter, deleteAccount);

// exporter le router
module.exports = router;
