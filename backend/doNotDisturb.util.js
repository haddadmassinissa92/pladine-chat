// doNotDisturb.util.js
//
// Détermine si un utilisateur a actuellement le mode "ne pas déranger"
// actif, pour décider s'il faut lui envoyer (ou non) une notification push.
// Se désactive tout seul dès que la date "until" est dépassée — pas besoin
// de tâche de fond pour le réinitialiser, la comparaison suffit à chaque
// fois. Utilisé avant chaque envoi de notification, à la fois pour les
// messages normaux (message.controller.js) et les messages programmés
// (scheduledMessages.service.js).

function isUserInDoNotDisturb(user) {
  const until = user?.doNotDisturb?.until;
  if (!until) return false;
  return new Date(until) > new Date();
}

module.exports = { isUserInDoNotDisturb };
