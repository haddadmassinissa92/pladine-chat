// user.route.js


const express = require('express');
const router = express.Router();
const upload = require('../middlewares/multer.middleware');
const { protect } = require('../middlewares/auth.middleware');
const { getUsersForSidebar, updateProfile } = require('../controllers/user.controller');

const { getOnlineUserIds } = require('../socket');

router.get('/', protect, getUsersForSidebar);

router.get('/online', protect, (req, res) => {
  res.status(200).json(getOnlineUserIds());
});

router.put('/profile', protect, upload.single('avatar'), updateProfile);

module.exports = router;