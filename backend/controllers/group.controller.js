// controllers/group.controller.js

// Importation locale du modèle Message requis pour exécuter
// les requêtes de recherche d'historique
const Group = require("../models/group.model");
const Message = require("../models/message.model");
const { getReceiverSocketId, io } = require("../socket");

// controllers/group.controller.js

// Fonction de création de groupe : initialise un nouveau salon de discussion collective,
// fusionne les invités avec le créateur et supprime les doublons d'identifiants
exports.createGroup = async (req, res) => {
  try {
    // Extraction du nom du groupe et de la liste initiale des membres invités
    const { name, members } = req.body;

    // Récupération de l'identifiant unique de l'utilisateur qui effectue la requête
    const createdBy = req.user._id;

    // Fusion de la liste des invités et du créateur au sein d'un Set pour éliminer les doublons
    const allMembers = [...new Set([...members, createdBy.toString()])];

    // Insertion et enregistrement du nouveau document de groupe dans la base de données
    const group = await Group.create({
      name,
      members: allMembers,
      createdBy,
    });

    // Renvoi du document complet du groupe créé avec succès
    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de récupération de listes : extrait l'ensemble des groupes dont l'utilisateur fait partie,
// joint dynamiquement le dernier message échangé et calcule le volume de messages non lus par groupe
exports.getMyGroups = async (req, res) => {
  try {
    // Recherche des groupes contenant l'ID de l'utilisateur avec
    // jointure du nom des membres et des requêtes
    const groups = await Group.find({ members: req.user._id })
      .populate("members", "username")
      .populate("joinRequests", "username");

    // Traitement asynchrone simultané de chaque groupe pour
    // enrichir les métadonnées de la réponse
    const groupsWithLastMessage = await Promise.all(
      groups.map(async (group) => {
        // Extraction sélective du message le plus récent envoyé au sein de ce groupe spécifique
        const lastMessage = await Message.findOne({ group: group._id })
          .sort({ createdAt: -1 })
          .select("text image audio createdAt sender")
          .populate("sender", "username");

        // Décompte des documents de messages reçus, non lus et émis par d'autres collaborateurs
        const unreadCount = await Message.countDocuments({
          group: group._id,
          sender: { $ne: req.user._id },
          status: { $ne: "read" },
        });

        // Restitution de l'objet de groupe enrichi des clés lastMessage et unreadCount
        return {
          ...group.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }),
    );

    // Renvoi de la liste finale des salons de discussion configurés pour le client
    res.status(200).json(groupsWithLastMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de suppression de salon : vérifie l'existence du groupe ciblé, valide les droits d'administration
// exclusifs du créateur d'origine, puis efface définitivement l'enregistrement de la base de données
exports.deleteGroup = async (req, res) => {
  try {
    // Extraction du paramètre d'URL contenant l'identifiant du groupe à effacer
    const { id } = req.params;

    // Recherche documentaire du groupe concerné dans la base de données
    const group = await Group.findById(id);

    // Bloc de sécurité : interruption si l'identifiant de groupe ne correspond à aucun document actif
    if (!group) {
      return res.status(404).json({ message: "Groupe introuvable." });
    }

    // Bloc de sécurité : interdiction de suppression si l'auteur de la requête n'est pas le propriétaire
    if (group.createdBy.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Seul le créateur peut supprimer le groupe." });
    }

    // Suppression définitive du document de groupe validé
    await group.deleteOne();

    // Notification de confirmation de retrait envoyée au client final
    res.status(200).json({ message: "Groupe supprimé." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Diffuse en temps réel la mise à jour d'un groupe à tous ses membres
const broadcastGroupUpdate = (group) => {
  group.members.forEach((member) => {
    const memberId = member._id ? member._id.toString() : member.toString();
    const memberSocketId = getReceiverSocketId(memberId);
    if (memberSocketId) {
      io.to(memberSocketId).emit("groupUpdated", group);
    }
  });
};

// Vérifie que l'utilisateur connecté est bien le créateur du groupe, sinon
// répond avec une erreur 403 et renvoie null (à utiliser dans les fonctions ci-dessous)
const requireGroupCreator = async (req, res, id) => {
  const group = await Group.findById(id);
  if (!group) {
    res.status(404).json({ message: "Groupe introuvable." });
    return null;
  }
  if (group.createdBy.toString() !== req.user._id.toString()) {
    res.status(403).json({ message: "Action réservée au créateur du groupe." });
    return null;
  }
  return group;
};


// Fonction de modification d'intitulé : valide le nouveau texte soumis, applique la modification en base de données,
// puis propage la mise à jour en temps réel à l'ensemble des participants connectés
exports.renameGroup = async (req, res) => {
  try {
    // Extraction des paramètres d'identification du groupe et de la nouvelle valeur textuelle
    const { id } = req.params;
    const { name } = req.body;

    // Bloc de sécurité : refus de la requête si le champ du nouveau nom est vide ou mal formé
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Le nom du groupe est requis." });
    }

    // Appel d'une fonction utilitaire de contrôle d'accès pour valider les droits de propriété du créateur
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Mise à jour de la propriété descriptive après suppression des espaces superflus
    group.name = name.trim();
    await group.save();
    await group.populate("members", "username");

    // Notification globale par socket pour actualiser l'affichage chez tous les membres connectés
    broadcastGroupUpdate(group);

    // Restitution du document de groupe modifié au format de réponse standardisé
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction d'invitation groupée : reçoit un ensemble de profils cibles, extrait uniquement ceux absents
// de la liste actuelle des participants afin d'éviter les doublons, puis met à jour le salon
exports.addMembers = async (req, res) => {
  try {
    // Récupération de l'identifiant du salon cible et du tableau des nouveaux comptes invités
    const { id } = req.params;
    const { members } = req.body;

    // Bloc de sécurité : rejet immédiat si la structure de la liste reçue est invalide ou vide
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ message: "Aucun membre à ajouter." });
    }

    // Appel de la vérification asynchrone des droits de propriété intellectuelle du créateur
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Isolement des identifiants textuels de la composition actuelle du salon de chat
    const currentMemberIds = group.members.map((m) => m.toString());
    const newMemberIds = members.filter((m) => !currentMemberIds.includes(m));

    // Fusion cumulative des participants existants et des identifiants valides filtrés
    group.members = [...group.members, ...newMemberIds];
    await group.save();
    await group.populate("members", "username");

    // Diffusion instantanée de la mise à jour structurelle du salon à l'ensemble du réseau
    broadcastGroupUpdate(group);

    // Transmission des données mises à jour de l'entité de groupe modifiée
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction d'exclusion de membre : déconnecte et extrait un participant du salon actif,
// nettoie ses privilèges résiduels au sein des listes de bannissement et l'avertit par signalement Socket
exports.removeMember = async (req, res) => {
  try {
    // Collecte de l'identifiant du groupe de destination et du profil de l'utilisateur visé
    const { id } = req.params;
    const { memberId } = req.body;

    // Bloc de sécurité : interruption si l'identifiant du membre ciblé par l'action est manquant
    if (!memberId) {
      return res.status(400).json({ message: "Membre à retirer manquant." });
    }

    // Exécution du contrôle asynchrone de sécurité validant le statut d'administrateur de l'émetteur
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Bloc de sécurité : interdiction stricte d'auto-exclusion pour le compte créateur d'origine
    if (memberId === group.createdBy.toString()) {
      return res
        .status(400)
        .json({ message: "Le créateur ne peut pas se retirer lui-même." });
    }

    // Filtrage correctif de la liste pour extraire définitivement le compte exclu
    group.members = group.members.filter((m) => m.toString() !== memberId);
    group.blockedMembers = group.blockedMembers.filter(
      (m) => m.toString() !== memberId,
    );

    // Sauvegarde en base de données et jointure dynamique des noms d'utilisateurs restants
    await group.save();
    await group.populate("members", "username");

    // Notification globale par socket pour actualiser l'interface des membres toujours présents
    broadcastGroupUpdate(group);

    // Recherche de la connexion WebSocket active du profil banni pour provoquer le retrait forcé
    const removedSocketId = getReceiverSocketId(memberId);
    if (removedSocketId) {
      io.to(removedSocketId).emit("removedFromGroup", { groupId: id });
    }

    // Restitution du document final expurgé du membre en guise de confirmation positive
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


// Fonction de restriction de parole : alterne dynamiquement le statut d'un membre entre bloqué et autorisé,
// lui interdisant ou lui accordant à nouveau le droit d'envoyer des messages au sein du salon collectif
exports.toggleBlockMember = async (req, res) => {
  try {
    // Extraction des paramètres d'identification de la discussion et de l'utilisateur visé
    const { id } = req.params;
    const { memberId } = req.body;

    // Bloc de sécurité : rejet de la requête si l'identifiant du membre cible est manquant
    if (!memberId) {
      return res.status(400).json({ message: "Membre concerné manquant." });
    }

    // Exécution du contrôle asynchrone validant que l'auteur de l'action est bien le créateur du groupe
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Bloc de sécurité : interdiction stricte pour le créateur de restreindre ses propres droits d'écriture
    if (memberId === group.createdBy.toString()) {
      return res
        .status(400)
        .json({ message: "Le créateur ne peut pas se bloquer lui-même." });
    }

    // Analyse du tableau des bannissements pour vérifier si le membre y figure déjà
    const isBlocked = group.blockedMembers.some(
      (m) => m.toString() === memberId,
    );

    // Retrait ou ajout de l'utilisateur dans la liste des restrictions selon son état précédent
    if (isBlocked) {
      group.blockedMembers = group.blockedMembers.filter(
        (m) => m.toString() !== memberId,
      );
    } else {
      group.blockedMembers.push(memberId);
    }

    // Enregistrement des modifications en base de données et actualisation des jointures d'utilisateurs
    await group.save();
    await group.populate("members", "username");

    // Propa-gation des nouvelles règles de restriction en temps réel via le serveur de sockets
    broadcastGroupUpdate(group);

    // Restitution du document de groupe révisé au client émetteur
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de visibilité publique : commute l'état d'exposition du groupe pour le rendre soit repérable
// par la communauté via l'exploration, soit totalement masqué et privé
exports.toggleDiscoverable = async (req, res) => {
  try {
    // Collecte de l'identifiant unique du salon ciblé par la modification de visibilité
    const { id } = req.params;

    // Validation des privilèges administratifs requis pour modifier les paramètres d'exposition
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Inversion de la valeur booléenne définissant le statut de découverte publique du salon
    group.isDiscoverable = !group.isDiscoverable;
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    // Notification instantanée du changement de visibilité ou d'état envoyé aux sockets connectés
    broadcastGroupUpdate(group);

    // Transmission des données de groupe actualisées en guise de confirmation
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction d'exploration de salons : extrait tous les groupes publics configurés comme découvrables,
// en excluant ceux dont le demandeur est déjà membre, puis qualifie l'état de ses requêtes en attente
exports.getDiscoverableGroups = async (req, res) => {
  try {
    // Récupération de l'identifiant de session de l'utilisateur actif pour filtrer la recherche
    const myId = req.user._id;

    // Requête ciblant les documents publics dont la liste des participants n'inclut pas le demandeur
    const groups = await Group.find({
      isDiscoverable: true,
      members: { $ne: myId },
    }).select("name members joinRequests createdBy");

    // Restructuration des résultats pour calculer le volume de membres et évaluer si une demande est déjà soumise
    const groupsWithStatus = groups.map((group) => ({
      _id: group._id,
      name: group.name,
      memberCount: group.members.length,
      createdBy: group.createdBy,
      requestPending: group.joinRequests.some(
        (u) => u.toString() === myId.toString(),
      ),
    }));

    // Envoi de la liste formatée des salons accessibles à la candidature publique
    res.status(200).json(groupsWithStatus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de candidature : soumet une demande officielle d'intégration à un groupe public,
// effectue les contrôles de sécurité d'admissibilité, puis alerte l'administrateur en temps réel
exports.requestToJoin = async (req, res) => {
  try {
    // Récupération des identifiants respectifs du salon visé et de l'utilisateur postulant
    const { id } = req.params;
    const myId = req.user._id;

    // Recherche documentaire du groupe pour s'assurer de son existence fonctionnelle
    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({ message: "Groupe introuvable." });
    }

    // Bloc de sécurité : refus si le groupe a été reconfiguré en mode privé entre-temps
    if (!group.isDiscoverable) {
      return res
        .status(403)
        .json({ message: "Ce groupe n'est pas découvrable." });
    }

    // Bloc de sécurité : annulation de la procédure si le postulant fait déjà partie des membres actifs
    if (group.members.some((m) => m.toString() === myId.toString())) {
      return res
        .status(400)
        .json({ message: "Tu es déjà membre de ce groupe." });
    }

    // Bloc de sécurité : rejet de la requête si une candidature identique est déjà enregistrée en attente
    if (group.joinRequests.some((u) => u.toString() === myId.toString())) {
      return res.status(400).json({ message: "Demande déjà envoyée." });
    }

    // Insertion de l'identifiant du postulant dans la liste d'attente d'approbation du salon
    group.joinRequests.push(myId);
    await group.save();

    // Localisation de la connexion WebSocket de l'administrateur pour lui pousser une alerte instantanée
    const creatorSocketId = getReceiverSocketId(group.createdBy.toString());
    if (creatorSocketId) {
      io.to(creatorSocketId).emit("joinRequestReceived", {
        groupId: group._id,
        groupName: group.name,
      });
    }

    // Notification de succès confirmant l'envoi et la prise en compte de la candidature
    res.status(200).json({ message: "Demande envoyée." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


// Fonction d'admission officielle : valide la présence du postulant dans la liste d'attente,
// bascule son identifiant vers le tableau des membres actifs, puis l'avertit en temps réel de son intégration
exports.approveJoinRequest = async (req, res) => {
  try {
    // Collecte des identifiants uniques du salon de discussion et de l'utilisateur dont la demande est examinée
    const { id } = req.params;
    const { userId } = req.body;

    // Contrôle asynchrone des privilèges d'administration requis pour valider une entrée dans le groupe
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Bloc de sécurité : vérification stricte de l'existence préalable d'une candidature pour cet utilisateur
    if (!group.joinRequests.some((u) => u.toString() === userId)) {
      return res
        .status(400)
        .json({ message: "Aucune demande de cet utilisateur." });
    }

    // Retrait du profil de la liste d'attente et transfert simultané vers le tableau des membres actifs
    group.joinRequests = group.joinRequests.filter(
      (u) => u.toString() !== userId,
    );
    group.members.push(userId);
    
    // Sauvegarde des modifications structurelles et rafraîchissement des jointures d'utilisateurs
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    // Notification globale par socket pour actualiser l'interface des membres déjà connectés
    broadcastGroupUpdate(group);

    // Localisation de la session WebSocket de l'utilisateur accepté pour lui pousser le nouveau salon instantanément
    const approvedSocketId = getReceiverSocketId(userId);
    if (approvedSocketId) {
      io.to(approvedSocketId).emit("joinRequestApproved", { group });
    }

    // Transmission du document de groupe enrichi en guise de confirmation positive
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Fonction de rejet de candidature : supprime l'utilisateur de la liste d'attente d'adhésion,
// enregistre le retrait en base de données, puis émet un signal de refus au postulant écarté
exports.rejectJoinRequest = async (req, res) => {
  try {
    // Extraction des paramètres d'identification du salon de chat et du candidat écarté
    const { id } = req.params;
    const { userId } = req.body;

    // Validation asynchrone des droits de propriété intellectuelle du créateur du salon
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    // Filtrage correctif visant à effacer définitivement l'identifiant de la liste d'attente
    group.joinRequests = group.joinRequests.filter(
      (u) => u.toString() !== userId,
    );
    
    // Persistance des données révisées et reconstruction des liaisons d'affichage nominales
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    // Propa-gation immédiate des listes de modération nettoyées aux administrateurs connectés
    broadcastGroupUpdate(group);

    // Notification individualisée par WebSocket pour signaler le refus de la demande au client postulant
    const rejectedSocketId = getReceiverSocketId(userId);
    if (rejectedSocketId) {
      io.to(rejectedSocketId).emit("joinRequestRejected", {
        groupId: group._id,
        groupName: group.name,
      });
    }

    // Restitution de l'état final du groupe épuré au client d'administration émetteur
    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
