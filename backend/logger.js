// logger.js

const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

// En développement : logs colorés et lisibles dans le terminal (via pino-pretty).
// En production : logs bruts au format JSON (une ligne par entrée), plus
// facilement exploitables par un service de collecte de logs externe si besoin.
const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      },
});

module.exports = logger;
