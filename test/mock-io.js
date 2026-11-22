'use strict';
/* Mini simulacion de Socket.IO (solo la parte de la API que usa handlers.js) para probar la logica SIN red.
   NO sustituye la prueba real contra el servidor: para eso esta `npm run smoke`. */
const { EventEmitter } = require('node:events');

function createMockIO() {
  const sockets = new Map();
  const io = {
    sockets,
    to(room) {
      return { emit(ev, data) { sockets.forEach((s) => { if (s.rooms.has(room)) s._receive(ev, data); }); } };
    },
    connect(id) {
      const s = new EventEmitter();
      s.id = id; s.rooms = new Set(); s.received = [];
      s.join = (r) => s.rooms.add(r);
      s.leave = (r) => s.rooms.delete(r);
      s.emit_ = EventEmitter.prototype.emit.bind(s);
      s._receive = (ev, data) => s.received.push({ ev, data });
      s.emit = (ev, data) => s._receive(ev, data);                 // servidor -> este cliente
      s.to = (room) => {
        const bc = { emit(ev, data) { sockets.forEach((o) => { if (o !== s && o.rooms.has(room)) o._receive(ev, data); }); } };
        bc.volatile = bc; return bc;
      };
      // cliente -> servidor
      s.client = (ev, payload, cb) => { s.emit_(ev, payload, cb); };
      s.disconnectNow = (reason) => { s.emit_('disconnect', reason || 'transport close'); sockets.delete(id); s.rooms.clear(); };
      s.events = (name) => s.received.filter((r) => r.ev === name).map((r) => r.data);
      sockets.set(id, s);
      return s;
    }
  };
  return io;
}
module.exports = createMockIO;
