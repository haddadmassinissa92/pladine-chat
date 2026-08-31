// group.route.js

// Importation des bibliothèques nécessaires
const express = require('express');

// Creation du router
const router = express.Router();

// Importation des middlewares necessaires
const { protect } = require('../middlewares/auth.middleware');
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


// gestion des routes
router.post('/', protect, createGroup);
router.get('/', protect, getMyGroups);

router.delete('/:id', protect, deleteGroup);
router.put('/rename/:id', protect, renameGroup);
router.put('/add-members/:id', protect, addMembers);
router.put('/remove-member/:id', protect, removeMember);
router.put('/block-member/:id', protect, toggleBlockMember);

router.put('/toggle-discoverable/:id', protect, toggleDiscoverable);
router.get('/discoverable/list', protect, getDiscoverableGroups);
router.post('/request-join/:id', protect, requestToJoin);
router.put('/approve-join/:id', protect, approveJoinRequest);
router.put('/reject-join/:id', protect, rejectJoinRequest);

// exporter le module avec le router
module.exports = router;
