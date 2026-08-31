// middlewares/multer.middleware.js

// Importation du module de gestion des téléchargements 
// de fichiers binaires transmis par formulaire HTTP
const multer = require('multer');

// Configuration du stockage temporaire des fichiers directement 
// dans la mémoire vive (RAM) sous forme de buffers
const storage = multer.memoryStorage();

// Initialisation de l'instance de traitement 
// avec attribution de la zone de stockage et définition d'un plafond de taille strict
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 Mo max
});

// Publication et exportation du middleware configuré 
// pour intercepter les fichiers sur les routes de l'API
module.exports = upload;
