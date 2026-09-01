// controllers/user.controller.js

// Importation des bibliothèques tierces (Cloudinary pour la gestion des
// images de profil, Bcryptjs pour le hachage sécurisé des mots de passe)
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcryptjs");

// Importation des modèles de données Mongoose requis pour
// la gestion des comptes et de l'historique des discussions
const User = require("../models/user.model");
const Message = require("../models/message.model");

// Fonction d'extraction d'annuaire : récupère l'ensemble des profils inscrits (hors utilisateur connecté),
// effectue des requêtes croisées pour joindre le dernier message privé et calcule le compteur des éléments non lus
exports.getUsersForSidebar = async (req, res) => {
  try {
    // Récupération de l'identifiant de l'utilisateur actif issu du middleware de session
    const loggedInUserId = req.user._id;

    // Extraction de la liste des tiers en excluant les mots de passe de la sélection par sécurité
    const users = await User.find({ _id: { $ne: loggedInUserId } }).select(
      "-password",
    );

    // Traitement asynchrone simultané pour enrichir chaque fiche contact avec l'historique récent
    const usersWithLastMessage = await Promise.all(
      users.map(async (user) => {
        // Recherche documentaire croisée pour isoler l'élément d'échange le plus récent
        const lastMessage = await Message.findOne({
          $or: [
            { sender: loggedInUserId, receiver: user._id },
            { sender: user._id, receiver: loggedInUserId },
          ],
        })
          .sort({ createdAt: -1 })
          .select("text image audio createdAt sender");

        // Décompte précis des messages reçus de ce contact spécifique qui n'ont pas encore été ouverts
        const unreadCount = await Message.countDocuments({
          sender: user._id,
          receiver: loggedInUserId,
          status: { $ne: "read" },
        });

        // Restitution du profil enrichi des propriétés temporelles et du volume d'éléments non lus
        return {
          ...user.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }),
    );

    // Envoi de la structure de données finalisée destinée à alimenter la barre latérale du chat
    res.status(200).json(usersWithLastMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de mise à jour d'avatar : valide le téléversement du fichier multimédia, l'envoie vers l'espace cloud dédié,
// puis applique le nouveau lien sécurisé directement sur la fiche de l'utilisateur connecté
exports.updateProfile = async (req, res) => {
  try {
    // Bloc de sécurité : interruption immédiate du processus si aucun flux de fichier n'est joint à la requête
    if (!req.file) {
      return res.status(400).json({ message: "Aucune image fournie." });
    }

    // Encodage du tampon binaire en chaîne textuelle normalisée Base64 préfixée par son type MIME
    const base64File = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

    // Téléversement du fichier d'illustration vers le sous-dossier spécifié de l'infrastructure Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(base64File, {
      folder: "chat-app/avatars",
    });

    // Modification atomique de la fiche utilisateur avec retour immédiat de l'enregistrement révisé
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: uploadResponse.secure_url },
      { new: true },
    ).select("-password");

    // Restitution du document de profil mis à jour au format de réponse standardisé
    res.status(200).json(updatedUser);
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ message: "Erreur lors de la mise à jour du profil." });
  }
};

// Fonction de sécurité informatique : compare l'ancien mot de passe via hachage
// comparatif, puis applique et chiffre la nouvelle clé d'accès. La présence des
// champs et la longueur minimale du nouveau mot de passe sont déjà garanties
// par la validation appliquée au niveau de la route, avant d'arriver ici.
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    // Recherche documentaire complète du profil utilisateur pour récupérer l'empreinte de sécurité
    const user = await User.findById(req.user._id);

    // Comparaison cryptographique sécurisée du mot de passe soumis avec la valeur hachée stockée
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordValid) {
      return res
        .status(401)
        .json({ message: "Mot de passe actuel incorrect." });
    }

    // Génération d'une nouvelle empreinte numérique sécurisée et sauvegarde en base de données
    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    // Renvoi de la notification de succès confirmant la mise à jour du système d'authentification
    res.status(200).json({ message: "Mot de passe modifié avec succès." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de résiliation de compte : exige une confirmation par mot de passe, supprime définitivement l'enregistrement utilisateur,
// puis procède au nettoyage complet des cookies d'authentification pour déconnecter immédiatement le navigateur.
// La présence du mot de passe est déjà garantie par la validation de la route.
exports.deleteAccount = async (req, res) => {
  try {
    // Extraction du mot de passe de validation transmis au sein du corps de la requête
    const { password } = req.body;

    // Récupération de la fiche d'identité numérique de l'appelant pour le contrôle de sécurité
    const user = await User.findById(req.user._id);

    // Vérification asynchrone de conformité pour valider la légitimité de la demande de suppression
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Mot de passe incorrect." });
    }

    // Retrait irréversible et suppression du document utilisateur au sein de la base MongoDB
    await User.findByIdAndDelete(req.user._id);

    // Invalidation immédiate du jeton d'accès stocké côté client par effacement des cookies de session
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    // Envoi de la notification de clôture définitive du compte utilisateur
    res.status(200).json({ message: "Compte supprimé avec succès." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


// Fonction de modération relationnelle : alterne l'état d'un contact entre autorisé et bloqué en mettant à jour la liste noire
// de l'utilisateur connecté, ce qui lui permet d'interrompre mutuellement l'envoi de messages privés
exports.toggleBlockUser = async (req, res) => {
  try {
    // Extraction de l'identifiant du contact ciblé et récupération de la session active de l'appelant
    const { id } = req.params;
    const myId = req.user._id;

    // Bloc de sécurité : interdiction stricte de tenter une opération de blocage ou déblocage sur son propre profil
    if (id === myId.toString()) {
      return res
        .status(400)
        .json({ message: "Action impossible sur soi-même." });
    }

    // Extraction documentaire de la fiche de l'utilisateur connecté afin de lire son tableau de restrictions
    const me = await User.findById(myId);
    const isBlocked = me.blockedUsers.includes(id);

    // Retrait ou ajout de l'identifiant cible au sein de la liste noire selon son positionnement antérieur
    if (isBlocked) {
      me.blockedUsers = me.blockedUsers.filter((u) => u.toString() !== id);
    } else {
      me.blockedUsers.push(id);
    }

    // Persistance et écriture des modifications relationnelles directement dans la base MongoDB
    await me.save();

    // Transmission de la liste noire actualisée accompagnée du nouvel état de blocage pour synchroniser l'interface client
    res
      .status(200)
      .json({ blockedUsers: me.blockedUsers, blocked: !isBlocked });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
