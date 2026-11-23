'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const RoomManager = require('../src/rooms');
const registerHandlers = require('../src/handlers');
const createMockIO = require('./mock-io');

function setup() {
  const io = createMockIO(), manager = new RoomManager(), errors = [];
  const connect = (id) => { const s = io.connect(id); registerHandlers(io, s, manager, (lvl, msg) => { if (lvl === 'error') errors.push(msg); }); return s; };
  const call = (s, ev, payload) => { let res; s.client(ev, payload, (r) => { res = r; }); return res; };
  return { io, manager, connect, call, errors };
}

test('flujo completo: crear, unirse, presencia, posicion, salida y limpieza', () => {
  const { manager, connect, call, errors } = setup();
  const p1 = connect('s1'), p2 = connect('s2'), p3 = connect('s3');

  const c = call(p1, 'room:create', { name: 'Ana' });
  assert.equal(c.ok, true); assert.equal(c.you.slot, 1);
  const code = c.room.code;
  assert.equal(p1.events('room:state').length, 1);

  assert.equal(call(p2, 'room:join', { code: 'ZZZZZ' }).error, 'ROOM_NOT_FOUND');
  assert.equal(call(p2, 'room:check', { code }).count, 1);

  // el jugador 1 se mueve antes de que entre el 2
  p1.client('player:update', { x: 50, y: 60, dir: 'right', moving: true });

  const j = call(p2, 'room:join', { code: code.toLowerCase(), name: 'Beto' });
  assert.equal(j.ok, true); assert.equal(j.you.slot, 2); assert.equal(j.room.count, 2); assert.equal(j.room.full, true);
  assert.equal(p1.events('player:joined').length, 1);                       // el 1 se entera de que entro el 2
  assert.equal(p1.events('player:joined')[0].player.name, 'Beto');
  assert.equal(p2.events('player:joined').length, 0);                       // quien entra no recibe su propio aviso
  assert.equal(p2.events('player:state')[0].x, 50);                         // y recibe la posicion del 1

  const full = call(p3, 'room:join', { code });
  assert.equal(full.error, 'ROOM_FULL');
  assert.equal(call(p3, 'room:check', { code }).full, true);
  assert.equal(p1.events('room:state').at(-1).count, 2);                    // el rechazo no altera la sala

  // posicion 2 -> 1; el emisor no se recibe a si mismo
  p2.client('player:update', { x: 5, y: 6, dir: 'up', moving: false });
  assert.deepEqual(p1.events('player:state').at(-1), { id: 's2', slot: 2, x: 5, y: 6, dir: 'up', moving: false });
  assert.equal(p2.events('player:state').filter((s) => s.id === 's2').length, 0);
  // datos basura: se ignoran y no rompen nada
  p2.client('player:update', { x: 'hack', y: {} }); p2.client('player:update'); p2.client('player:update', null);
  assert.equal(errors.length, 0);

  // desconexion inesperada del 2
  p2.disconnectNow('ping timeout');
  const left = p1.events('player:left').at(-1);
  assert.equal(left.player.slot, 2); assert.equal(left.reason, 'disconnect'); assert.equal(left.room.count, 1);
  assert.equal(p1.events('room:state').at(-1).count, 1);

  // un nuevo jugador toma el puesto libre (sin duplicados)
  const j3 = call(p3, 'room:join', { code });
  assert.equal(j3.ok, true); assert.equal(j3.you.slot, 2);
  assert.equal(manager.stats().players, 2);

  // salir voluntariamente
  assert.equal(call(p3, 'room:leave').ok, true);
  assert.equal(p1.events('player:left').at(-1).reason, 'left');
  assert.equal(call(p3, 'room:leave').error, 'NOT_IN_ROOM');

  // ultimo jugador se va: sala eliminada
  p1.disconnectNow();
  assert.equal(manager.stats().rooms, 0); assert.equal(manager.stats().players, 0);
  assert.equal(errors.length, 0);
});

test('no se puede estar en dos salas ni crear dos veces', () => {
  const { manager, connect, call } = setup();
  const p = connect('a');
  const c = call(p, 'room:create', {});
  assert.equal(c.you.name, 'Jugador 1');
  assert.equal(call(p, 'room:create', {}).error, 'ALREADY_IN_ROOM');
  assert.equal(call(p, 'room:join', { code: c.room.code }).error, 'ALREADY_IN_ROOM');
  assert.equal(manager.stats().rooms, 1);
});

test('argumentos raros no rompen los handlers', () => {
  const { connect, call, errors } = setup();
  const p = connect('a');
  for (const bad of [undefined, null, 5, 'texto', [], [1, 2], { code: {} }, { code: [] }, { name: {}, code: 7 }]) {
    call(p, 'room:join', bad); call(p, 'room:check', bad); call(p, 'room:create', bad);
    p.client('player:update', bad);
    if (call(p, 'room:leave').ok) { /* salio de la sala recien creada */ }
  }
  const q = connect('b');                                            // socket nuevo (el anterior ya agoto su limite de peticiones)
  let res; q.client('room:create', (r) => { res = r; });            // solo callback, sin payload
  assert.equal(res.ok, true);
  assert.equal(call(q, 'ping:check').ok, true);
  assert.equal(errors.length, 0);
});

test('limitador: spam de crear/unirse se corta', () => {
  const { connect, call } = setup();
  const p = connect('a');
  let limited = false;
  for (let i = 0; i < 30; i++) if (call(p, 'room:check', { code: 'ZZZZZ' }).error === 'RATE_LIMIT') limited = true;
  assert.equal(limited, true);
});

test('dos salas distintas no se mezclan', () => {
  const { connect, call } = setup();
  const a1 = connect('a1'), a2 = connect('a2'), b1 = connect('b1'), b2 = connect('b2');
  const ca = call(a1, 'room:create', {}).room.code, cb = call(b1, 'room:create', {}).room.code;
  assert.notEqual(ca, cb);
  call(a2, 'room:join', { code: ca }); call(b2, 'room:join', { code: cb });
  a1.client('player:update', { x: 1, y: 1 });
  assert.equal(b1.events('player:state').length, 0); assert.equal(b2.events('player:state').length, 0);
  assert.equal(a2.events('player:state').length, 1);
});

test('inicio sincronizado: solo el host, con 2 jugadores; ambos reciben game:start', () => {
  const { connect, call } = setup();
  const a = connect('a'), b = connect('b'), c = connect('c');
  const code = call(a, 'room:create', { name: 'Ana' }).room.code;
  assert.equal(call(a, 'room:start').error, 'NOT_ENOUGH_PLAYERS');
  call(b, 'room:join', { code });
  assert.equal(call(b, 'room:start').error, 'NOT_HOST');
  assert.equal(a.events('game:start').length + b.events('game:start').length, 0);
  assert.equal(call(a, 'room:start').ok, true);
  const ga = a.events('game:start')[0], gb = b.events('game:start')[0];
  assert.ok(ga && gb); assert.equal(ga.seed, gb.seed); assert.equal(ga.startAt, gb.startAt); assert.equal(ga.room.players.length, 2);
  assert.equal(call(c, 'room:join', { code }).error, 'ROOM_FULL');
  assert.equal(c.events('game:start').length, 0);
});
