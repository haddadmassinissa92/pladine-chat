// routes/group.route.js

// Importation du framework Express et initialisation de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

// Importation de l'outil de validation des données envoyées par le client
const { body, param, validationResult } = require('express-validator');

// Importation du module de contrôle de sécurité exigeant un jeton d'authentification valide
const { protect } = require('../middlewares/auth.middleware');

// Importation de l'ensemble des fonctions du contrôleur gérant la logique métier des conversations collectives
const {
  createGroup,
  getMyGroups,
  deleteGroup,
  renameGroup,
  addMembers,
  removeMember,
  toggleBlockMember,
  toggleDiscoverable,
  getDiscoverableGroups,
  requestToJoin,
  approveJoinRequest,
  rejectJoinRequest,
} = require('../controllers/group.controller');

// Limiteur anti-spam sur la création de groupes : 10 groupes maximum par
// heure et par utilisateur connecté, pour empêcher la création massive
// automatisée de salons
const createGroupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user._id.toString(),
  message: {
    message: 'Trop de groupes créés récemment. Réessaie plus tard.',
  },
});

// Limiteur anti-spam sur les demandes d'adhésion : 20 demandes maximum par
// heure et par utilisateur connecté, pour empêcher de spammer des demandes
// à de nombreux groupes découvrables d'affilée
const requestToJoinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user._id.toString(),
  message: {
    message: "Trop de demandes d'adhésion envoyées récemment. Réessaie plus tard.",
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

// Règles de validation pour la création d'un groupe : un nom de longueur
// raisonnable, et une liste de membres qui, si fournie, doit être un
// tableau d'identifiants MongoDB valides
const createGroupValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Le nom du groupe doit contenir entre 1 et 50 caractères.'),
  body('members')
    .optional()
    .isArray()
    .withMessage('La liste des membres est invalide.'),
  body('members.*')
    .isMongoId()
    .withMessage('Un des membres sélectionnés est invalide.'),
];

// Règles de validation pour renommer un groupe
const renameGroupValidation = [
  param('id').isMongoId().withMessage('Groupe invalide.'),
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Le nom du groupe doit contenir entre 1 et 50 caractères.'),
];

// Règles de validation pour l'ajout de membres à un groupe existant
const addMembersValidation = [
  param('id').isMongoId().withMessage('Groupe invalide.'),
  body('members')
    .isArray({ min: 1 })
    .withMessage('Au moins un membre doit être sélectionné.'),
  body('members.*')
    .isMongoId()
    .withMessage('Un des membres sélectionnés est invalide.'),
];

// Règles de validation communes aux actions ciblant un membre précis d'un
// groupe (retrait, blocage, approbation/refus d'une demande d'adhésion)
const groupAndMemberIdValidation = [
  param('id').isMongoId().withMessage('Groupe invalide.'),
  body('memberId').isMongoId().withMessage('Membre invalide.'),
];

const groupAndUserIdValidation = [
  param('id').isMongoId().withMessage('Groupe invalide.'),
  body('userId').isMongoId().withMessage('Utilisateur invalide.'),
];

// Enregistrement des points d'accès fondamentaux servant à 
// initialiser un salon collectif ou lister les participations actives
router.post('/', protect, createGroupLimiter, createGroupValidation, validate, createGroup);
router.get('/', protect, getMyGroups);

// Enregistrement des points d'accès d'administration 
// courante réservés aux modifications structurelles ou administratives du salon
router.delete('/:id', protect, param('id').isMongoId(), validate, deleteGroup);
router.put('/rename/:id', protect, renameGroupValidation, validate, renameGroup);
router.put('/add-members/:id', protect, addMembersValidation, validate, addMembers);
router.put('/remove-member/:id', protect, groupAndMemberIdValidation, validate, removeMember);
router.put('/block-member/:id', protect, groupAndMemberIdValidation, validate, toggleBlockMember);

// Enregistrement des points d'accès communautaires 
// dédiés à la visibilité publique, l'exploration et la modération des candidatures
router.get('/discoverable/list', protect, getDiscoverableGroups);
router.post(
  '/request-join/:id',
  protect,
  requestToJoinLimiter,
  param('id').isMongoId().withMessage('Groupe invalide.'),
  validate,
  requestToJoin,
);
router.put('/toggle-discoverable/:id', protect, param('id').isMongoId(), validate, toggleDiscoverable);
router.put('/approve-join/:id', protect, groupAndUserIdValidation, validate, approveJoinRequest);
router.put('/reject-join/:id', protect, groupAndUserIdValidation, validate, rejectJoinRequest);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
