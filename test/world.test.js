'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const WorldState = require('../src/world');
const RoomManager = require('../src/rooms');
const registerHandlers = require('../src/handlers');
const createMockIO = require('./mock-io');

test('reloj global: avanza con el reloj del servidor y es el mismo para todos', () => {
  const w = new WorldState(1000);
  assert.ok(Math.abs(w.absAt(1000) - 8 / 24) < 1e-9);
  assert.ok(Math.abs(w.absAt(1000 + 150000) - (8 / 24 + 0.5)) < 1e-9);       // medio dia despues
});

test('arbol: 4 golpes (de cualquiera de los dos) lo agotan y no se premia dos veces', () => {
  const w = new WorldState(0), res = [];
  res.push(w.hitNode('a', { id: 7, kind: 'tree' }, 1000));
  res.push(w.hitNode('b', { id: 7, kind: 'tree' }, 1000));                    // golpe simultaneo de otro jugador
  res.push(w.hitNode('a', { id: 7, kind: 'tree' }, 1300));
  res.push(w.hitNode('b', { id: 7, kind: 'tree' }, 1300));
  assert.deepEqual(res.map((r) => r.uses), [1, 2, 3, 4]); assert.equal(res[3].gone, true);
  const late = w.hitNode('a', { id: 7, kind: 'tree' }, 2000);
  assert.equal(late.ok, false); assert.equal(late.error, 'GONE');             // ya no da recompensa
  assert.equal(w.nodes.size, 1);
});

test('validaciones: tipo falso, id invalido, tipo cambiado y golpes demasiado rapidos', () => {
  const w = new WorldState(0);
  assert.equal(w.hitNode('a', { id: 'x', kind: 'tree' }).error, 'BAD_DATA');
  assert.equal(w.hitNode('a', { id: -1, kind: 'tree' }).error, 'BAD_DATA');
  assert.equal(w.hitNode('a', { id: 1, kind: 'oro' }).error, 'BAD_DATA');
  assert.equal(w.hitNode('a', { id: 1, kind: '__proto__' }).error, 'BAD_DATA');
  assert.equal(w.hitNode('a', null).error, 'BAD_DATA');
  assert.equal(w.hitNode('a', { id: 1, kind: 'rock' }, 1000).ok, true);
  assert.equal(w.hitNode('a', { id: 1, kind: 'rock' }, 1050).error, 'RATE_LIMIT');   // spam
  assert.equal(w.hitNode('b', { id: 1, kind: 'tree' }, 1100).error, 'BAD_DATA');     // el tipo no puede cambiar
  assert.equal(w.hitNode('a', { id: 2, kind: 'log' }, 1200).gone, true);             // la lena se agota con 1 golpe
});

test('snapshot: contiene el estado para reconstruir al reconectar', () => {
  const w = new WorldState(0);
  w.hitNode('a', { id: 3, kind: 'rock' }, 1000); w.hitNode('a', { id: 4, kind: 'log' }, 1200);
  const s = w.snapshot(5000);
  assert.deepEqual(s.nodes.sort((x, y) => x[0] - y[0]), [[3, 'rock', 1, 0], [4, 'log', 1, 1]]);
  assert.equal(s.clock.dayLenMs, 300000); assert.equal(s.rev, 2);
});

function setup() {
  const io = createMockIO(), manager = new RoomManager();
  const connect = (id) => { const s = io.connect(id); registerHandlers(io, s, manager, () => {}); return s; };
  const call = (s, ev, payload) => { let res; s.client(ev, payload, (r) => { res = r; }); return res; };
  return { manager, connect, call };
}

test('handlers: world:hit responde al que golpea, avisa al otro y rechaza fuera de partida', () => {
  const { manager, connect, call } = setup();
  const a = connect('a'), b = connect('b');
  const code = call(a, 'room:create', { name: 'A' }).room.code;
  call(b, 'room:join', { code });
  assert.equal(call(a, 'world:hit', { id: 5, kind: 'tree' }).error, 'NOT_STARTED');
  call(a, 'room:start');
  const r = call(a, 'world:hit', { id: 5, kind: 'tree' });
  assert.equal(r.ok, true); assert.equal(r.uses, 1);
  const op = b.events('world:op').at(-1);
  assert.equal(op.id, 5); assert.equal(op.uses, 1); assert.equal(op.gone, false);
  assert.equal(a.events('world:op').length, 0);                                // el que golpea no recibe su propia operacion
  const rb = call(b, 'world:hit', { id: 5, kind: 'tree' });
  assert.equal(rb.ok, true); assert.equal(rb.uses, 2);                         // el otro jugador suma sobre el mismo arbol
  assert.equal(a.events('world:op').at(-1).uses, 2);
});

test('reconexion: quien vuelve a entrar recibe el mundo actual y la partida sobrevive si quedan 0 jugadores', () => {
  const { manager, connect, call } = setup();
  const a = connect('a'), b = connect('b');
  const code = call(a, 'room:create', { name: 'A' }).room.code;
  call(b, 'room:join', { code }); call(a, 'room:start');
  manager.rooms.get(code).world.hitNode('a', { id: 9, kind: 'log' }, 1000);
  b.disconnectNow('ping timeout');
  const b2 = connect('b2');
  const j = call(b2, 'room:join', { code, name: 'B' });
  assert.equal(j.ok, true); assert.equal(j.room.started, true);
  assert.deepEqual(j.world.nodes, [[9, 'log', 1, 1]]);
  assert.equal(j.you.slot, 2);
  // todos se van: la partida iniciada se conserva y luego se limpia
  a.disconnectNow(); b2.disconnectNow();
  assert.equal(manager.rooms.has(code), true);
  const c = connect('c'); const j2 = call(c, 'room:join', { code, name: 'C' });
  assert.equal(j2.ok, true); assert.equal(j2.room.host, 'c'); assert.equal(j2.world.nodes.length, 1);
  c.disconnectNow();
  assert.equal(manager.sweep(Date.now() + 700000), 1); assert.equal(manager.rooms.has(code), false);
});
