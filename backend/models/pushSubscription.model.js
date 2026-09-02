const mongoose = require('mongoose');

// Une souscription push par appareil/navigateur : un même utilisateur peut
// en avoir plusieurs (téléphone + ordinateur, par exemple)
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
