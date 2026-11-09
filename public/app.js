// Интерфейс «Бункера»: связь с сервером, панели, голосование, финал.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let session = null; // { code, token, id }
let S = null; // последнее состояние
let scene = null;
let es = null;
let epiClosed = false;
let epiShownKey = '';
let logKey = '';

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* приватный режим */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* */ } },
};

// ---------- уведомления ----------
function toast(text, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = text;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'err' ? 3500 : 2200);
}

// ---------- сеть ----------
async function api(type, data = {}, silent = false) {
  try {
    const r = await fetch('/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, code: session && session.code, token: session && session.token, ...data }),
    });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (j.error && !silent) toast(j.error, 'err');
    return j;
  } catch {
    if (!silent) toast('Нет связи с сервером', 'err');
    return { error: 'net' };
  }
}

function connect() {
  if (es) es.close();
  store.set('bunker.session', session);
  history.replaceState(null, '', '?room=' + session.code);
  es = new EventSource(`/api/stream?code=${encodeURIComponent(session.code)}&token=${encodeURIComponent(session.token)}`);
  es.addEventListener('state', (e) => render(JSON.parse(e.data)));
  es.addEventListener('pose', (e) => { const d = JSON.parse(e.data); if (scene) scene.setPose(d.id, d.yaw, d.pitch); });
  es.addEventListener('gesture', (e) => { const d = JSON.parse(e.data); if (scene) scene.gesture(d.id, d.g); });
  es.addEventListener('kicked', () => backToStart('Ты больше не в этой комнате.'));
  es.addEventListener('gone', () => backToStart('Комната не найдена. Возможно, сервер перезапускался — создайте новую.'));
}

function backToStart(msg) {
  if (es) es.close();
  es = null; session = null; S = null;
  store.del('bunker.session');
  history.replaceState(null, '', location.pathname);
  $('#start').hidden = false; $('#lobby').hidden = true; $('#hud').hidden = true; $('#epilogue').hidden = true; $('#showEpi').hidden = true;
  if (msg) toast(msg, 'err');
}

// ---------- вход ----------
function myName() {
  const n = $('#name').value.trim();
  if (!n) { toast('Сначала введи имя', 'err'); $('#name').focus(); return null; }
  store.set('bunker.name', n);
  return n;
}

$('#createBtn').onclick = async () => {
  const name = myName(); if (!name) return;
  const r = await api('create', { name });
  if (r.token) { session = { code: r.code, token: r.token, id: r.id }; connect(); }
};
$('#joinBtn').onclick = async () => {
  const name = myName(); if (!name) return;
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Код комнаты — 4 символа', 'err');
  const r = await api('join', { name, code });
  if (r.token) { session = { code: r.code, token: r.token, id: r.id }; connect(); }
};
$('#codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#joinBtn').click(); });
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') ($('#codeInput').value.trim() ? $('#joinBtn') : $('#createBtn')).click(); });

// ---------- лобби ----------
$('#copyBtn').onclick = async () => {
  const link = $('#inviteLink').value;
  try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
  catch { $('#inviteLink').select(); toast('Скопируй ссылку вручную'); }
};
$('#startBtn').onclick = () => api('start');
$('#leaveBtn').onclick = async () => { await api('leave'); backToStart(); };
$('#setOutsiders').onchange = (e) => api('settings', { outsiders: e.target.checked });
$('#setAdult').onchange = (e) => api('settings', { adult: e.target.checked });

function renderLobby(s) {
  const me = s.me;
  $('#lobbyCode').textContent = s.code;
  $('#inviteLink').value = `${location.origin}${location.pathname}?room=${s.code}`;
  $('#lobbyPlayers').innerHTML = s.players.map((p) => `
    <li>
      <span class="dot" style="background:${p.color}"></span>
      <span class="grow">${esc(p.name)}${p.id === me.id ? ' <span class="muted">(ты)</span>' : ''}</span>
      ${p.id === s.hostId ? '<span class="tag on">ведущий</span>' : ''}
      ${!p.connected ? '<span class="tag">офлайн</span>' : ''}
      ${me.isHost && p.id !== me.id ? `<button class="btn small ghost" data-kick="${p.id}">Убрать</button>` : ''}
    </li>`).join('');
  $('#lobbyPlayers').querySelectorAll('[data-kick]').forEach((b) => (b.onclick = () => api('kick', { target: b.dataset.kick })));
  $('#setOutsiders').checked = s.settings.outsiders;
  $('#setAdult').checked = s.settings.adult;
  $('#setOutsiders').disabled = $('#setAdult').disabled = !me.isHost;
  $('#startBtn').hidden = !me.isHost;
  const n = s.players.length;
  $('#lobbyWait').textContent = me.isHost
    ? `Игроков: ${n}. В бункер попадут ${Math.max(1, Math.ceil(n / 2))}.`
    : 'Ждём, пока ведущий начнёт игру…';
}

// ---------- игра ----------
const byId = (id) => S.players.find((p) => p.id === id);
const aliveList = () => S.players.filter((p) => !p.exiled);
const ACTIVE = ['reveal', 'discuss', 'vote', 'result'];

function renderTop(s) {
  const me = s.me;
  const sp = s.speaker && byId(s.speaker);
  const alive = aliveList();
  let text = '';
  const badge = s.round ? `<span class="badge">Раунд ${s.round}/${s.rounds}</span>` : '';
  if (s.phase === 'reveal') text = `${badge}Ходит: ${esc(sp ? sp.name : '…')}${sp && sp.id === me.id ? ' (ты)' : ''}`;
  else if (s.phase === 'discuss') text = `${badge}Обсуждение${s.voteRound ? ' · дальше голосование' : ''}`;
  else if (s.phase === 'vote') text = `${badge}${s.revote ? 'Переголосование' : 'Голосование'} · ${alive.filter((p) => p.voted).length}/${alive.length}`;
  else if (s.phase === 'result') text = `${badge}${esc(s.lastVote ? s.lastVote.name : '')} покидает бункер`;
  else if (s.phase === 'epilogue') text = '<span class="badge">Финал</span>Игра окончена';
  $('#phase').innerHTML = text;

  const hc = $('#hostControls');
  hc.innerHTML = '';
  if (!me.isHost) return;
  const add = (label, type, cls = '') => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls; b.textContent = label; b.onclick = () => api(type);
    hc.appendChild(b);
  };
  if (s.phase === 'reveal') add('Пропустить ход', 'skipTurn');
  if (s.phase === 'discuss') s.voteRound ? add('К голосованию', 'toVote', 'primary') : add('Следующий раунд', 'nextRound', 'primary');
  if (s.phase === 'vote') add('Завершить голосование', 'closeVote');
  if (s.phase === 'result') add('Следующий раунд', 'nextRound', 'primary');
  if (s.phase === 'epilogue') add('Новая игра', 'restart', 'primary');
}

function renderLeft(s) {
  const c = s.catastrophe, b = s.bunker;
  if (!c) return;
  const yw = (n) => { const a = n % 100, d = n % 10; return a >= 11 && a <= 14 ? 'лет' : d === 1 ? 'год' : d >= 2 && d <= 4 ? 'года' : 'лет'; };
  $('#catastrophe').innerHTML = `<div class="sect-title">Катастрофа</div><h3>${esc(c.name)}</h3><div>${esc(c.text)}</div><div class="muted">Сидеть в бункере: ${c.years} ${yw(c.years)}</div>`;
  $('#bunker').innerHTML = `<div class="sect"><div class="sect-title">Бункер</div>
    <div>${b.size} м² · еды на ${b.food} ${yw(b.food)}${b.food < c.years ? ' <span class="tag red">мало</span>' : ''}</div>
    <ul>${b.features.map((f) => `<li class="${f.broken ? 'broken' : ''}">${esc(f.t)}</li>`).join('')}
    ${b.supplies.map((t) => `<li>${esc(t)} <span class="muted">(снаружи)</span></li>`).join('')}</ul></div>
    <div class="sect muted">Мест: ${s.capacity} · сейчас внутри: ${aliveList().length}</div>`;
  $('#threats').innerHTML = s.knownThreats.length
    ? `<div class="sect"><div class="sect-title">Известные проблемы</div><ul>${s.knownThreats.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>`
    : '<div class="sect muted">Какие проблемы ждут бункер — неизвестно. На 3-м раунде что-нибудь скажут по радио.</div>';
  $('#notes').innerHTML = s.me.notes.length ? `<div class="sect"><div class="sect-title">Твои секреты</div>${s.me.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</div>` : '';
}

function renderPlayers(s) {
  const me = s.me;
  const alive = aliveList();
  $('#seats').textContent = `· мест ${s.capacity}, внутри ${alive.length}`;
  const canVote = s.phase === 'vote' && !me.exiled;
  $('#players').innerHTML = s.players.map((p) => {
    const tags = [];
    if (p.id === me.id) tags.push('<span class="tag">ты</span>');
    if (p.id === s.hostId) tags.push('<span class="tag">ведущий</span>');
    if (p.exiled) tags.push('<span class="tag red">выгнан</span>');
    if (s.phase === 'reveal' && s.speaker === p.id) tags.push('<span class="tag on">говорит</span>');
    if (s.phase === 'vote' && !p.exiled && p.voted) tags.push('<span class="tag green">✓</span>');
    if (!p.connected) tags.push('<span class="tag">офлайн</span>');
    const cards = s.keys.filter((k) => p.revealed[k]).map((k) => `<li><b>${esc(s.labels[k])}:</b> ${esc(p.revealed[k])}</li>`).join('');
    const eligible = canVote && !p.exiled && p.id !== me.id && (!s.revote || s.revote.includes(p.id));
    const mine = me.vote === p.id;
    return `<div class="pl ${s.speaker === p.id && s.phase === 'reveal' ? 'speaking' : ''} ${p.exiled ? 'exiled' : ''} ${mine ? 'mine-vote' : ''}">
      <div class="pl-head"><span class="dot" style="background:${p.color}"></span><span class="pl-name">${esc(p.name)}</span>${tags.join('')}</div>
      ${cards ? `<ul class="pl-cards">${cards}</ul>` : '<div class="muted" style="font-size:12px;margin-top:4px">Карты ещё закрыты</div>'}
      ${eligible ? `<button class="btn small ${mine ? 'danger' : ''} vote-btn" data-vote="${p.id}">${mine ? 'Твой голос — выгнать' : 'Голосовать: выгнать'}</button>` : ''}
    </div>`;
  }).join('');
  $('#players').querySelectorAll('[data-vote]').forEach((b) => (b.onclick = () => api('vote', { target: b.dataset.vote })));
}

function renderMine(s) {
  const me = s.me;
  const myTurn = s.phase === 'reveal' && s.speaker === me.id;
  const profOpen = me.cards.some((c) => c.key === 'profession' && c.revealed);
  $('#myCards').innerHTML = me.cards.map((c) => {
    const can = myTurn && !s.turnRevealed && !c.revealed && (s.round !== 1 || c.key === 'profession' || profOpen);
    return `<div class="card ${c.revealed ? 'revealed' : ''} ${can ? 'can' : ''} ${myTurn && !can && !c.revealed ? 'dim' : ''}" data-key="${c.key}" title="${can ? 'Нажми, чтобы открыть' : ''}">
      <div class="lbl">${esc(c.label)}</div>${esc(c.t)}</div>`;
  }).join('');
  $('#myCards').querySelectorAll('.card.can').forEach((el) => (el.onclick = () => api('reveal', { key: el.dataset.key })));

  // подсказка о ходе
  const th = $('#turnHint');
  th.innerHTML = '';
  if (myTurn && !s.turnRevealed) th.innerHTML = s.round === 1 ? '🎤 Твой ход! Открой профессию и расскажи, почему ты нужен бункеру.' : '🎤 Твой ход! Выбери карту, которую откроешь, и убеди всех.';
  else if (myTurn) {
    th.innerHTML = '🎤 Расскажи о своей карте, а потом ';
    const b = document.createElement('button');
    b.className = 'btn small primary'; b.textContent = 'Закончить ход'; b.onclick = () => api('endTurn');
    th.appendChild(b);
  } else if (s.phase === 'vote' && !me.exiled) th.textContent = me.vote ? 'Голос принят. Можно передумать, пока голосуют остальные.' : '🗳️ Выбери в списке справа, кого выгнать.';
  else if (me.exiled && s.phase !== 'epilogue') th.textContent = '🌫️ Тебя выгнали. Ты наблюдаешь из вентиляции' + (me.actions.length ? ' и можешь вмешаться.' : '.');

  // козырь и действия снаружи
  const ex = $('#myExtras');
  ex.innerHTML = '';
  const active = ACTIVE.includes(s.phase);
  const targets = aliveList().filter((p) => p.id !== me.id);
  const makeExtra = (title, desc, used, needTarget, needText, onUse) => {
    const d = document.createElement('div');
    d.className = 'extra' + (used ? ' used' : '');
    d.innerHTML = `<div><div class="t">${esc(title)}</div><div class="d">${esc(desc)}</div></div>`;
    if (!used) {
      let sel = null, inp = null;
      if (needTarget) {
        sel = document.createElement('select');
        sel.innerHTML = targets.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
        d.appendChild(sel);
      }
      if (needText) { inp = document.createElement('input'); inp.placeholder = 'Текст слуха'; inp.maxLength = 160; inp.style.width = '150px'; d.appendChild(inp); }
      const b = document.createElement('button');
      b.className = 'btn small primary'; b.textContent = 'Применить'; b.disabled = !active;
      b.onclick = () => onUse(sel && sel.value, inp && inp.value);
      d.appendChild(b);
    } else d.insertAdjacentHTML('beforeend', '<span class="tag">использован</span>');
    ex.appendChild(d);
  };
  if (!me.exiled && me.trump) makeExtra('Козырь: ' + me.trump.name, me.trump.desc, me.trump.used, me.trump.target, false, (target) => api('trump', { target }));
  if (me.exiled) me.actions.forEach((a, i) => makeExtra(a.name, a.desc, a.used, a.target, a.text, (target, text) => api('outside', { index: i, target, text })));
}

function renderLog(s) {
  const last = s.log[s.log.length - 1];
  const key = s.log.length + '|' + (last ? last.at + last.t : '');
  if (key === logKey) return;
  logKey = key;
  const box = $('#log');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = s.log.map((e) => e.k === 'chat'
    ? `<div class="e chat"><b style="color:${esc(e.color)}">${esc(e.who)}:</b> ${esc(e.t)}</div>`
    : `<div class="e ${e.k}">${esc(e.t)}</div>`).join('');
  if (near) box.scrollTop = box.scrollHeight;
}

$('#chatForm').onsubmit = (e) => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (!v) return;
  $('#chatInput').value = '';
  api('chat', { text: v });
};

// ---------- финал ----------
function renderEpilogue(s) {
  const ep = s.epilogue;
  const key = ep.lines.join('|');
  const fresh = key !== epiShownKey;
  if (fresh) { epiShownKey = key; epiClosed = false; }
  $('#epilogue').hidden = epiClosed;
  $('#showEpi').hidden = !epiClosed;
  const v = $('#epiVerdict');
  v.className = ep.verdict.kind;
  v.innerHTML = `<p class="v-title">${esc(ep.verdict.title)}</p><div class="muted">${esc(ep.verdict.text)}</div>`;

  if (fresh) {
    $('#epiStory').innerHTML = ep.lines.map((l, i) => `<p style="animation-delay:${(i * 0.55).toFixed(2)}s">${esc(l)}</p>`).join('');
    const a = ep.analysis;
    const delay = (ep.lines.length * 0.55 + 0.3).toFixed(2);
    const best = a.perfect
      ? '<div class="best">🏆 <b>Идеальный выбор!</b> Лучше составить бункер было нельзя.</div>'
      : `<div class="best">Лучший состав был: <b>${a.bestNames.map(esc).join(', ')}</b>. С ним итог был бы: «${esc(a.bestVerdict.title)}».<br>Вы угадали <b>${a.matched} из ${a.capacity}</b> мест.${a.hopeless ? '<br>Честно говоря, с такими картами бункер было не спасти никому.' : ''}</div>`;
    $('#epiAnalysis').innerHTML = `<h3>Правильно ли вы выбрали?</h3>${best}<div class="judge">${a.players.map((p) => `
      <div class="judge-row ${p.ok ? 'good' : 'bad'}">
        <div class="who"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</div>
        <div>${esc(p.label)}</div>
        <div class="why">${esc(p.reason)}</div>
      </div>`).join('')}</div>`;
    $('#epiAnalysis').style.animation = `line .6s ${delay}s forwards`;
    $('#epiAnalysis').style.opacity = 0;
    $('#epiCardsList').innerHTML = s.players.map((p) => {
      const c = (s.allCards || []).find((x) => x.id === p.id);
      return `<div class="pc"><div class="pl-head" style="margin-bottom:4px"><span class="dot" style="background:${p.color}"></span><b style="color:var(--text)">${esc(p.name)}</b>${p.exiled ? '<span class="tag red">выгнан</span>' : '<span class="tag green">в бункере</span>'}</div>
        ${c ? c.cards.map((x) => `<div><b>${esc(x.label)}:</b> ${esc(x.t)}</div>`).join('') : ''}</div>`;
    }).join('');
  }
  $('#epiActions').innerHTML = '';
  if (s.me.isHost) {
    const b = document.createElement('button');
    b.className = 'btn primary'; b.textContent = 'Новая игра'; b.onclick = () => api('restart');
    $('#epiActions').appendChild(b);
  } else $('#epiActions').innerHTML = '<span class="muted">Ждём, пока ведущий начнёт новую игру…</span>';
}
$('#closeEpi').onclick = () => { epiClosed = true; $('#epilogue').hidden = true; $('#showEpi').hidden = false; };
$('#showEpi').onclick = () => { epiClosed = false; $('#epilogue').hidden = false; $('#showEpi').hidden = true; };

// ---------- общий рендер ----------
function render(s) {
  S = s;
  if (!s.me) return;
  $('#start').hidden = true;
  $('#lobby').hidden = s.phase !== 'lobby';
  $('#hud').hidden = s.phase === 'lobby';
  if (scene) scene.setPlayers(s, s.me.id);
  if (s.phase === 'lobby') {
    renderLobby(s);
    $('#epilogue').hidden = true; $('#showEpi').hidden = true; epiShownKey = '';
    return;
  }
  renderTop(s); renderLeft(s); renderPlayers(s); renderMine(s); renderLog(s);
  if (s.phase === 'epilogue' && s.epilogue) renderEpilogue(s);
  else { $('#epilogue').hidden = true; $('#showEpi').hidden = true; }
}

// ---------- взгляд и жесты ----------
let pose = null, sentPose = '';
setInterval(() => {
  if (!pose || !session) return;
  const k = pose.yaw.toFixed(2) + ',' + pose.pitch.toFixed(2);
  if (k === sentPose) return;
  sentPose = k;
  api('pose', { yaw: +pose.yaw.toFixed(3), pitch: +pose.pitch.toFixed(3) }, true);
}, 110);

const GESTURES = { 1: 'nod', 2: 'shake', 3: 'shrug', 4: 'point', 5: 'raise', 6: 'facepalm', 7: 'laugh', 8: 'think' };
const GESTURE_TEXT = { nod: '👍 Ты киваешь', shake: '🙅 Ты мотаешь головой', shrug: '🤷 Ты разводишь руками', point: '👉 Ты показываешь', raise: '✋ Ты поднимаешь руку', facepalm: '🤦 Фейспалм', laugh: '😂 Ты ржёшь', think: '🤔 Ты задумался' };
window.addEventListener('keydown', (e) => {
  if (!S || S.phase === 'lobby') return;
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') { $('#hud').classList.toggle('hidden-panels'); return; }
  if (e.key === 'Enter') { $('#chatInput').focus(); e.preventDefault(); return; }
  const g = GESTURES[e.key];
  if (!g || S.me.exiled) return;
  if (scene) scene.gesture(S.me.id, g);
  toast(GESTURE_TEXT[g]);
  api('gesture', { g }, true);
});

// ---------- запуск ----------
(async function boot() {
  const savedName = store.get('bunker.name');
  if (savedName) $('#name').value = savedName;
  const room = new URLSearchParams(location.search).get('room');
  if (room) $('#codeInput').value = room.toUpperCase();

  try {
    const m = await import('./scene.js');
    scene = new m.Scene3D($('#scene'));
    scene.onLook = (yaw, pitch) => { pose = { yaw, pitch }; };
    if (S) scene.setPlayers(S, S.me.id);
  } catch (err) {
    console.warn('3D не загрузилось:', err);
    $('#scene').classList.add('no3d');
    toast('3D не загрузилось, но играть можно', 'err');
  }

  const saved = store.get('bunker.session');
  if (saved && room && saved.code === room.toUpperCase()) { session = saved; connect(); }
  else if (!savedName) $('#name').focus();
})();
