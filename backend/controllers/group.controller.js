const Group = require("../models/group.model");
const { getReceiverSocketId, io } = require("../socket");

// Créer un nouveau groupe
exports.createGroup = async (req, res) => {
  try {
    const { name, members } = req.body;
    const createdBy = req.user._id;

    const allMembers = [...new Set([...members, createdBy.toString()])];

    const group = await Group.create({
      name,
      members: allMembers,
      createdBy,
    });

    res.status(201).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Récupérer les groupes de l'utilisateur connecté
exports.getMyGroups = async (req, res) => {
  try {
    const Message = require("../models/message.model");

    const groups = await Group.find({ members: req.user._id })
      .populate("members", "username")
      .populate("joinRequests", "username");

    const groupsWithLastMessage = await Promise.all(
      groups.map(async (group) => {
        const lastMessage = await Message.findOne({ group: group._id })
          .sort({ createdAt: -1 })
          .select("text image audio createdAt sender")
          .populate("sender", "username");

        const unreadCount = await Message.countDocuments({
          group: group._id,
          sender: { $ne: req.user._id },
          status: { $ne: "read" },
        });

        return {
          ...group.toObject(),
          lastMessage: lastMessage || null,
          unreadCount,
        };
      }),
    );

    res.status(200).json(groupsWithLastMessage);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

exports.deleteGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await Group.findById(id);

    if (!group) {
      return res.status(404).json({ message: "Groupe introuvable." });
    }
    if (group.createdBy.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Seul le créateur peut supprimer le groupe." });
    }

    await group.deleteOne();
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

// Renomme un groupe existant (réservé au créateur)
exports.renameGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Le nom du groupe est requis." });
    }

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    group.name = name.trim();
    await group.save();
    await group.populate("members", "username");

    broadcastGroupUpdate(group);

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Ajoute un ou plusieurs membres à un groupe existant (réservé au créateur)
exports.addMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { members } = req.body; // tableau d'ids d'utilisateurs à ajouter

    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ message: "Aucun membre à ajouter." });
    }

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    const currentMemberIds = group.members.map((m) => m.toString());
    const newMemberIds = members.filter((m) => !currentMemberIds.includes(m));

    group.members = [...group.members, ...newMemberIds];
    await group.save();
    await group.populate("members", "username");

    broadcastGroupUpdate(group);

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Retire définitivement un membre du groupe (réservé au créateur)
exports.removeMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({ message: "Membre à retirer manquant." });
    }

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    if (memberId === group.createdBy.toString()) {
      return res
        .status(400)
        .json({ message: "Le créateur ne peut pas se retirer lui-même." });
    }

    group.members = group.members.filter((m) => m.toString() !== memberId);
    // On nettoie aussi la liste des membres bloqués, s'il en faisait partie
    group.blockedMembers = group.blockedMembers.filter(
      (m) => m.toString() !== memberId,
    );

    await group.save();
    await group.populate("members", "username");

    broadcastGroupUpdate(group);

    // On informe aussi la personne retirée, pour qu'elle voie disparaître le groupe
    const removedSocketId = getReceiverSocketId(memberId);
    if (removedSocketId) {
      io.to(removedSocketId).emit("removedFromGroup", { groupId: id });
    }

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Bloque ou débloque un membre à l'intérieur du groupe (bascule automatique) :
// un membre bloqué reste visible dans le groupe mais ne peut plus y envoyer
// de messages. Réservé au créateur.
exports.toggleBlockMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberId } = req.body;

    if (!memberId) {
      return res.status(400).json({ message: "Membre concerné manquant." });
    }

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    if (memberId === group.createdBy.toString()) {
      return res
        .status(400)
        .json({ message: "Le créateur ne peut pas se bloquer lui-même." });
    }

    const isBlocked = group.blockedMembers.some(
      (m) => m.toString() === memberId,
    );

    if (isBlocked) {
      group.blockedMembers = group.blockedMembers.filter(
        (m) => m.toString() !== memberId,
      );
    } else {
      group.blockedMembers.push(memberId);
    }

    await group.save();
    await group.populate("members", "username");

    broadcastGroupUpdate(group);

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Rend un groupe découvrable ou privé (bascule automatique, réservé au créateur).
// Un groupe découvrable peut être trouvé par d'autres utilisateurs, qui peuvent
// alors envoyer une demande d'adhésion pour le rejoindre.
exports.toggleDiscoverable = async (req, res) => {
  try {
    const { id } = req.params;
    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    group.isDiscoverable = !group.isDiscoverable;
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    broadcastGroupUpdate(group);

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Liste les groupes découvrables dont l'utilisateur connecté n'est pas déjà membre
exports.getDiscoverableGroups = async (req, res) => {
  try {
    const myId = req.user._id;

    const groups = await Group.find({
      isDiscoverable: true,
      members: { $ne: myId },
    }).select("name members joinRequests createdBy");

    // On indique pour chaque groupe si une demande est déjà en attente
    const groupsWithStatus = groups.map((group) => ({
      _id: group._id,
      name: group.name,
      memberCount: group.members.length,
      createdBy: group.createdBy,
      requestPending: group.joinRequests.some(
        (u) => u.toString() === myId.toString(),
      ),
    }));

    res.status(200).json(groupsWithStatus);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Envoie une demande d'adhésion à un groupe découvrable
exports.requestToJoin = async (req, res) => {
  try {
    const { id } = req.params;
    const myId = req.user._id;

    const group = await Group.findById(id);
    if (!group) {
      return res.status(404).json({ message: "Groupe introuvable." });
    }
    if (!group.isDiscoverable) {
      return res.status(403).json({ message: "Ce groupe n'est pas découvrable." });
    }
    if (group.members.some((m) => m.toString() === myId.toString())) {
      return res.status(400).json({ message: "Tu es déjà membre de ce groupe." });
    }
    if (group.joinRequests.some((u) => u.toString() === myId.toString())) {
      return res.status(400).json({ message: "Demande déjà envoyée." });
    }

    group.joinRequests.push(myId);
    await group.save();

    // On prévient le créateur du groupe en temps réel
    const creatorSocketId = getReceiverSocketId(group.createdBy.toString());
    if (creatorSocketId) {
      io.to(creatorSocketId).emit("joinRequestReceived", {
        groupId: group._id,
        groupName: group.name,
      });
    }

    res.status(200).json({ message: "Demande envoyée." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Accepte la demande d'adhésion d'un utilisateur (réservé au créateur)
exports.approveJoinRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    if (!group.joinRequests.some((u) => u.toString() === userId)) {
      return res.status(400).json({ message: "Aucune demande de cet utilisateur." });
    }

    group.joinRequests = group.joinRequests.filter(
      (u) => u.toString() !== userId,
    );
    group.members.push(userId);
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    broadcastGroupUpdate(group);

    // On révèle à tout le monde les messages que cette personne avait envoyés
    // pendant qu'elle n'était pas encore membre (son "message de candidature")
    const Message = require("../models/message.model");
    const revealedMessages = await Message.find({
      group: id,
      sender: userId,
      pendingApproval: true,
    }).populate("replyTo", "text");

    if (revealedMessages.length > 0) {
      await Message.updateMany(
        { group: id, sender: userId, pendingApproval: true },
        { pendingApproval: false },
      );

      group.members.forEach((member) => {
        const memberId = member._id ? member._id.toString() : member.toString();
        const memberSocketId = getReceiverSocketId(memberId);
        if (memberSocketId) {
          revealedMessages.forEach((msg) => {
            io.to(memberSocketId).emit("newMessage", {
              ...msg.toObject(),
              pendingApproval: false,
            });
          });
        }
      });
    }

    // On prévient la personne acceptée, pour qu'elle voie apparaître le groupe
    const approvedSocketId = getReceiverSocketId(userId);
    if (approvedSocketId) {
      io.to(approvedSocketId).emit("joinRequestApproved", { group });
    }

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

// Refuse la demande d'adhésion d'un utilisateur (réservé au créateur)
exports.rejectJoinRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;

    const group = await requireGroupCreator(req, res, id);
    if (!group) return;

    group.joinRequests = group.joinRequests.filter(
      (u) => u.toString() !== userId,
    );
    await group.save();
    await group.populate("members", "username");
    await group.populate("joinRequests", "username");

    broadcastGroupUpdate(group);

    // On supprime le(s) message(s) de candidature de cette personne, puisqu'elle
    // n'a pas été acceptée : ils ne seront jamais vus par les autres membres
    const Message = require("../models/message.model");
    const rejectedMessages = await Message.find({
      group: id,
      sender: userId,
      pendingApproval: true,
    }).select("_id");
    await Message.deleteMany({ group: id, sender: userId, pendingApproval: true });

    const rejectedSocketId = getReceiverSocketId(userId);
    if (rejectedSocketId) {
      io.to(rejectedSocketId).emit("joinRequestRejected", {
        groupId: group._id,
        groupName: group.name,
      });
      rejectedMessages.forEach((msg) => {
        io.to(rejectedSocketId).emit("messageDeleted", { messageId: msg._id });
      });
    }

    res.status(200).json(group);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
