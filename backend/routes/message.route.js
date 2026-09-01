// routes/message.route.js

// Importation du framework Express et initialisation 
// de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

// Importation des outils de contrôle de session 
// et du gestionnaire de téléversement de fichiers tampons (Multer)
const { protect } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/multer.middleware');

// Importation de l'ensemble des actions de traitement, 
// d'envoi, de lecture et de modification de l'historique de chat
const { 
    getMessages, 
    sendMessage, 
    markMessagesAsRead ,
    deleteMessage,
    editMessage,
    reactToMessage,
    searchMessages
} = require('../controllers/message.controller');

// Limiteur anti-spam sur l'envoi de messages : 30 messages maximum par minute
// et par utilisateur connecté (pas par IP, pour rester précis même si plusieurs
// utilisateurs partagent la même adresse). Généreux pour un usage normal, mais
// bloque un script ou un compte compromis qui tenterait de flooder une conversation.
const sendMessageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user._id.toString(),
  message: {
    message: 'Tu envoies des messages trop rapidement. Ralentis un peu.',
  },
});

// Enregistrement des points d'accès sécurisés encadrant 
// le cycle de vie complet, l'interactivité et l'état des messages échangés
router.get('/:id', protect, getMessages);
router.get('/search/:id', protect, searchMessages);//
router.post('/send/:id', protect, sendMessageLimiter, upload.single('image'), sendMessage);
router.delete('/:id', protect, deleteMessage);
router.put('/read/:id', protect, markMessagesAsRead);
router.put('/:id', protect, editMessage);
router.put('/react/:id', protect, reactToMessage);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
