// Configurer les serveurs DNS
const dns = require("dns");
dns.setServers(['8.8.8.8', '8.8.4.4']);

// Importer les modules nécessaires
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');

// Importer les routes et le serveur socket
const { app, server } = require('./socket');

// --- INITIALISATION DE CLOUDINARY ---
const cloudinary = require('cloudinary').v2;
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


// Importer les routes
const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');
const messageRoutes = require('./routes/message.route');
const groupRoutes = require('./routes/group.route');

// Configurer les middlewares
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true,
}));

// Configurer le parsing JSON et les cookies
app.use(express.json());
app.use(cookieParser());


// Connecter à MongoDB
mongoose.connect(process.env.MONGO_URI, { dbName: 'ChatApp' })
  .then(() => console.log('✅ Connecté à MongoDB'))
  .catch((err) => console.error('❌ Erreur de connexion', err));

// Définir les routes
app.get('/', (req, res) => {
  res.json({ message: 'Chat App API en ligne' });
});

// Utiliser les routes api
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);

// Gérer les erreurs 404
app.use((req, res) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

// Gérer les erreurs serveur
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Erreur serveur' });
});

// port du serveur
const PORT = process.env.PORT || 5001;

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`🚀 Serveur en écoute sur http://localhost:${PORT}`);
});