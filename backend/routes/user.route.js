const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { getUsersForSidebar } = require('../controllers/user.controller');

router.get('/', protect, getUsersForSidebar);

module.exports = router;