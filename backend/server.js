// server.js

require('dotenv').config();

// Importe l'app Express déjà entièrement configurée (routes, middlewares,
// connexion MongoDB) depuis app.js
require('./app');

// Importe le serveur HTTP (qui enveloppe la même app Express, avec socket.io
// déjà attaché dessus depuis socket.js)
const { server } = require('./socket');

// port du serveur
const PORT = process.env.PORT || 5001;

// Démarrer le serveur
server.listen(PORT, () => {
  console.log(`🚀 Serveur en écoute sur http://localhost:${PORT}`);
});
