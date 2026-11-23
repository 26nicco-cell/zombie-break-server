# ZOMBIE BREAK · Servidor multijugador (Fase 1)

Servidor online real hecho con **Node.js + Express + Socket.IO**. Esta primera fase solo hace lo necesario para comprobar que
**dos jugadores pueden conectarse a la misma sala** y verse (presencia y posición básica).

> Esta fase **no** incluye zombis sincronizados, combate, inventario compartido ni construcción. El juego ZOMBIE BREAK no se modifica en esta etapa.

## Qué hace

- Crear sala con **código único de 5 caracteres** (sin 0/O/1/I para no confundirse al dictarlo).
- Unirse con ese código. Salas de **2 jugadores** (se cambia en `src/config.js`).
- Muestra cuántos jugadores hay (`1/2`), detecta sala llena y sala inexistente.
- Abandonar sala; las **salas vacías se eliminan solas**.
- Desconexiones inesperadas (cerrar la app, perder red) se gestionan: el otro jugador recibe el aviso y el puesto queda libre.
- Un mismo jugador no puede estar en dos salas ni duplicarse.
- Sincroniza posición básica (`x`, `y`, dirección, si se mueve) entre los dos jugadores.
- Seguridad básica: valida códigos, nombres y datos numéricos, limita la velocidad de mensajes y el tamaño, y nunca confía en lo que envía el cliente.
- Cada evento está protegido con `try/catch`: un dato raro de un cliente no tumba el servidor.

## Estructura

```
server.js            Arranque: Express + Socket.IO, /health, página de prueba
src/config.js        Toda la configuración (jugadores por sala, límites, puertos)
src/rooms.js         Lógica de salas y jugadores (sin red, fácil de ampliar y probar)
src/handlers.js      Conecta los eventos de Socket.IO con la lógica de salas
public/index.html    Página de prueba real: dos pestañas/teléfonos, cuadrados que se mueven
scripts/smoke-test.js  Prueba real con clientes Socket.IO contra un servidor en marcha
test/                Pruebas automáticas de la lógica (npm test)
render.yaml          Configuración opcional para Render
```

Para futuras fases: agrega nuevos eventos en `src/handlers.js` y su lógica en un módulo nuevo dentro de `src/` (por ejemplo `src/zombies.js`),
usando el mismo patrón que `rooms.js`.

---

## 1) Probarlo en tu computadora (opcional)

Necesitas [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
npm test          # pruebas de la lógica (no necesitan red)
npm start         # servidor en http://localhost:3000
```

Abre **http://localhost:3000** en dos pestañas del navegador: en una pulsa **CREAR SALA**, copia el código y en la otra pulsa **UNIRSE**.
Mueve tu cuadrado con las flechas/WASD y verás el del otro jugador moverse.

Con el servidor encendido, en otra terminal puedes correr la prueba automática real:

```bash
npm run smoke                                  # contra localhost:3000
npm run smoke -- https://TU-SERVIDOR.onrender.com   # contra el servidor online
```

---

## 2) Subirlo a tu repositorio de GitHub

Dentro de la carpeta del proyecto (la que contiene `server.js`), reemplaza `TU-USUARIO` y `TU-REPO` por los tuyos:

```bash
git init
git add .
git commit -m "Servidor multijugador ZOMBIE BREAK - Fase 1"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

- Si GitHub te pide contraseña, usa un **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens) en lugar de tu contraseña.
- Si no usas la terminal: en la página de tu repositorio pulsa **Add file → Upload files**, arrastra todos los archivos y carpetas de este proyecto
  (**no** subas `node_modules`) y pulsa **Commit changes**.
- El repositorio debe quedar con `package.json` y `server.js` en la raíz (no dentro de otra carpeta).

---

## 3) Ponerlo online en Render (gratis)

1. Entra en **https://render.com** y crea una cuenta (puedes usar tu cuenta de GitHub).
2. Pulsa **New + → Web Service**.
3. Elige **Build and deploy from a Git repository** y conecta tu GitHub. Autoriza el acceso al repositorio del servidor y selecciónalo.
4. Completa:
   - **Name:** `zombie-break-server` (será parte de la URL)
   - **Region:** la más cercana (por ejemplo *Oregon* o *Frankfurt*; para Argentina suele ir mejor la de EE. UU.)
   - **Branch:** `main`
   - **Runtime / Language:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
5. Abre **Advanced** y añade (opcional) la variable de entorno `ALLOWED_ORIGINS` = `*`. En **Health Check Path** escribe `/health`.
6. Pulsa **Create Web Service**. Espera unos minutos hasta ver en el registro `ZOMBIE BREAK server escuchando en el puerto ...` y el estado **Live**.

> Alternativa: como el repositorio incluye `render.yaml`, también puedes usar **New + → Blueprint** y seleccionar el repositorio.

### Obtener la URL del servidor

Arriba a la izquierda del servicio en Render aparece la URL, con este formato:

```
https://zombie-break-server.onrender.com
```

Compruébalo desde el navegador:

- `https://TU-URL.onrender.com/health` → debe mostrar `{"ok":true,...}`
- `https://TU-URL.onrender.com/` → página de prueba multijugador (ábrela en dos teléfonos o pestañas).
- `npm run smoke -- https://TU-URL.onrender.com` → prueba automática completa.

### Importante sobre el plan gratuito de Render

- El servidor se **duerme tras ~15 minutos sin uso** y tarda **30-60 segundos** en despertar en la primera conexión. Es normal; el juego debería mostrar "Conectando…" y esperar.
- Se reinicia de vez en cuando; las salas viven en memoria, así que se pierden en cada reinicio (en esta fase no se guardan).
- Para que nunca se duerma, hay que pasar a un plan de pago.
- Cada vez que haces `git push` a `main`, Render vuelve a desplegar automáticamente.

---

## 4) Conectar el juego más adelante (referencia para la Fase 2)

En esta fase el juego no se toca. Cuando llegue el momento, el juego solo necesita:

1. **Incluir la librería cliente dentro del juego** (el juego funciona sin internet, así que debe ir empaquetada en el APK, no desde una web).
   Se obtiene al hacer `npm install` en este proyecto: `node_modules/socket.io-client/dist/socket.io.min.js`. Con el servidor encendido también se
   descarga de `https://TU-URL.onrender.com/socket.io/socket.io.js`.
2. Conectarse a la URL **con `https://`** (Android bloquea `http://` en texto plano en la mayoría de casos):

```js
const socket = io('https://TU-URL.onrender.com', { transports: ['websocket'] });

socket.emit('room:create', { name: 'Yanina' }, (res) => {
  if (res.ok) console.log('Código de sala:', res.room.code);
});
socket.emit('room:join', { code: 'K7M2Q', name: 'León' }, (res) => { /* res.ok, res.you, res.room */ });
socket.emit('player:update', { x: 120, y: 340, dir: 'left', moving: true });   // ~20 veces por segundo
socket.on('player:state', (s) => { /* posición del otro jugador */ });
```

## Referencia de eventos

**Cliente → servidor** (con callback de respuesta salvo `player:update`):

| Evento | Datos | Respuesta |
|---|---|---|
| `room:create` | `{ name? }` | `{ ok, you:{id,slot,name}, room }` |
| `room:join` | `{ code, name? }` | `{ ok, you, room }` o `{ ok:false, error, message }` |
| `room:check` | `{ code }` | `{ ok, exists, count, max, full }` |
| `room:leave` | – | `{ ok }` |
| `room:start` | – (solo el anfitrión, sala 2/2) | `{ ok }` y luego todos reciben `game:start` |
| `player:update` | `{ x, y, dir, moving }` | (sin respuesta) |
| `ping:check` | – | `{ ok, serverTime }` |

**Servidor → cliente:** `hello`, `room:state` (`{code,count,max,full,players[]}`), `player:joined`, `player:left` (`reason`: `left` o `disconnect`), `player:state`, `game:start` (`{code,seed,startAt,countdownMs,serverTime,room}`; `startAt` es la hora del servidor en que arranca la partida).

**Errores** (`error`): `INVALID_CODE`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ALREADY_IN_ROOM`, `NOT_IN_ROOM`, `NOT_HOST`, `NOT_ENOUGH_PLAYERS`, `ROOM_STARTED`, `ALREADY_STARTED`, `SERVER_FULL`, `RATE_LIMIT`, `BAD_DATA`.

## Variables de entorno (todas opcionales)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3000` | Render la define sola |
| `ALLOWED_ORIGINS` | `*` | Orígenes permitidos (un APK/WebView necesita `*`) |
| `MAX_ROOMS` | `500` | Tope de salas simultáneas |
| `MAX_CONNECTIONS` | `1000` | Tope de conexiones simultáneas |

## Qué se probó y qué no

- ✅ `npm test`: 19 pruebas automáticas de la lógica de salas y de los eventos (crear, unirse, sala llena, sala inexistente, códigos inválidos,
  duplicados, salir, desconexión, limpieza de salas vacías, validación de posiciones, límites de velocidad, datos basura).
  Esas pruebas usan una simulación mínima de Socket.IO (`test/mock-io.js`), no la red real.
- ⚠️ La conexión real con Express + Socket.IO **no se pudo ejecutar donde se desarrolló** (sin acceso a internet para instalar los paquetes).
  Por eso se incluyen `npm run smoke` y la página `public/index.html`: son la prueba real y conviene correrlas apenas lo tengas online.


## Mundo compartido (Etapa 1)

El servidor es la autoridad del estado del mundo de cada sala iniciada (`src/world.js`). Los clientes piden, el servidor valida, y solo lo valido se aplica y se retransmite.

| Evento (cliente → servidor) | Datos | Respuesta |
|---|---|---|
| `world:hit` | `{ id, kind }` (id del objeto del mapa, kind: tree/deadtree/bush/rock/log/box) | `{ ok, id, kind, uses, max, gone }` o `{ ok:false, error: GONE / RATE_LIMIT / BAD_DATA / NOT_STARTED }` |
| `world:sync` | – | `{ ok, world }` (foto completa) |

| Evento (servidor → cliente) | Datos |
|---|---|
| `world:op` | `{ t:'node', id, kind, uses, gone, rev, by }` (cambio hecho por el otro jugador) |
| `game:start` | ahora incluye `world` (reloj + foto) |

- **Reloj global:** `world.clock = { base, t0, dayLenMs }`. Hora absoluta = `base + (horaServidor - t0) / dayLenMs`. Los clientes la calculan con la hora del servidor, no con su propio reloj.
- **Reconexión:** `room:join` con el código de una partida iniciada que tenga un puesto libre devuelve `world` (foto). Una partida iniciada sin jugadores se conserva 10 minutos (`RECONNECT_GRACE_MS`).
- **Persistencia:** solo en memoria. Si Render reinicia o duerme el servicio, las partidas en curso se pierden.
- Para ampliar: agregar un módulo (estado + operación validada + evento `world:op`) en `world.js`; ver `hitNode`.
