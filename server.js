// Сервер «Бункера». Без внешних библиотек: обычный Node.js.
// Клиенты получают обновления через Server-Sent Events, а действия шлют POST-запросами.
const http = require('http');
const fs = require('fs');
const path = require('path');
const G = require('./game');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const rooms = new Map(); // code -> room
const subs = new Map(); // code -> Map(playerId -> Set(res))

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastState(room) {
  room.touched = Date.now();
  const m = subs.get(room.code);
  if (!m) return;
  for (const [pid, set] of m) {
    const p = G.byId(room, pid);
    const data = `event: state\ndata: ${JSON.stringify(G.view(room, p))}\n\n`;
    for (const res of set) res.write(data);
  }
}

function broadcast(room, event, data, exceptPid) {
  const m = subs.get(room.code);
  if (!m) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [pid, set] of m) if (pid !== exceptPid) for (const res of set) res.write(msg);
}

function dropSubscriber(room, pid, ev) {
  const m = subs.get(room.code);
  if (!m || !m.has(pid)) return;
  for (const res of m.get(pid)) { if (ev) sse(res, ev, {}); res.end(); }
  m.delete(pid);
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}

function auth(msg) {
  const room = rooms.get(String(msg.code || '').toUpperCase());
  if (!room) return {};
  const player = room.players.find((p) => p.token === msg.token);
  return { room, player };
}

async function api(req, res) {
  const msg = await readBody(req);
  const type = msg.type;

  if (type === 'create') {
    const room = G.createRoom(newCode());
    rooms.set(room.code, room);
    const r = G.addPlayer(room, msg.name);
    return json(res, 200, { code: room.code, id: r.player.id, token: r.player.token });
  }
  if (type === 'join') {
    const room = rooms.get(String(msg.code || '').trim().toUpperCase());
    if (!room) return json(res, 404, { error: 'Комната не найдена. Проверь код.' });
    const r = G.addPlayer(room, msg.name);
    if (r.error) return json(res, 400, { error: r.error });
    broadcastState(room);
    return json(res, 200, { code: room.code, id: r.player.id, token: r.player.token });
  }

  const { room, player } = auth(msg);
  if (!room) return json(res, 404, { error: 'Комната не найдена. Возможно, сервер перезапускался.' });
  if (!player) return json(res, 403, { error: 'Тебя нет в этой комнате.' });

  if (type === 'pose') {
    player.yaw = Number(msg.yaw) || 0;
    player.pitch = Number(msg.pitch) || 0;
    broadcast(room, 'pose', { id: player.id, yaw: player.yaw, pitch: player.pitch }, player.id);
    res.writeHead(204); return res.end();
  }
  if (type === 'gesture') {
    broadcast(room, 'gesture', { id: player.id, g: String(msg.g || '').slice(0, 20) }, player.id);
    res.writeHead(204); return res.end();
  }

  const r = G.handle(room, player, msg);
  if (r.error) return json(res, 400, { error: r.error });
  if (r.kicked) dropSubscriber(room, r.kicked, 'kicked');
  if (r.left) dropSubscriber(room, player.id, 'kicked');
  if (!room.players.length) { rooms.delete(room.code); subs.delete(room.code); return json(res, 200, { ok: true }); }
  broadcastState(room);
  json(res, 200, { ok: true });
}

function stream(req, res, url) {
  const room = rooms.get(String(url.searchParams.get('code') || '').toUpperCase());
  const player = room && room.players.find((p) => p.token === url.searchParams.get('token'));
  if (!room || !player) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    sse(res, 'gone', { error: 'Комната не найдена.' });
    return res.end();
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  if (!subs.has(room.code)) subs.set(room.code, new Map());
  const m = subs.get(room.code);
  if (!m.has(player.id)) m.set(player.id, new Set());
  m.get(player.id).add(res);
  player.connected = true;
  broadcastState(room);

  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    clearInterval(ping);
    const set = m.get(player.id);
    if (set) {
      set.delete(res);
      if (!set.size) {
        m.delete(player.id);
        player.connected = false;
        broadcastState(room);
      }
    }
  });
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api' && req.method === 'POST') return api(req, res).catch((e) => { console.error(e); json(res, 500, { error: 'Ошибка сервера' }); });
  if (url.pathname === '/api/stream') return stream(req, res, url);
  if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
  serveStatic(req, res, url);
});

// чистим брошенные комнаты
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const m = subs.get(code);
    if ((!m || !m.size) && now - room.touched > 3 * 3600 * 1000) { rooms.delete(code); subs.delete(code); }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Бункер запущен: http://localhost:${PORT}`));
