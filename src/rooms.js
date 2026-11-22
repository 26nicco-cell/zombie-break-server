'use strict';
/* RoomManager: toda la logica de salas y jugadores, SIN depender de Socket.IO ni de Express.
   Asi se puede probar sin red y reutilizar en futuras fases (zombis, combate, etc.). */
const crypto = require('crypto');
const CFG = require('./config');

const ERR = {
  INVALID_CODE: 'El codigo de sala no es valido (son 5 letras/numeros).',
  ROOM_NOT_FOUND: 'No existe ninguna sala con ese codigo.',
  ROOM_FULL: 'La sala esta llena.',
  ALREADY_IN_ROOM: 'Ya estas en una sala. Sal de ella antes de crear o unirte a otra.',
  NOT_IN_ROOM: 'No estas en ninguna sala.',
  SERVER_FULL: 'El servidor no admite mas salas ahora mismo. Intenta mas tarde.',
  RATE_LIMIT: 'Demasiadas peticiones. Espera unos segundos.',
  BAD_DATA: 'Datos invalidos.',
  CODE_FAILED: 'No se pudo generar un codigo de sala. Intenta de nuevo.'
};

function fail(error) { return { ok: false, error, message: ERR[error] || error }; }

class RoomManager {
  constructor(opts) {
    opts = opts || {};
    this.maxPlayers = opts.maxPlayers || CFG.MAX_PLAYERS_PER_ROOM;
    this.maxRooms = opts.maxRooms || CFG.MAX_ROOMS;
    this.randomInt = opts.randomInt || ((n) => crypto.randomInt(n));
    this.rooms = new Map();        // code -> { code, createdAt, players: Map(id -> player) }
    this.playerRoom = new Map();   // socketId -> code
    this.rates = new Map();        // socketId -> { key -> [timestamps] }
  }

  /* ---------- utilidades ---------- */
  static normalizeCode(raw) {
    if (typeof raw !== 'string') return null;
    const c = raw.trim().toUpperCase();
    if (c.length !== CFG.CODE_LENGTH) return null;
    for (let i = 0; i < c.length; i++) if (CFG.CODE_ALPHABET.indexOf(c[i]) < 0) return null;
    return c;
  }

  static sanitizeName(raw, fallback) {
    if (typeof raw !== 'string') return fallback;
    // quita caracteres de control y marcas HTML/espacios raros; limita la longitud
    const s = raw.replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, CFG.NAME_MAX_LENGTH);
    return s || fallback;
  }

  generateCode() {
    for (let attempt = 0; attempt < 60; attempt++) {
      let code = '';
      for (let i = 0; i < CFG.CODE_LENGTH; i++) code += CFG.CODE_ALPHABET[this.randomInt(CFG.CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;   // evita salas duplicadas
    }
    return null;
  }

  /* limitador sencillo por socket y tipo de peticion */
  checkRate(id, key, limit, windowMs, now) {
    now = now == null ? Date.now() : now;
    let byKey = this.rates.get(id);
    if (!byKey) { byKey = {}; this.rates.set(id, byKey); }
    const arr = (byKey[key] || []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) { byKey[key] = arr; return false; }
    arr.push(now); byKey[key] = arr; return true;
  }

  snapshot(room) {
    const players = [];
    room.players.forEach((p) => players.push({ id: p.id, slot: p.slot, name: p.name }));
    players.sort((a, b) => a.slot - b.slot);
    return { code: room.code, count: room.players.size, max: this.maxPlayers, full: room.players.size >= this.maxPlayers, players };
  }

  publicPlayer(p) { return { id: p.id, slot: p.slot, name: p.name }; }

  /* ---------- salas ---------- */
  createRoom(id, rawName) {
    if (this.playerRoom.has(id)) return fail('ALREADY_IN_ROOM');
    if (this.rooms.size >= this.maxRooms) return fail('SERVER_FULL');
    const code = this.generateCode();
    if (!code) return fail('CODE_FAILED');
    const room = { code, createdAt: Date.now(), players: new Map() };
    this.rooms.set(code, room);
    const player = this._addPlayer(room, id, rawName);
    return { ok: true, room: this.snapshot(room), player: this.publicPlayer(player) };
  }

  joinRoom(id, rawCode, rawName) {
    const code = RoomManager.normalizeCode(rawCode);
    if (!code) return fail('INVALID_CODE');
    if (this.playerRoom.has(id)) return fail('ALREADY_IN_ROOM');
    const room = this.rooms.get(code);
    if (!room) return fail('ROOM_NOT_FOUND');
    if (room.players.size >= this.maxPlayers) return fail('ROOM_FULL');
    const player = this._addPlayer(room, id, rawName);
    const others = [];
    room.players.forEach((p) => { if (p.id !== id && p.pos) others.push(Object.assign({ id: p.id, slot: p.slot }, p.pos)); });
    return { ok: true, room: this.snapshot(room), player: this.publicPlayer(player), othersState: others };
  }

  /* Consulta sin unirse: sirve para mostrar "1/2 jugadores" y detectar sala llena */
  checkRoom(rawCode) {
    const code = RoomManager.normalizeCode(rawCode);
    if (!code) return fail('INVALID_CODE');
    const room = this.rooms.get(code);
    if (!room) return { ok: true, exists: false, code };
    const s = this.snapshot(room);
    return { ok: true, exists: true, code, count: s.count, max: s.max, full: s.full };
  }

  leave(id) {
    const code = this.playerRoom.get(id);
    if (!code) return fail('NOT_IN_ROOM');
    const room = this.rooms.get(code);
    this.playerRoom.delete(id);
    if (!room) return fail('NOT_IN_ROOM');
    const player = room.players.get(id);
    room.players.delete(id);
    let deleted = false, snap = null;
    if (room.players.size === 0) { this.rooms.delete(code); deleted = true; }   // las salas vacias se eliminan
    else snap = this.snapshot(room);
    return { ok: true, code, player: player ? this.publicPlayer(player) : null, room: snap, deleted };
  }

  /* Desconexion (cierre de pestana, perdida de red, etc.): igual que salir, y limpia el limitador */
  disconnect(id) {
    this.rates.delete(id);
    if (!this.playerRoom.has(id)) return { ok: true, inRoom: false };
    const r = this.leave(id);
    return Object.assign({ inRoom: true }, r);
  }

  _addPlayer(room, id, rawName) {
    let slot = 1;
    const used = new Set();
    room.players.forEach((p) => used.add(p.slot));
    while (used.has(slot)) slot++;
    const player = { id, slot, name: RoomManager.sanitizeName(rawName, 'Jugador ' + slot), pos: null, lastPosAt: 0 };
    room.players.set(id, player);
    this.playerRoom.set(id, room.code);
    return player;
  }

  /* ---------- posicion basica ---------- */
  updatePosition(id, data, now) {
    now = now == null ? Date.now() : now;
    const code = this.playerRoom.get(id);
    if (!code) return fail('NOT_IN_ROOM');
    const room = this.rooms.get(code);
    const player = room && room.players.get(id);
    if (!player) return fail('NOT_IN_ROOM');
    if (!data || typeof data !== 'object') return fail('BAD_DATA');
    const x = data.x, y = data.y;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return fail('BAD_DATA');
    if (Math.abs(x) > CFG.WORLD_LIMIT || Math.abs(y) > CFG.WORLD_LIMIT) return fail('BAD_DATA');
    if (now - player.lastPosAt < 1000 / CFG.POSITION_MAX_RATE) return { ok: false, error: 'RATE_LIMIT', silent: true };
    const dir = CFG.DIRECTIONS.indexOf(data.dir) >= 0 ? data.dir : (player.pos ? player.pos.dir : 'down');
    player.lastPosAt = now;
    player.pos = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, dir, moving: data.moving === true };
    return { ok: true, code, state: Object.assign({ id: player.id, slot: player.slot }, player.pos) };
  }

  stats() { return { rooms: this.rooms.size, players: this.playerRoom.size }; }
}

RoomManager.ERR = ERR;
module.exports = RoomManager;
