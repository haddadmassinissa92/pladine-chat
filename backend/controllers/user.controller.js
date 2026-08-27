const User = require('../models/user.model');
const Message = require('../models/message.model');
const cloudinary = require('cloudinary').v2;

// Récupère tous les utilisateurs sauf celui qui fait la requête (pour la liste de contacts)
// Chaque contact est enrichi avec son dernier message échangé et sa date
exports.getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;

    const users = await User.find({ _id: { $ne: loggedInUserId } }).select('-password');

    const usersWithLastMessage = await Promise.all(
      users.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: loggedInUserId, receiver: user._id },
            { sender: user._id, receiver: loggedInUserId },
          ],
        })
          .sort({ createdAt: -1 })
          .select('text image audio createdAt sender');

                const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: loggedInUserId,
          status: { $ne: 'read' },
        });

        return {
          ...user.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      })
    );

    res.status(200).json(usersWithLastMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

// Met à jour la photo de profil de l'utilisateur connecté
exports.updateProfile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucune image fournie.' });
    }

    const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const uploadResponse = await cloudinary.uploader.upload(base64File, {
      folder: 'chat-app/avatars',
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: uploadResponse.secure_url },
      { new: true }
    ).select('-password');

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du profil.' });
  }
};