// routes/message.route.js

// Importation du framework Express et initialisation 
// de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

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

// Enregistrement des points d'accès sécurisés encadrant 
// le cycle de vie complet, l'interactivité et l'état des messages échangés
router.get('/:id', protect, getMessages);
router.get('/search/:id', protect, searchMessages);//
router.post('/send/:id', protect, upload.single('image'), sendMessage);
router.delete('/:id', protect, deleteMessage);
router.put('/read/:id', protect, markMessagesAsRead);
router.put('/:id', protect, editMessage);
router.put('/react/:id', protect, reactToMessage);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
