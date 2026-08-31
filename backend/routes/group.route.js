// routes/group.route.js

// Importation du framework Express et initialisation de son sous-module d'aiguillage des requêtes HTTP
const express = require('express');
const router = express.Router();

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

// Enregistrement des points d'accès fondamentaux servant à 
// initialiser un salon collectif ou lister les participations actives
router.post('/', protect, createGroup);
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
router.post('/request-join/:id', protect, requestToJoin);
router.put('/toggle-discoverable/:id', protect, toggleDiscoverable);
router.put('/approve-join/:id', protect, approveJoinRequest);
router.put('/reject-join/:id', protect, rejectJoinRequest);

// Publication et exportation du routeur configuré pour 
// l'injecter au sein de l'application Express principale
module.exports = router;
