// routes/auth.route.js

// Importer les modules nécessaires
const express = require('express');
const router = express.Router();

// Importer les contrôleurs et middlewares nécessaires
const { checkAuth } = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');
const { signup, login, logout } = require('../controllers/auth.controller');

// Définir les routes d'authentification
router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout);

// Route pour vérifier l'authentification de l'utilisateur
router.get('/me', protect, checkAuth);

// Exporter le routeur
module.exports = router;