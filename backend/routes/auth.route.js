// routes/auth.route.js

// Importation du framework Express et initialisation du Router de express
// pour definir les routes de l'application
const express = require('express');
const router = express.Router();

// Importation des fonctions de controller d'accès et du middleware de protection de session
const { checkAuth } = require('../controllers/auth.controller');
const { signup, login, logout } = require('../controllers/auth.controller');
const { protect } = require('../middlewares/auth.middleware');

// Enregistrement des points d'accès (endpoints) publics gérant l'inscription, 
// la connexion et la déconnexion
router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', logout);

// Enregistrement du point d'accès sécurisé permettant au client de 
// valider la persistance de sa session active
router.get('/me', protect, checkAuth);

// Publication et exportation du routeur configuré pour l'intégrer au serveur principal Express
module.exports = router;
