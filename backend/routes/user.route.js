const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth.middleware');
const { getUsersForSidebar } = require('../controllers/user.controller');

const { getOnlineUserIds } = require('../socket');

router.get('/', protect, getUsersForSidebar);

router.get('/online', protect, (req, res) => {
  res.status(200).json(getOnlineUserIds());
});

module.exports = router;