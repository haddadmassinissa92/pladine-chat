// doNotDisturb.util.js
//
// Détermine si un utilisateur est actuellement dans sa plage "ne pas
// déranger", pour décider s'il faut lui envoyer (ou non) une notification
// push. Utilisé avant chaque envoi de notification, à la fois pour les
// messages normaux (message.controller.js) et les messages programmés
// (scheduledMessages.service.js).

function isUserInDoNotDisturb(user) {
  const dnd = user?.doNotDisturb;
  if (!dnd || !dnd.enabled) return false;

  // Reconstitue l'heure locale de l'utilisateur à partir de l'heure UTC du
  // serveur et du décalage de fuseau capté au moment de l'activation
  const nowUtc = new Date();
  const localMinutes =
    nowUtc.getUTCHours() * 60 +
    nowUtc.getUTCMinutes() -
    (dnd.timezoneOffsetMinutes || 0);
  const currentMinutes = ((localMinutes % 1440) + 1440) % 1440;

  const [startH, startM] = (dnd.start || "22:00").split(":").map(Number);
  const [endH, endM] = (dnd.end || "07:00").split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes === endMinutes) return false; // plage nulle = désactivée en pratique

  if (startMinutes < endMinutes) {
    // Plage classique dans la même journée (ex: 13h00 à 14h00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  // Plage qui traverse minuit (ex: 22h00 à 07h00)
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

module.exports = { isUserInDoNotDisturb };
