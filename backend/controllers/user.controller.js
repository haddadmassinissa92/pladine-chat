// Import des bibliothèques nécessaires
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcryptjs");

// Import des models 
const User = require("../models/user.model");
const Message = require("../models/message.model");


// Récupère tous les utilisateurs sauf celui qui fait la requête (pour la liste de contacts)
// Chaque contact est enrichi avec son dernier message échangé et sa date
exports.getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;

    const users = await User.find({ _id: { $ne: loggedInUserId } }).select(
      "-password",
    );

    const usersWithLastMessage = await Promise.all(
      users.map(async (user) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: loggedInUserId, receiver: user._id },
            { sender: user._id, receiver: loggedInUserId },
          ],
        })
          .sort({ createdAt: -1 })
          .select("text image audio createdAt sender");

        const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: loggedInUserId,
          status: { $ne: "read" },
        });

        return {
          ...user.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }),
    );

    res.status(200).json(usersWithLastMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Met à jour la photo de profil de l'utilisateur connecté
exports.updateProfile = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Aucune image fournie." });
    }

    const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
    const uploadResponse = await cloudinary.uploader.upload(base64File, {
      folder: "chat-app/avatars",
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: uploadResponse.secure_url },
      { new: true },
    ).select("-password");

    res.status(200).json(updatedUser);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Erreur lors de la mise à jour du profil." });
  }
};



// Modifie le mot de passe de l'utilisateur connecté
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Champs manquants." });
    }
    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({
          message:
            "Le nouveau mot de passe doit contenir au moins 6 caractères.",
        });
    }

    const user = await User.findById(req.user._id);
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ message: "Mot de passe actuel incorrect." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.status(200).json({ message: "Mot de passe modifié avec succès." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Supprime définitivement le compte de l'utilisateur connecté
exports.deleteAccount = async (req, res) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.user._id);
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Mot de passe incorrect." });
    }

    await User.findByIdAndDelete(req.user._id);
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    res.status(200).json({ message: "Compte supprimé avec succès." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
