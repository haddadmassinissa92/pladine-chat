// user.route.js

// Import des bibliotheques necessaires
const express = require('express');

// Import des middlewares multer pour les images et auth.middleware pour la protection
const upload = require('../middlewares/multer.middleware');
const { protect } = require('../middlewares/auth.middleware');

// Import des fonctionnalites de user.controller
const { 
  getUsersForSidebar, 
  updateProfile,
  changePassword,
  deleteAccount
 } = require('../controllers/user.controller');

// fonction qui recupere les utilisateurs connecter
const { getOnlineUserIds } = require('../socket');

// creation et demarrage du router
const router = express.Router();

// creation des routes
router.get('/', protect, getUsersForSidebar);
router.get('/online', protect, (req, res) => {
  res.status(200).json(getOnlineUserIds());
});
router.put('/profile', protect, upload.single('avatar'), updateProfile);
router.put('/change-password', protect, changePassword);
router.delete('/account', protect, deleteAccount);

// exporter le router
module.exports = router;