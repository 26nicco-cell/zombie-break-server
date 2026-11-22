'use strict';
/* ZOMBIE BREAK - Servidor multijugador (Fase 1)
   Express (HTTP + pagina de prueba) + Socket.IO (tiempo real). */
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const CFG = require('./src/config');
const RoomManager = require('./src/rooms');
const registerHandlers = require('./src/handlers');

function log(level, msg) {
  const line = new Date().toISOString() + ' [' + level + '] ' + msg;
  if (level === 'error') console.error(line); else console.log(line);
}

const manager = new RoomManager();
const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: CFG.ALLOWED_ORIGINS.indexOf('*') >= 0 ? '*' : CFG.ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: CFG.PING_INTERVAL_MS,
  pingTimeout: CFG.PING_TIMEOUT_MS,
  maxHttpBufferSize: CFG.MAX_PAYLOAD_BYTES,
  transports: ['websocket', 'polling']
});

/* Limite de conexiones simultaneas */
io.use(function (socket, next) {
  if (io.engine.clientsCount > CFG.MAX_CONNECTIONS) return next(new Error('SERVER_BUSY'));
  next();
});

io.on('connection', function (socket) {
  log('info', 'conectado ' + socket.id);
  socket.emit('hello', { id: socket.id, server: 'zombie-break', version: require('./package.json').version, maxPlayers: manager.maxPlayers });
  registerHandlers(io, socket, manager, log);
  socket.on('error', function (e) { log('error', 'socket ' + socket.id + ': ' + (e && e.message || e)); });
});

io.engine.on('connection_error', function (err) { log('warn', 'connection_error: ' + (err && err.code) + ' ' + (err && err.message)); });

/* HTTP */
app.get('/health', function (req, res) {
  const s = manager.stats();
  res.json({ ok: true, uptime: Math.round(process.uptime()), rooms: s.rooms, players: s.players, version: require('./package.json').version });
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.use(function (req, res) { res.status(404).json({ ok: false, error: 'NOT_FOUND' }); });
app.use(function (err, req, res, next) { log('error', 'http: ' + (err && err.stack || err)); res.status(500).json({ ok: false, error: 'SERVER_ERROR' }); });

/* Estabilidad: un error inesperado se registra pero no tumba el servidor */
process.on('uncaughtException', function (e) { log('error', 'uncaughtException: ' + (e && e.stack || e)); });
process.on('unhandledRejection', function (e) { log('error', 'unhandledRejection: ' + (e && e.stack || e)); });

server.listen(CFG.PORT, '0.0.0.0', function () { log('info', 'ZOMBIE BREAK server escuchando en el puerto ' + CFG.PORT); });

function shutdown(sig) {
  log('info', sig + ' recibido, cerrando...');
  io.close(function () { server.close(function () { process.exit(0); }); });
  setTimeout(function () { process.exit(0); }, 5000).unref();
}
process.on('SIGTERM', function () { shutdown('SIGTERM'); });
process.on('SIGINT', function () { shutdown('SIGINT'); });

module.exports = { app, server, io, manager };
