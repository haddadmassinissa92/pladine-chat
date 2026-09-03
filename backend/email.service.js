// email.service.js
//
// Service d'envoi d'emails transactionnels via Resend : email de
// vérification à l'inscription, et email de réinitialisation de mot de
// passe. Suit le même principe que push.service.js : une fonction dédiée
// par type de notification, appelée depuis les contrôleurs.

const { Resend } = require("resend");
const logger = require("./logger");

const resend = new Resend(process.env.RESEND_API_KEY);

// Adresse d'expédition : tant qu'aucun domaine personnalisé n'est vérifié
// sur Resend, "onboarding@resend.dev" est l'adresse de test fournie par
// défaut par Resend (n'exige pas de configuration DNS, mais Resend peut
// limiter son usage à grande échelle — largement suffisant pour un projet
// perso). Remplaçable par une adresse sur un nom de domaine à toi, une fois
// ce domaine vérifié dans le tableau de bord Resend.
const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || "PladiChat <onboarding@resend.dev>";

// URL du frontend, réutilisée pour construire les liens cliqués depuis
// l'email (même variable que celle déjà utilisée pour la configuration CORS)
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

async function sendVerificationEmail(user, token) {
  const verifyUrl = `${CLIENT_URL}/verify-email/${token}`;

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: user.email,
      subject: "Confirme ton adresse email sur PladiChat",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Bienvenue sur PladiChat, ${user.username} !</h2>
          <p>Confirme ton adresse email pour activer ton compte :</p>
          <p>
            <a href="${verifyUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;display:inline-block;">
              Confirmer mon email
            </a>
          </p>
          <p style="color:#71717a;font-size:13px;">
            Ce lien expire dans 24 heures. Si tu n'es pas à l'origine de cette
            inscription, ignore simplement cet email.
          </p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'envoi de l'email de vérification");
  }
}

async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${CLIENT_URL}/reset-password/${token}`;

  try {
    await resend.emails.send({
      from: FROM_ADDRESS,
      to: user.email,
      subject: "Réinitialisation de ton mot de passe PladiChat",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>Réinitialisation du mot de passe</h2>
          <p>Une demande de réinitialisation a été faite pour ce compte. Clique ci-dessous pour choisir un nouveau mot de passe :</p>
          <p>
            <a href="${resetUrl}" style="background:#4f46e5;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;display:inline-block;">
              Réinitialiser mon mot de passe
            </a>
          </p>
          <p style="color:#71717a;font-size:13px;">
            Ce lien expire dans 1 heure. Si tu n'es pas à l'origine de cette
            demande, ignore simplement cet email — ton mot de passe actuel
            reste inchangé.
          </p>
        </div>
      `,
    });
  } catch (error) {
    logger.error({ err: error }, "Erreur lors de l'envoi de l'email de réinitialisation");
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
