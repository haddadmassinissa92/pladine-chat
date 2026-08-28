// message.route.js

// Importation des bibliothèques nécessaires
const express = require('express');

// Importation des middlewares et contrôleurs
const { protect } = require('../middlewares/auth.middleware');
const upload = require('../middlewares/multer.middleware');
const { 
    getMessages, 
    sendMessage, 
    markMessagesAsRead ,
    deleteMessage,
    editMessage,
    reactToMessage
} = require('../controllers/message.controller');

// Création du routeur Express
const router = express.Router();

// Définition des routes pour les messages
router.get('/:id', protect, getMessages);
router.post('/send/:id', protect, upload.single('image'), sendMessage);
router.put('/read/:id', protect, markMessagesAsRead);
router.delete('/:id', protect, deleteMessage);
router.put('/:id', protect, editMessage);
router.put('/react/:id', protect, reactToMessage);

// Exportation du routeur pour l'utiliser dans d'autres parties de l'application
module.exports = router;
