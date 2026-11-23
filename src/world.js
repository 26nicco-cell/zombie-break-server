'use strict';
/* WorldState: estado compartido de UNA sala (autoridad del servidor). Pura logica, sin red.
   Estructura ampliable: cada sistema del juego se agrega como un "modulo" con su propio estado y sus operaciones
   (hoy: reloj global y nodos recolectables; luego cofres, objetos del suelo, zombis, construcciones...).
   Todo cambio llega como operacion, se VALIDA aqui, y solo si es valido se aplica y se retransmite. */
const CFG = require('./config');

class WorldState {
  constructor(now) {
    now = now == null ? Date.now() : now;
    this.rev = 0;                                   // contador de cambios (sirve para detectar desfases)
    this.clock = { base: CFG.CLOCK_START_ABS, t0: now, dayLenMs: CFG.DAY_LEN_MS };
    this.nodes = new Map();                         // id de objeto -> { kind, uses, gone }
    this.lastHit = new Map();                       // playerId -> ms del ultimo golpe aceptado
  }

  /* ---------- reloj global: tiempo absoluto del juego (dias = parte entera) ---------- */
  absAt(now) { now = now == null ? Date.now() : now; return this.clock.base + (now - this.clock.t0) / this.clock.dayLenMs; }
  restartClock(now) { now = now == null ? Date.now() : now; this.clock = { base: CFG.CLOCK_START_ABS, t0: now, dayLenMs: CFG.DAY_LEN_MS }; }

  /* ---------- nodos recolectables (arboles, rocas, arbustos, lena, cajas) ---------- */
  /* op: { id, kind }. Cada golpe valido suma un uso; al llegar al maximo el nodo desaparece para ambos.
     Devuelve { ok, id, uses, max, gone } o { ok:false, error }. El cliente solo da la recompensa si ok === true. */
  hitNode(playerId, op, now) {
    now = now == null ? Date.now() : now;
    if (!op || typeof op !== 'object') return { ok: false, error: 'BAD_DATA' };
    const id = op.id, kind = op.kind;
    if (!Number.isInteger(id) || id < 0 || id > CFG.MAX_OBJECT_ID) return { ok: false, error: 'BAD_DATA' };
    const max = CFG.NODE_MAX_USES[kind];
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(CFG.NODE_MAX_USES, kind)) return { ok: false, error: 'BAD_DATA' };
    let n = this.nodes.get(id);
    if (n && n.gone) return { ok: false, error: 'GONE', id, uses: n.uses, gone: true };      // otro jugador ya lo agoto
    if (n && n.kind !== kind) return { ok: false, error: 'BAD_DATA' };                        // el tipo de un objeto no cambia
    const last = this.lastHit.get(playerId) || 0;
    if (now - last < CFG.HIT_MIN_INTERVAL_MS) return { ok: false, error: 'RATE_LIMIT', silent: true };
    this.lastHit.set(playerId, now);
    if (!n) { n = { kind, uses: 0, gone: false }; this.nodes.set(id, n); }
    n.uses++;
    if (n.uses >= max) n.gone = true;
    this.rev++;
    return { ok: true, id, kind, uses: n.uses, max, gone: n.gone, rev: this.rev };
  }

  /* ---------- foto completa: se envia al unirse o reconectarse ---------- */
  snapshot(now) {
    now = now == null ? Date.now() : now;
    const nodes = [];
    this.nodes.forEach((n, id) => nodes.push([id, n.kind, n.uses, n.gone ? 1 : 0]));
    return { rev: this.rev, serverTime: now, clock: Object.assign({}, this.clock), nodes };
  }

  forgetPlayer(playerId) { this.lastHit.delete(playerId); }
}

module.exports = WorldState;
