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

    const groups = await Group.find({ members: req.user._id }).populate(
      "members",
      "username",
    );

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
