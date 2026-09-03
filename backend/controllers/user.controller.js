// controllers/user.controller.js

// Importation des bibliothèques tierces (Cloudinary pour la gestion des
// images de profil, Bcryptjs pour le hachage sécurisé des mots de passe)
const cloudinary = require("cloudinary").v2;
const bcrypt = require("bcryptjs");

// Importation des modèles de données Mongoose requis pour
// la gestion des comptes et de l'historique des discussions
const User = require("../models/user.model");
const Message = require("../models/message.model");
const PushSubscription = require("../models/pushSubscription.model");
const logger = require("../logger");
const { getReceiverSocketId, io } = require("../socket");

// Nombre de contacts chargés par page (premier chargement, puis à chaque
// défilement vers le bas de la liste)
const CONTACTS_PER_PAGE = 20;

// Échappe les caractères spéciaux d'une chaîne pour l'utiliser sans risque
// dans une expression régulière
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Fonction d'extraction d'annuaire : récupère les profils des CONTACTS déjà
// ajoutés par l'utilisateur connecté (pas tout l'annuaire des inscrits), de
// façon paginée, avec une recherche optionnelle par nom d'utilisateur ou
// email portant sur ces contacts uniquement, effectue des requêtes croisées
// pour joindre le dernier message privé et calcule le compteur des éléments non lus
exports.getUsersForSidebar = async (req, res) => {
  try {
    // Récupération de l'identifiant de l'utilisateur actif issu du middleware de session
    const loggedInUserId = req.user._id;

    // Numéro de page demandé (1 par défaut), utilisé pour le défilement infini
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const skip = (page - 1) * CONTACTS_PER_PAGE;

    // Liste des contacts ajoutés par l'utilisateur connecté : seuls ces
    // profils peuvent apparaître dans sa liste de conversations
    const currentUser = await User.findById(loggedInUserId).select("contacts");
    const contactIds = currentUser?.contacts || [];

    // Construction du filtre : limité aux contacts ajoutés, et ajoute une
    // recherche insensible à la casse sur le nom d'utilisateur ou l'email
    // si un terme de recherche a été fourni (filtre alors ces contacts,
    // ne cherche jamais dans l'annuaire complet des inscrits)
    const filter = { _id: { $in: contactIds } };
    const search = req.query.search?.trim();
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ username: regex }, { email: regex }];
    }

    // Tri stable par nom d'utilisateur, pour que l'ordre des pages reste
    // cohérent d'un appel à l'autre (indispensable pour une pagination fiable)
    const users = await User.find(filter)
      .select("-password")
      .sort({ username: 1 })
      .skip(skip)
      .limit(CONTACTS_PER_PAGE);

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

    // S'il y a exactement autant de résultats que la taille d'une page, il en
    // reste probablement encore d'autres à charger
    const hasMore = users.length === CONTACTS_PER_PAGE;

    // Envoi de la structure de données finalisée destinée à alimenter la barre latérale du chat
    res.status(200).json({ users: usersWithLastMessage, hasMore });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la récupération des contacts");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Recherche dans l'annuaire COMPLET des inscrits (pas seulement les
// contacts déjà ajoutés), pour permettre à un utilisateur de trouver de
// nouvelles personnes à ajouter. Exige un terme de recherche non vide, pour
// éviter de reproduire le problème inverse (afficher tout le monde par
// défaut) — on ne peut trouver que ce qu'on cherche explicitement.
exports.discoverUsers = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const search = req.query.search?.trim();

    if (!search) {
      return res.status(200).json({ users: [] });
    }

    const currentUser = await User.findById(loggedInUserId).select("contacts");
    const alreadyAddedIds = currentUser?.contacts || [];

    // Personnes à qui on a déjà envoyé une demande, pas encore répondue
    // (la demande vit dans la liste d'attente DE LA CIBLE, pas la nôtre)
    const pendingTargets = await User.find({
      incomingContactRequests: loggedInUserId,
    }).select("_id");
    const pendingIds = pendingTargets.map((u) => u._id);

    const regex = new RegExp(escapeRegex(search), "i");
    const users = await User.find({
      _id: { $ne: loggedInUserId, $nin: [...alreadyAddedIds, ...pendingIds] },
      $or: [{ username: regex }, { email: regex }],
    })
      .select("username email avatar")
      .limit(15);

    res.status(200).json({ users });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la recherche dans l'annuaire");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Ajoute un profil à ses propres contacts. Volontairement à sens unique
// (comme demandé) : chacun voit dans sa liste uniquement les contacts qu'il
// a lui-même ajoutés, indépendamment de si l'autre personne l'a ajouté en
// retour. Ça n'affecte que la visibilité dans la liste, pas la possibilité
// d'échanger des messages (déjà géré séparément par le blocage).
// Envoie une demande de contact : n'ajoute rien tout de suite, place la
// demande dans la liste d'attente de la personne visée, qui devra
// l'accepter pour que le contact devienne mutuel des deux côtés
exports.addContact = async (req, res) => {
  try {
    const { id } = req.params;
    const myId = req.user._id;

    if (id === myId.toString()) {
      return res.status(400).json({ message: "Impossible de s'ajouter soi-même." });
    }

    const target = await User.findById(id).select("contacts incomingContactRequests");
    if (!target) {
      return res.status(404).json({ message: "Utilisateur introuvable." });
    }

    // Déjà contact, ou demande déjà envoyée : rien à refaire
    const alreadyContact = target.contacts.some((c) => c.toString() === myId.toString());
    if (alreadyContact) {
      return res.status(400).json({ message: "Déjà dans tes contacts." });
    }

    await User.updateOne(
      { _id: id },
      { $addToSet: { incomingContactRequests: myId } },
    );

    // Prévient la personne en temps réel, si elle est connectée
    const targetSocketId = getReceiverSocketId(id);
    if (targetSocketId) {
      const me = await User.findById(myId).select("username avatar");
      io.to(targetSocketId).emit("contactRequestReceived", {
        _id: myId,
        username: me.username,
        avatar: me.avatar,
      });
    }

    res.status(200).json({ message: "Demande de contact envoyée." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'envoi d'une demande de contact");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Liste des demandes de contact reçues, en attente d'une réponse
exports.getContactRequests = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("incomingContactRequests")
      .populate("incomingContactRequests", "username avatar email");

    res.status(200).json({ requests: user?.incomingContactRequests || [] });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de la récupération des demandes de contact");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Accepte une demande de contact reçue : le contact devient mutuel, ajouté
// dans la liste des deux personnes
exports.acceptContactRequest = async (req, res) => {
  try {
    const { id } = req.params; // id de la personne qui a envoyé la demande
    const myId = req.user._id;

    await Promise.all([
      User.updateOne(
        { _id: myId },
        { $pull: { incomingContactRequests: id }, $addToSet: { contacts: id } },
      ),
      User.updateOne({ _id: id }, { $addToSet: { contacts: myId } }),
    ]);

    // Prévient l'auteur de la demande en temps réel, pour que son propre
    // affichage se mette à jour tout de suite
    const requesterSocketId = getReceiverSocketId(id);
    if (requesterSocketId) {
      io.to(requesterSocketId).emit("contactRequestAccepted", { _id: myId });
    }

    res.status(200).json({ message: "Contact ajouté." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'acceptation d'une demande de contact");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Refuse une demande de contact reçue : la retire simplement de la liste
// d'attente, aucun contact n'est ajouté
exports.declineContactRequest = async (req, res) => {
  try {
    const { id } = req.params;
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { incomingContactRequests: id } },
    );
    res.status(200).json({ message: "Demande refusée." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du refus d'une demande de contact");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Retire un profil de ses propres contacts (n'affecte que sa propre liste)
exports.removeContact = async (req, res) => {
  try {
    const { id } = req.params;

    await User.updateOne(
      { _id: req.user._id },
      { $pull: { contacts: id } },
    );

    res.status(200).json({ message: "Contact retiré." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du retrait d'un contact");
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
    logger.error({ err: error }, "Erreur lors de la mise à jour du profil");
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
    logger.error({ err: error }, "Erreur lors du changement de mot de passe");
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
    logger.error({ err: error }, "Erreur lors de la suppression du compte");
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
    logger.error({ err: error }, "Erreur lors du blocage/déblocage d'un utilisateur");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Enregistre (ou met à jour) la souscription push de l'appareil/navigateur
// actuel pour l'utilisateur connecté, afin de pouvoir lui envoyer des
// notifications même quand l'application est fermée
exports.subscribeToPush = async (req, res) => {
  try {
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ message: "Souscription push invalide." });
    }

    await PushSubscription.findOneAndUpdate(
      { endpoint },
      { user: req.user._id, endpoint, keys },
      { upsert: true, new: true },
    );

    res.status(200).json({ message: "Abonné aux notifications push." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'abonnement aux notifications push");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Supprime la souscription push de l'appareil/navigateur actuel (l'utilisateur
// a désactivé les notifications)
exports.unsubscribeFromPush = async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteOne({ endpoint, user: req.user._id });
    res.status(200).json({ message: "Désabonné des notifications push." });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du désabonnement des notifications push");
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Coupe ou réactive les notifications (push et temps réel) pour une
// conversation précise (l'id d'un contact ou d'un groupe). Stocké côté
// serveur (contrairement au fond d'écran, purement local) car c'est le
// serveur qui décide d'envoyer ou non une notification push.
exports.toggleMuteConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(req.user._id);

    const alreadyMuted = user.mutedConversations.includes(id);
    if (alreadyMuted) {
      user.mutedConversations = user.mutedConversations.filter((c) => c !== id);
    } else {
      user.mutedConversations.push(id);
    }
    await user.save();

    res.status(200).json({ muted: !alreadyMuted });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors du changement de statut muet");
    res.status(500).json({ message: "Erreur serveur." });
  }
};
