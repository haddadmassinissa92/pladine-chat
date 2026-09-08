// scheduledMessages.service.js
//
// Tâche de fond qui vérifie périodiquement s'il y a des messages
// programmés arrivés à échéance, et les transforme alors en vrais messages
// (créés dans "Message", diffusés en temps réel via Socket.io, avec
// notification push comme un envoi normal), avant de les retirer de la
// file d'attente.

const Message = require("./models/message.model");
const User = require("./models/user.model");
const Group = require("./models/group.model");
const ScheduledMessage = require("./models/scheduledMessage.model");
const { isUserInDoNotDisturb } = require("./doNotDisturb.util");
const logger = require("./logger");

const CHECK_INTERVAL_MS = 20 * 1000; // vérifie toutes les 20 secondes

async function deliverScheduledMessage(scheduled, { getReceiverSocketId, io, sendPushToUser }) {
  // Conversation privée : si l'un des deux a bloqué l'autre entre-temps
  // (depuis la programmation), le message est silencieusement abandonné
  // plutôt qu'envoyé quand même
  if (scheduled.group) {
    const group = await Group.findById(scheduled.group);
    if (!group) return; // le groupe a été supprimé depuis
    const isMember = group.members.some(
      (m) => m.toString() === scheduled.sender.toString(),
    );
    if (!isMember) return; // plus membre du groupe depuis la programmation

    const newMessage = await Message.create({
      sender: scheduled.sender,
      group: scheduled.group,
      text: scheduled.text,
    });
    await newMessage.populate("sender", "username");

    const senderUsername = newMessage.sender.username;
    const memberDocs = await User.find({ _id: { $in: group.members } }).select(
      "mutedConversations doNotDisturb",
    );
    const mutedByMemberId = new Map(
      memberDocs.map((u) => [u._id.toString(), u.mutedConversations || []]),
    );
    const memberDocById = new Map(memberDocs.map((u) => [u._id.toString(), u]));

    group.members.forEach((memberId) => {
      if (memberId.toString() === scheduled.sender.toString()) return;
      const memberIdStr = memberId.toString();
      const memberSocketId = getReceiverSocketId(memberIdStr);
      if (memberSocketId) {
        io.to(memberSocketId).emit("newMessage", newMessage);
      }
      const isMutedByMember = (mutedByMemberId.get(memberIdStr) || []).includes(
        group._id.toString(),
      );
      const isInDoNotDisturb = isUserInDoNotDisturb(memberDocById.get(memberIdStr));
      if (!isMutedByMember && !isInDoNotDisturb) {
        sendPushToUser(memberId, {
          title: group.name,
          body: `${senderUsername} : ${scheduled.text}`,
          icon: "/icon-192.png",
        });
      }
    });
  } else {
    const [sender, receiver] = await Promise.all([
      User.findById(scheduled.sender).select("blockedUsers username"),
      User.findById(scheduled.receiver).select("blockedUsers mutedConversations doNotDisturb"),
    ]);
    if (!sender || !receiver) return; // compte supprimé depuis

    const senderBlockedReceiver = sender.blockedUsers.some(
      (u) => u.toString() === scheduled.receiver.toString(),
    );
    const receiverBlockedSender = receiver.blockedUsers.some(
      (u) => u.toString() === scheduled.sender.toString(),
    );
    if (senderBlockedReceiver || receiverBlockedSender) return;

    const newMessage = await Message.create({
      sender: scheduled.sender,
      receiver: scheduled.receiver,
      text: scheduled.text,
    });

    const receiverSocketId = getReceiverSocketId(scheduled.receiver.toString());
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    const isMutedByReceiver = (receiver.mutedConversations || []).includes(
      scheduled.sender.toString(),
    );
    if (!isMutedByReceiver && !isUserInDoNotDisturb(receiver)) {
      sendPushToUser(scheduled.receiver, {
        title: sender.username,
        body: scheduled.text,
        icon: "/icon-192.png",
      });
    }
  }
}

function startScheduledMessageDispatcher({ getReceiverSocketId, io, sendPushToUser }) {
  setInterval(async () => {
    try {
      const due = await ScheduledMessage.find({ scheduledFor: { $lte: new Date() } });
      for (const scheduled of due) {
        try {
          await deliverScheduledMessage(scheduled, { getReceiverSocketId, io, sendPushToUser });
        } catch (error) {
          logger.error({ err: error }, "Erreur lors de la diffusion d'un message programmé");
        } finally {
          // Retiré de la file d'attente même en cas d'échec, pour éviter
          // de retenter indéfiniment un message problématique
          await scheduled.deleteOne();
        }
      }
    } catch (error) {
      logger.error({ err: error }, "Erreur lors de la vérification des messages programmés");
    }
  }, CHECK_INTERVAL_MS);
}

module.exports = { startScheduledMessageDispatcher };
