// routes/group.route.js

// Importation du framework Express et initialisation de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

// Importation de l'outil de limitation du nombre de requêtes
const rateLimit = require('express-rate-limit');

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

// Enregistrement des points d'accès fondamentaux servant à 
// initialiser un salon collectif ou lister les participations actives
router.post('/', protect, createGroupLimiter, createGroup);
router.get('/', protect, getMyGroups);

// Enregistrement des points d'accès d'administration 
// courante réservés aux modifications structurelles ou administratives du salon
router.delete('/:id', protect, deleteGroup);
router.put('/rename/:id', protect, renameGroup);
router.put('/add-members/:id', protect, addMembers);
router.put('/remove-member/:id', protect, removeMember);
router.put('/block-member/:id', protect, toggleBlockMember);

// Enregistrement des points d'accès communautaires 
// dédiés à la visibilité publique, l'exploration et la modération des candidatures
router.get('/discoverable/list', protect, getDiscoverableGroups);
router.post('/request-join/:id', protect, requestToJoinLimiter, requestToJoin);
router.put('/toggle-discoverable/:id', protect, toggleDiscoverable);
router.put('/approve-join/:id', protect, approveJoinRequest);
router.put('/reject-join/:id', protect, rejectJoinRequest);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
