// routes/message.route.js

// Importation du framework Express et initialisation 
// de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

// Importation de l'outil de validation des données envoyées par le client
const { body, param, validationResult } = require('express-validator');

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

// Règles de validation pour l'envoi d'un message : le texte (s'il existe)
// ne doit pas dépasser une longueur raisonnable, et le message ne peut pas
// être totalement vide (ni texte, ni fichier joint). Les identifiants
// optionnels (réponse, groupe), s'ils sont fournis, doivent être des
// identifiants MongoDB valides pour éviter des requêtes en base malformées.
const sendMessageValidation = [
  body('text')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Le message ne peut pas dépasser 2000 caractères.'),
  body('replyTo')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Référence de réponse invalide.'),
  body('groupId')
    .optional({ checkFalsy: true })
    .isMongoId()
    .withMessage('Identifiant de groupe invalide.'),
  param('id')
    .isMongoId()
    .withMessage('Destinataire invalide.'),
  body('text').custom((value, { req }) => {
    if (!value?.trim() && !req.file) {
      throw new Error('Un message doit contenir du texte ou une pièce jointe.');
    }
    return true;
  }),
];

// Règles de validation pour la modification d'un message : un texte non
// vide et de longueur raisonnable est requis
const editMessageValidation = [
  param('id').isMongoId().withMessage('Message invalide.'),
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Le message ne peut pas être vide.')
    .isLength({ max: 2000 })
    .withMessage('Le message ne peut pas dépasser 2000 caractères.'),
];

// Règles de validation pour une réaction : un emoji doit être fourni,
// avec une longueur courte (un emoji ne fait jamais plus de quelques
// caractères, même composé de plusieurs points de code Unicode)
const reactValidation = [
  param('id').isMongoId().withMessage('Message invalide.'),
  body('emoji')
    .trim()
    .notEmpty()
    .withMessage('Un emoji est requis.')
    .isLength({ max: 8 })
    .withMessage('Emoji invalide.'),
];

// Enregistrement des points d'accès sécurisés encadrant 
// le cycle de vie complet, l'interactivité et l'état des messages échangés
router.get('/:id', protect, getMessages);
router.get('/search/:id', protect, searchMessages);//
router.post(
  '/send/:id',
  protect,
  sendMessageLimiter,
  upload.single('image'),
  sendMessageValidation,
  validate,
  sendMessage,
);
router.delete('/:id', protect, deleteMessage);
router.put('/read/:id', protect, markMessagesAsRead);
router.put('/:id', protect, editMessageValidation, validate, editMessage);
router.put('/react/:id', protect, reactValidation, validate, reactToMessage);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
