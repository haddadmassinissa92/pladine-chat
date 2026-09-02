// push.service.js

const webpush = require('web-push');
const PushSubscription = require('./models/pushSubscription.model');
const logger = require('./logger');

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:contact@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

// Envoie une notification push à tous les appareils enregistrés d'un
// utilisateur. Si un appareil a désinstallé l'app ou révoqué la permission,
// le service worker renvoie une erreur 404/410 : on supprime alors
// automatiquement cette souscription devenue inutile.
async function sendPushToUser(userId, payload) {
  try {
    const subscriptions = await PushSubscription.find({ user: userId });

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify(payload),
          );
        } catch (error) {
          if (error.statusCode === 404 || error.statusCode === 410) {
            await PushSubscription.deleteOne({ _id: sub._id });
          } else {
            logger.error({ err: error }, "Erreur lors de l'envoi d'une notification push");
          }
        }
      }),
    );
  } catch (error) {
    logger.error({ err: error }, 'Erreur lors de la récupération des souscriptions push');
  }
}

module.exports = { sendPushToUser };
