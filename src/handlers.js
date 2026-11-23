'use strict';
/* Conecta los eventos de Socket.IO con el RoomManager.
   Cada handler va dentro de try/catch: un dato raro de un cliente nunca debe tumbar el servidor. */
const RoomManager = require('./rooms');
const CFG = require('./config');

function registerHandlers(io, socket, manager, log) {
  log = log || function () {};

  /* Normaliza (payload, ack): el cliente puede enviar solo el callback o nada. */
  function on(event, fn) {
    socket.on(event, function (a, b) {
      let payload = a, cb = b;
      if (typeof a === 'function') { cb = a; payload = undefined; }
      const ack = typeof cb === 'function' ? cb : function () {};
      try { fn(payload, ack); }
      catch (e) { log('error', 'handler ' + event + ': ' + (e && e.stack || e)); try { ack({ ok: false, error: 'SERVER_ERROR', message: 'Error interno del servidor.' }); } catch (_) { /* nada */ } }
    });
  }

  function rateOk(key) { return manager.checkRate(socket.id, key, CFG.ROOM_REQ_LIMIT, CFG.ROOM_REQ_WINDOW_MS); }
  function asObj(p) { return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; }

  on('room:create', function (payload, ack) {
    if (!rateOk('room')) return ack({ ok: false, error: 'RATE_LIMIT', message: RoomManager.ERR.RATE_LIMIT });
    const r = manager.createRoom(socket.id, asObj(payload).name);
    if (!r.ok) return ack(r);
    socket.join(r.room.code);
    log('info', 'sala ' + r.room.code + ' creada por ' + socket.id);
    ack({ ok: true, you: r.player, room: r.room });
    io.to(r.room.code).emit('room:state', r.room);
  });

  on('room:join', function (payload, ack) {
    if (!rateOk('room')) return ack({ ok: false, error: 'RATE_LIMIT', message: RoomManager.ERR.RATE_LIMIT });
    const p = asObj(payload);
    const r = manager.joinRoom(socket.id, p.code, p.name);
    if (!r.ok) return ack(r);
    socket.join(r.room.code);
    log('info', socket.id + ' se unio a ' + r.room.code + ' (' + r.room.count + '/' + r.room.max + ')');
    ack({ ok: true, you: r.player, room: r.room, world: r.world || null });
    socket.to(r.room.code).emit('player:joined', { player: r.player, room: r.room });
    io.to(r.room.code).emit('room:state', r.room);
    r.othersState.forEach(function (st) { socket.emit('player:state', st); });
    if (r.world) log('info', socket.id + ' reconecto a partida en curso ' + r.room.code);   // posicion actual de quien ya estaba
  });

  on('room:check', function (payload, ack) {
    if (!rateOk('room')) return ack({ ok: false, error: 'RATE_LIMIT', message: RoomManager.ERR.RATE_LIMIT });
    ack(manager.checkRoom(asObj(payload).code));
  });

  function leaveRoom(reason) {
    const r = manager.leave(socket.id);
    if (!r.ok) return r;
    socket.leave(r.code);
    announceLeft(r, reason);
    return r;
  }

  function announceLeft(r, reason) {
    if (r.deleted) { log('info', 'sala ' + r.code + ' eliminada (vacia)'); return; }
    io.to(r.code).emit('player:left', { player: r.player, reason: reason, room: r.room });
    io.to(r.code).emit('room:state', r.room);
  }

  on('room:start', function (payload, ack) {
    const r = manager.startGame(socket.id);
    if (!r.ok) return ack(r);
    log('info', 'partida iniciada en sala ' + r.code);
    ack({ ok: true });
    io.to(r.code).emit('game:start', { code: r.code, seed: r.seed, startAt: r.startAt, countdownMs: r.countdownMs, serverTime: r.serverTime, room: r.room, world: manager.roomOf(socket.id).world.snapshot(r.serverTime) });
    io.to(r.code).emit('room:state', r.room);
  });

  /* ---- mundo compartido: el cliente pide, el servidor valida; solo lo valido se aplica y se retransmite ---- */
  on('world:hit', function (payload, ack) {
    const r = manager.worldHit(socket.id, asObj(payload));
    if (!r.ok) { if (!r.silent) ack(r); else ack({ ok: false, error: 'RATE_LIMIT' }); return; }
    ack({ ok: true, id: r.id, kind: r.kind, uses: r.uses, max: r.max, gone: r.gone, rev: r.rev });
    socket.to(r.code).emit('world:op', { t: 'node', id: r.id, kind: r.kind, uses: r.uses, gone: r.gone, rev: r.rev, by: socket.id });
  });

  on('world:sync', function (payload, ack) {
    const r = manager.worldSnapshot(socket.id);
    ack(r);
  });

  on('room:leave', function (payload, ack) {
    const r = leaveRoom('left');
    ack(r.ok ? { ok: true } : r);
  });

  /* Posicion: no se confirma (alto trafico). Se valida y se reenvia solo al otro jugador. */
  on('player:update', function (payload) {
    const r = manager.updatePosition(socket.id, payload);
    if (!r.ok) return;
    socket.to(r.code).volatile.emit('player:state', r.state);
  });

  on('ping:check', function (payload, ack) { ack({ ok: true, serverTime: Date.now() }); });

  socket.on('disconnect', function (reason) {
    try {
      const r = manager.disconnect(socket.id);
      if (r.inRoom && r.ok) announceLeft(r, 'disconnect');
      log('info', 'desconectado ' + socket.id + ' (' + reason + ')');
    } catch (e) { log('error', 'disconnect: ' + (e && e.stack || e)); }
  });
}

module.exports = registerHandlers;
