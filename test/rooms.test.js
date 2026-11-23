'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RoomManager = require('../src/rooms');

test('crea sala con codigo valido y jugador 1', () => {
  const m = new RoomManager();
  const r = m.createRoom('a', 'Ana');
  assert.equal(r.ok, true);
  assert.match(r.room.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(r.player.slot, 1);
  assert.equal(r.player.name, 'Ana');
  assert.equal(r.room.count, 1);
  assert.equal(r.room.full, false);
});

test('los codigos no se repiten (1000 salas)', () => {
  const m = new RoomManager({ maxRooms: 5000 });
  const seen = new Set();
  for (let i = 0; i < 1000; i++) { const r = m.createRoom('s' + i); assert.equal(r.ok, true); assert.ok(!seen.has(r.room.code)); seen.add(r.room.code); }
});

test('si el generador choca con un codigo existente, reintenta', () => {
  let n = 0; const seq = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];   // AAAAA y luego BBBBB
  const m = new RoomManager({ randomInt: () => seq[n++ % seq.length] });
  const a = m.createRoom('a'), b = m.createRoom('b');
  assert.equal(a.room.code, 'AAAAA'); assert.equal(b.room.code, 'BBBBB');
});

test('segundo jugador se une con el codigo (minusculas y espacios ok)', () => {
  const m = new RoomManager();
  const c = m.createRoom('a', 'Ana').room.code;
  const r = m.joinRoom('b', '  ' + c.toLowerCase() + ' ', 'Beto');
  assert.equal(r.ok, true);
  assert.equal(r.player.slot, 2);
  assert.equal(r.room.count, 2);
  assert.equal(r.room.full, true);
});

test('sala llena rechaza al tercero', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code;
  m.joinRoom('b', c);
  const r = m.joinRoom('c', c);
  assert.equal(r.ok, false); assert.equal(r.error, 'ROOM_FULL');
  assert.equal(m.checkRoom(c).full, true);
});

test('sala inexistente y codigos invalidos', () => {
  const m = new RoomManager();
  assert.equal(m.joinRoom('a', 'ZZZZZ').error, 'ROOM_NOT_FOUND');
  for (const bad of [undefined, null, 5, {}, [], '', 'abc', 'ABCDEF', 'AB0DE', 'AB1DE', 'ABODE', 'AB DE', "A'B;C"]) assert.equal(m.joinRoom('a', bad).error, 'INVALID_CODE', String(bad));
  assert.equal(m.checkRoom('zzzzz').exists, false);
  assert.equal(m.checkRoom('x').error, 'INVALID_CODE');
});

test('un jugador no puede estar en dos salas ni duplicarse', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code;
  assert.equal(m.createRoom('a').error, 'ALREADY_IN_ROOM');
  assert.equal(m.joinRoom('a', c).error, 'ALREADY_IN_ROOM');
  assert.equal(m.stats().players, 1);
});

test('salir elimina la sala vacia y libera el puesto si queda alguien', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code;
  m.joinRoom('b', c);
  const l = m.leave('a');
  assert.equal(l.ok, true); assert.equal(l.deleted, false); assert.equal(l.room.count, 1);
  const j = m.joinRoom('c', c);                      // reutiliza el puesto 1
  assert.equal(j.player.slot, 1);
  m.leave('b'); const last = m.leave('c');
  assert.equal(last.deleted, true);
  assert.equal(m.stats().rooms, 0);
  assert.equal(m.checkRoom(c).exists, false);
  assert.equal(m.leave('a').error, 'NOT_IN_ROOM');
});

test('desconexion: limpia jugador, sala y limitador; es idempotente', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code; m.joinRoom('b', c);
  m.checkRate('a', 'room', 5, 1000);
  const d = m.disconnect('a');
  assert.equal(d.inRoom, true); assert.equal(d.room.count, 1);
  assert.equal(m.rates.has('a'), false);
  assert.equal(m.disconnect('a').inRoom, false);
  assert.equal(m.disconnect('zzz').inRoom, false);
  m.disconnect('b'); assert.equal(m.stats().rooms, 0);
});

test('nombres: se limpian y se limitan', () => {
  assert.equal(RoomManager.sanitizeName('  <b>Ana</b>  ', 'x'), 'bAna/b');
  assert.equal(RoomManager.sanitizeName('A\u0000B\nC', 'x'), 'ABC');
  assert.equal(RoomManager.sanitizeName('x'.repeat(100), 'f').length, 16);
  assert.equal(RoomManager.sanitizeName('', 'Jugador 2'), 'Jugador 2');
  assert.equal(RoomManager.sanitizeName(123, 'Jugador 1'), 'Jugador 1');
  assert.equal(RoomManager.sanitizeName('<>', 'Jugador 1'), 'Jugador 1');
});

test('limite de salas del servidor', () => {
  const m = new RoomManager({ maxRooms: 2 });
  m.createRoom('a'); m.createRoom('b');
  assert.equal(m.createRoom('c').error, 'SERVER_FULL');
});

test('posicion: valida tipos, limites, direccion y velocidad', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code; m.joinRoom('b', c);
  let t = 1000;
  const ok = m.updatePosition('a', { x: 10.123, y: -5, dir: 'left', moving: true }, t);
  assert.equal(ok.ok, true); assert.equal(ok.state.x, 10.1); assert.equal(ok.state.dir, 'left'); assert.equal(ok.state.slot, 1);
  t += 50;
  for (const bad of [null, 5, 'x', { x: 'a', y: 1 }, { x: NaN, y: 1 }, { x: Infinity, y: 0 }, { x: 1e9, y: 0 }, { y: 1 }, { x: {}, y: 1 }])
    assert.equal(m.updatePosition('a', bad, t).error, 'BAD_DATA', JSON.stringify(bad));
  const weird = m.updatePosition('a', { x: 1, y: 2, dir: 'diagonal', moving: 'yes' }, t);
  assert.equal(weird.state.dir, 'left');          // direccion invalida: conserva la anterior
  assert.equal(weird.state.moving, false);
  const fast = m.updatePosition('a', { x: 3, y: 3 }, t + 5);
  assert.equal(fast.ok, false); assert.equal(fast.silent, true);   // supera 30/s
  assert.equal(m.updatePosition('zzz', { x: 1, y: 1 }, t).error, 'NOT_IN_ROOM');
});

test('al unirse, el nuevo jugador recibe la posicion del que ya estaba', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code;
  m.updatePosition('a', { x: 7, y: 8, dir: 'up', moving: false }, 1000);
  const j = m.joinRoom('b', c);
  assert.equal(j.othersState.length, 1);
  assert.equal(j.othersState[0].x, 7); assert.equal(j.othersState[0].slot, 1);
});

test('limitador de peticiones', () => {
  const m = new RoomManager();
  for (let i = 0; i < 3; i++) assert.equal(m.checkRate('a', 'room', 3, 1000, 100 + i), true);
  assert.equal(m.checkRate('a', 'room', 3, 1000, 200), false);
  assert.equal(m.checkRate('a', 'room', 3, 1000, 1500), true);   // la ventana ya paso
  assert.equal(m.checkRate('b', 'room', 3, 1000, 200), true);    // otro socket no se ve afectado
});

test('anfitrion: el creador es host y puede iniciar solo con la sala completa', () => {
  const m = new RoomManager();
  const c = m.createRoom('a', 'Ana');
  assert.equal(c.room.host, 'a'); assert.equal(c.room.players[0].host, true);
  assert.equal(m.startGame('a').error, 'NOT_ENOUGH_PLAYERS');
  m.joinRoom('b', c.room.code);
  assert.equal(m.startGame('b').error, 'NOT_HOST');
  assert.equal(m.startGame('zzz').error, 'NOT_IN_ROOM');
  const s = m.startGame('a', 5000);
  assert.equal(s.ok, true); assert.equal(s.startAt, 5000 + 3500); assert.ok(s.seed > 0); assert.equal(s.room.started, true);
  assert.equal(m.startGame('a').error, 'ALREADY_STARTED');
});

test('sala iniciada llena: nadie mas puede unirse y si se va el host pasa al otro', () => {
  const m = new RoomManager();
  const c = m.createRoom('a').room.code; m.joinRoom('b', c); m.startGame('a');
  assert.equal(m.joinRoom('c', c).error, 'ROOM_FULL');
  assert.equal(m.checkRoom(c).started, true);
  const l = m.leave('a');
  assert.equal(l.room.host, 'b'); assert.equal(l.room.players[0].host, true);
});
