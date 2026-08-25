// group.route.js

// Importation des bibliothèques nécessaires
const express = require('express');

// Creation du router
const router = express.Router();

// Importation des middlewares necessaires
const { protect } = require('../middlewares/auth.middleware');
const { createGroup, getMyGroups, deleteGroup } = require('../controllers/group.controller');


// gestion des routes
router.post('/', protect, createGroup);
router.get('/', protect, getMyGroups);

router.delete('/:id', protect, deleteGroup);

// exporter le module avec le router
module.exports = router;