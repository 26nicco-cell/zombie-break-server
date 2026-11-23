'use strict';
/* Prueba REAL contra un servidor en marcha (local o en Render), usando clientes Socket.IO de verdad.
   Uso:   npm run smoke                      -> contra http://localhost:3000
          npm run smoke -- https://tu-app.onrender.com
   Requiere haber hecho `npm install` (usa socket.io-client). */
const { io } = require('socket.io-client');

const URL = process.argv[2] || process.env.SERVER_URL || 'http://localhost:3000';
let failures = 0;
function check(cond, label) { console.log((cond ? '  OK   ' : '  FALLA ') + label); if (!cond) failures++; }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(name) {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false, timeout: 60000 });   // 60 s: Render free puede tardar en despertar
    s.log = [];
    ['room:state', 'player:joined', 'player:left', 'player:state', 'game:start'].forEach((ev) => s.on(ev, (d) => s.log.push({ ev, d })));
    s.once('connect', () => resolve(s));
    s.once('connect_error', (e) => reject(new Error(name + ' no pudo conectar: ' + e.message)));
  });
}
const emit = (s, ev, payload) => new Promise((resolve) => s.emit(ev, payload, resolve));

(async () => {
  console.log('Servidor: ' + URL);
  const a = await connect('Jugador 1'), b = await connect('Jugador 2'), c = await connect('Jugador 3');
  check(a.id && b.id && a.id !== b.id, 'los jugadores tienen ids distintos');

  const created = await emit(a, 'room:create', { name: 'Ana' });
  check(created.ok && /^[A-HJ-NP-Z2-9]{5}$/.test(created.room.code), 'jugador 1 crea sala con codigo valido: ' + (created.room && created.room.code));
  const code = created.room.code;

  check((await emit(b, 'room:join', { code: 'ZZZZZ' })).error === 'ROOM_NOT_FOUND' || code === 'ZZZZZ', 'sala inexistente rechazada');
  check((await emit(b, 'room:join', { code: 'x' })).error === 'INVALID_CODE', 'codigo invalido rechazado');
  check((await emit(b, 'room:check', { code })).count === 1, 'la sala muestra 1/2 jugadores');

  a.emit('player:update', { x: 100, y: 200, dir: 'right', moving: true });
  await wait(150);
  const joined = await emit(b, 'room:join', { code, name: 'Beto' });
  check(joined.ok && joined.you.slot === 2 && joined.room.count === 2 && joined.room.full, 'jugador 2 se une (2/2, sala llena)');
  await wait(300);
  check(a.log.some((l) => l.ev === 'player:joined' && l.d.player.name === 'Beto'), 'jugador 1 ve que entro el jugador 2');
  check(b.log.some((l) => l.ev === 'player:state' && l.d.slot === 1 && l.d.x === 100), 'jugador 2 recibe la posicion del jugador 1 al entrar');

  check((await emit(b, 'room:start')).error === 'NOT_HOST', 'solo el anfitrion puede iniciar');
  check((await emit(a, 'room:start')).ok, 'el anfitrion inicia la partida');
  await new Promise((r) => setTimeout(r, 300));
  check(a.log.some((l) => l.ev === 'game:start') && b.log.some((l) => l.ev === 'game:start'), 'ambos reciben game:start');
  check(['ROOM_FULL', 'ROOM_STARTED'].includes((await emit(c, 'room:join', { code })).error), 'el tercer jugador es rechazado (sala llena o partida iniciada)');
  check((await emit(b, 'room:create', {})).error === 'ALREADY_IN_ROOM', 'no se puede crear sala estando ya en una');

  b.emit('player:update', { x: 5, y: 6, dir: 'up', moving: false });
  await wait(300);
  check(a.log.some((l) => l.ev === 'player:state' && l.d.slot === 2 && l.d.x === 5 && l.d.y === 6), 'la posicion del jugador 2 llega al jugador 1');
  check(!b.log.some((l) => l.ev === 'player:state' && l.d.slot === 2), 'nadie recibe su propia posicion');

  b.disconnect();                                    // cierre inesperado
  await wait(500);
  check(a.log.some((l) => l.ev === 'player:left' && l.d.player.slot === 2), 'jugador 1 ve que el jugador 2 se desconecto');
  check((await emit(a, 'room:check', { code })).count === 1, 'la sala vuelve a 1/2 jugadores');

  const rejoin = await emit(c, 'room:join', { code, name: 'Cami' });
  check(rejoin.ok && rejoin.you.slot === 2, 'otro jugador ocupa el puesto libre');

  check((await emit(c, 'room:leave')).ok, 'abandonar sala funciona');
  a.disconnect(); await wait(500);
  check((await emit(c, 'room:check', { code })).exists === false, 'la sala vacia se elimino');

  c.disconnect();
  console.log(failures ? '\n' + failures + ' comprobacion(es) FALLARON' : '\nTodo correcto.');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('Error en la prueba: ' + e.message); process.exit(1); });
