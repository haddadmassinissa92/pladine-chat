const Group = require("../models/group.model");

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
    const groups = await Group.find({ members: req.user._id }).populate(
      "members",
      "username",
    );
    res.status(200).json(groups);
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
