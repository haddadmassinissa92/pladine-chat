// multer.middleware.js

// Importation de la bibliothèque multer pour gérer les fichiers téléchargés
const multer = require('multer');

// Configuration du stockage en mémoire pour multer
const storage = multer.memoryStorage();

// Configuration de multer avec les options de stockage et de taille maximale de fichier
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 Mo max
});

// Exportation du middleware multer pour être utilisé dans d'autres parties de l'application
module.exports = upload;