'use strict';
/* Configuracion central. Todo lo ajustable vive aqui para que las futuras fases solo tengan que tocar este archivo. */

function intEnv(name, def, min, max) {
  const v = parseInt(process.env[name], 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

module.exports = {
  PORT: intEnv('PORT', 3000, 1, 65535),
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  MAX_ROOMS: intEnv('MAX_ROOMS', 500, 1, 100000),
  MAX_CONNECTIONS: intEnv('MAX_CONNECTIONS', 1000, 1, 100000),

  /* Salas */
  MAX_PLAYERS_PER_ROOM: 2,          // Fase 1: 2 jugadores. Para mas, solo cambia este numero.
  CODE_LENGTH: 5,
  CODE_ALPHABET: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', // sin 0/O/1/I para evitar confusiones al dictarlo
  NAME_MAX_LENGTH: 16,

  /* Inicio de partida: cuenta atras comun (ms) entre el aviso del servidor y el comienzo real */
  START_COUNTDOWN_MS: 3500,

  /* Mundo compartido (Etapa 1) */
  DAY_LEN_MS: 300000,               // un dia completo del juego = 300 s (igual que DAY_LEN en game.js)
  CLOCK_START_ABS: 8 / 24,          // la partida empieza a las 08:00 del dia 1
  MAX_OBJECT_ID: 200000,
  HIT_MIN_INTERVAL_MS: 150,         // minimo entre golpes de un mismo jugador (el juego repite cada 420 ms)
  RECONNECT_GRACE_MS: 600000,       // una partida iniciada sin jugadores se conserva 10 min para poder reconectar
  NODE_MAX_USES: { tree: 4, deadtree: 2, bush: 2, rock: 3, log: 1, box: 1 },   // mismos maximos que el juego

  /* Posicion */
  POSITION_MAX_RATE: 30,            // actualizaciones de posicion por segundo y por jugador (el resto se descarta)
  WORLD_LIMIT: 100000,              // |x|,|y| maximos aceptados (el mundo real del juego es mucho menor)
  DIRECTIONS: ['up', 'down', 'left', 'right'],

  /* Limite de peticiones de sala (crear/unirse/consultar) por socket */
  ROOM_REQ_LIMIT: 12,
  ROOM_REQ_WINDOW_MS: 10000,

  /* Socket.IO */
  PING_INTERVAL_MS: 10000,
  PING_TIMEOUT_MS: 15000,
  MAX_PAYLOAD_BYTES: 10000          // 10 KB por mensaje: sobra para esta fase y frena abusos
};
