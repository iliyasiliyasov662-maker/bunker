// Вся логика игры «Бункер». Хранится на сервере, клиенты видят только то, что им положено.
const C = require('./cards');

const ROUNDS = 5;
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const KEYS = ['profession', 'bio', 'health', 'hobby', 'phobia', 'baggage', 'fact', 'minus'];
const LABEL = {
  profession: 'Профессия', bio: 'Биология', health: 'Здоровье', hobby: 'Хобби',
  phobia: 'Фобия', baggage: 'Багаж', fact: 'Факт', minus: 'Минус',
};
const COLORS = ['#e8553f', '#3fa7e8', '#f2c230', '#5cc96b', '#b06be8', '#e86bb0', '#4fd1c5', '#f28c38'];
const BAD_TAGS = {
  danger: 'опас{ен|на} для окружающих', thief: 'ворует запасы', glutton: 'съедает всё подряд',
  conflict: 'устраивает конфликты', lazy: 'бездельничает', terminal: 'смертельно бол{ен|ьна}',
  dying: 'тяжело бол{ен|ьна}', contagious: 'зараз{ен|на}',
};
const SKILL_NAMES = {
  med: 'медицина', food: 'еда', water: 'вода', repair: 'ремонт', electric: 'электрика',
  defense: 'оборона', science: 'наука', morale: 'боевой дух', leader: 'лидерство', tech: 'техника и связь',
  build: 'стройка', hunt: 'выживание', chem: 'химия', rescue: 'спасение', lang: 'языки',
  nav: 'ориентирование и поиск дороги', farm: 'земледелие', teach: 'учительство',
};

// ---------- утилиты ----------
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function gend(text, female) {
  if (!text) return text;
  return text.replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, m, f) => (female ? f : m));
}
function yearsWord(n) {
  const a = n % 100, b = n % 10;
  if (a >= 11 && a <= 14) return 'лет';
  if (b === 1) return 'год';
  if (b >= 2 && b <= 4) return 'года';
  return 'лет';
}
function token() { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
function combinations(arr, k) {
  const out = [];
  const go = (start, cur) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); go(i + 1, cur); cur.pop(); }
  };
  go(0, []);
  return out;
}
function namesList(ps) {
  const n = ps.map((p) => p.name);
  if (n.length <= 1) return n.join('');
  return n.slice(0, -1).join(', ') + ' и ' + n[n.length - 1];
}

class Deck {
  constructor(cards) { this.cards = shuffle(cards.slice()); this.i = 0; }
  draw() {
    if (this.i >= this.cards.length) { shuffle(this.cards); this.i = 0; }
    return this.cards[this.i++];
  }
}

// ---------- комната ----------
function createRoom(code) {
  return {
    code, players: [], hostId: null, phase: 'lobby',
    settings: { adult: false, outsiders: true },
    round: 0, order: [], turn: 0, turnRevealed: false,
    votes: {}, revote: null, lastVote: null, voteRounds: [],
    log: [], catastrophe: null, bunker: null, threats: [], supplyBonus: [],
    epilogue: null, capacity: 0, decks: null, created: Date.now(), touched: Date.now(),
  };
}

function addLog(room, k, t) {
  room.log.push({ k, t, at: Date.now() });
  if (room.log.length > 150) room.log.splice(0, room.log.length - 150);
}

function addPlayer(room, name) {
  if (room.phase !== 'lobby') return { error: 'Игра уже идёт, подожди следующую.' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'Комната заполнена.' };
  name = String(name || '').trim().slice(0, 18) || 'Игрок';
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name += ' ' + (room.players.length + 1);
  const used = new Set(room.players.map((p) => p.color));
  const p = {
    id: 'p' + token().slice(0, 8), token: token(), name,
    color: COLORS.find((c) => !used.has(c)) || pick(COLORS),
    connected: false, exiled: false, cards: {}, revealed: {}, female: false, age: 0,
    trump: null, actions: [], muted: false, double: false, immune: false, notes: [],
    yaw: 0, pitch: 0,
  };
  room.players.push(p);
  if (!room.hostId) room.hostId = p.id;
  addLog(room, 'sys', `${p.name} заходит в комнату.`);
  return { player: p };
}

function removePlayer(room, id) {
  const i = room.players.findIndex((p) => p.id === id);
  if (i < 0) return;
  const [p] = room.players.splice(i, 1);
  addLog(room, 'sys', `${p.name} выходит.`);
  if (room.hostId === id) room.hostId = room.players[0] ? room.players[0].id : null;
}

const alive = (room) => room.players.filter((p) => !p.exiled);
const byId = (room, id) => room.players.find((p) => p.id === id);
const hiddenKeys = (p) => KEYS.filter((k) => !p.revealed[k]);

// ---------- раздача ----------
function makeBio() {
  const female = Math.random() < 0.5;
  const age = 18 + Math.floor(Math.pow(Math.random(), 1.35) * 64);
  let t = `${female ? 'Женщина' : 'Мужчина'}, ${age} ${yearsWord(age)}`;
  const tags = [female ? 'female' : 'male'];
  if (female && age <= 42 && Math.random() < 0.12) { t += ', беременна (4 месяц)'; tags.push('pregnant'); }
  return { female, age, card: { t, b: 'bio', tags, e: null } };
}

function dealCard(c, female) {
  return { t: gend(c.t, female), b: c.t, tags: c.tags.slice(), e: c.e ? gend(c.e, female) : null };
}

function startGame(room) {
  const n = room.players.length;
  const adult = room.settings.adult;
  const deckOf = (key) => new Deck(C[key].concat(adult && C.adult[key] ? C.adult[key] : []));
  room.decks = {};
  for (const k of ['profession', 'health', 'hobby', 'phobia', 'baggage', 'fact', 'minus']) room.decks[k] = deckOf(k);
  room.decks.supplies = new Deck(C.supplies);
  const trumpDeck = new Deck(C.trumps);

  // катастрофа и бункер
  const cat = pick(C.catastrophes);
  const foodYears = 1 + rnd(cat.years + 1);
  room.catastrophe = { name: cat.name, text: cat.text, years: cat.years };
  room.bunker = {
    size: 40 + rnd(17) * 10,
    food: foodYears,
    features: shuffle(C.bunkerFeatures.slice()).slice(0, 3).map((f) => ({ ...f, broken: false })),
  };
  const pool = shuffle(cat.pool.slice());
  const others = shuffle(Object.keys(C.threats).filter((id) => !cat.pool.includes(id)));
  const ids = [pool[0], pool[1], others[0]];
  room.threats = shuffle(ids).map((id) => ({ id, known: false }));
  if (foodYears < cat.years && !ids.includes('food')) room.threats.push({ id: 'food', known: true, shortage: true });
  else if (foodYears < cat.years) room.threats.find((t) => t.id === 'food').known = true;

  // игроки
  for (const p of room.players) {
    const bio = makeBio();
    p.female = bio.female; p.age = bio.age;
    p.exiled = false; p.revealed = {}; p.notes = []; p.muted = false; p.double = false; p.immune = false;
    p.tomatoes = 0;
    p.cards = { bio: bio.card };
    for (const k of ['profession', 'health', 'hobby', 'phobia', 'baggage', 'fact', 'minus']) {
      const c = room.decks[k].draw();
      p.cards[k] = dealCard(c, p.female);
    }
    p.trump = { ...trumpDeck.draw(), used: false };
    p.actions = [];
    p.exiledRound = 0;
  }

  // специально раздаём несколько скрытых связок между разными игроками
  room.planted = [];
  const want = n >= 4 ? 3 : n >= 2 ? n - 1 : 0;
  const busy = new Set();
  for (const combo of shuffle(C.combos.slice())) {
    if (room.planted.length >= want) break;
    const [[c1, t1], [c2, t2]] = combo.parts;
    const ps = shuffle(room.players.slice());
    const a = ps.find((p) => !busy.has(p.id + c1));
    const b = ps.find((p) => p !== a && !busy.has(p.id + c2));
    if (!a || !b) continue;
    a.cards[c1] = dealCard(C[c1].find((x) => x.t === t1), a.female);
    b.cards[c2] = dealCard(C[c2].find((x) => x.t === t2), b.female);
    busy.add(a.id + c1); busy.add(b.id + c2);
    room.planted.push(combo.id);
  }
  for (const p of room.players) {
    const exp = Math.min(p.age - 18, rnd(Math.max(1, Math.floor((p.age - 16) * 0.8))));
    p.cards.profession.t += exp <= 0 ? ' (без стажа)' : ` (стаж ${exp} ${yearsWord(exp)})`;
  }

  // испытания после выхода — видны всем с самого начала
  const ap = shuffle((C.catastropheAfter[cat.name] || []).slice());
  const rest = shuffle(Object.keys(C.after).filter((x) => !ap.includes(x)));
  room.after = [ap[0], ap[1], rest[0]].filter(Boolean);

  room.capacity = Math.max(1, Math.ceil(n / 2));
  const kicks = n - room.capacity;
  const vr = new Set();
  for (let i = 0; i < kicks; i++) vr.add(Math.max(2, ROUNDS - Math.round((i * (ROUNDS - 1)) / kicks)));
  room.voteRounds = [...vr];
  room.votes = {}; room.revote = null; room.lastVote = null; room.epilogue = null; room.supplyBonus = [];
  room.log = [];
  addLog(room, 'big', `☢️ Катастрофа: ${cat.name}. ${cat.text}`);
  addLog(room, 'sys', `Бункер: ${room.bunker.size} м², еды на ${foodYears} ${yearsWord(foodYears)}, сидеть ${cat.years} ${yearsWord(cat.years)}. Мест: ${room.capacity} из ${n}.`);
  if (foodYears < cat.years) addLog(room, 'warn', '⚠️ Еды не хватит на весь срок, нужен кто-то, кто умеет её добывать или выращивать.');
  addLog(room, 'sys', `🎯 Цели: личная — попасть в бункер и дожить до выхода; общая — чтобы бункер выжил и отстроил новый мир. После выхода нужно будет: ${room.after.map((x) => C.after[x].name.toLowerCase()).join(', ')} и продолжить род.`);
  room.round = 0;
  if (kicks <= 0) { finish(room); return; }
  nextRound(room);
}

// ---------- ход игры ----------
function nextRound(room) {
  const a = alive(room);
  if (a.length <= room.capacity) { finish(room); return; }
  if (room.round >= ROUNDS) {
    // раунды кончились, а людей всё ещё много — дополнительное голосование
    addLog(room, 'warn', 'Раунды закончились, а мест всё ещё не хватает. Дополнительное голосование!');
    startVote(room);
    return;
  }
  room.round++;
  if (room.round === 3) {
    const t = room.threats.find((x) => !x.known);
    if (t) {
      t.known = true;
      addLog(room, 'radio', `📻 Радио сквозь помехи: в бункерах вроде вашего часто бывает «${C.threats[t.id].name}». Подумайте, кто с этим справится.`);
    }
  }
  const ids = a.map((p) => p.id);
  const shift = (room.round - 1) % ids.length;
  room.order = ids.slice(shift).concat(ids.slice(0, shift));
  room.turn = 0; room.turnRevealed = false;
  room.phase = 'reveal';
  const vote = room.voteRounds.includes(room.round);
  addLog(room, 'big', `Раунд ${room.round} из ${ROUNDS}.${room.round === 1 ? ' Все начинают с профессии.' : ''}${vote ? ' В конце раунда голосование!' : ''}`);
  skipEmptyTurns(room);
}

function currentSpeaker(room) {
  if (room.phase !== 'reveal') return null;
  return byId(room, room.order[room.turn]);
}

function skipEmptyTurns(room) {
  while (room.turn < room.order.length) {
    const p = byId(room, room.order[room.turn]);
    if (p && !p.exiled && hiddenKeys(p).length > 0) return;
    room.turn++;
  }
  room.phase = 'discuss';
  const vote = room.voteRounds.includes(room.round) || room.round >= ROUNDS;
  addLog(room, 'sys', vote ? 'Все высказались. Обсуждайте, а потом ведущий запускает голосование.' : 'Все высказались. Обсуждайте, потом ведущий начнёт следующий раунд.');
}

function revealCard(room, p, key, why) {
  if (!p.cards[key] || p.revealed[key]) return false;
  p.revealed[key] = true;
  addLog(room, 'reveal', `${why ? why + ' ' : ''}${p.name} · ${LABEL[key]}: ${p.cards[key].t}`);
  return true;
}

function endTurn(room) {
  room.turn++; room.turnRevealed = false;
  skipEmptyTurns(room);
}

function startVote(room, candidates = null) {
  room.phase = 'vote';
  room.votes = {};
  room.revote = candidates;
  if (candidates) addLog(room, 'warn', `Ничья! Переголосование между: ${candidates.map((id) => byId(room, id).name).join(', ')}.`);
  else addLog(room, 'big', '🗳️ Голосование! Выберите, кого выгнать из бункера.');
}

function tally(room) {
  const a = alive(room);
  const cand = room.revote || a.map((p) => p.id);
  const counts = {};
  cand.forEach((id) => (counts[id] = 0));
  const details = [];
  for (const p of a) {
    const v = room.votes[p.id];
    if (!v || !(v in counts)) continue;
    let w = p.double ? 2 : 1, note = p.double ? ' (×2)' : '';
    if (p.muted) { w = 0; note = ' (не услышан — шум снаружи)'; }
    const t = byId(room, v);
    if (t.immune) { w = 0; note = ' (иммунитет)'; }
    counts[v] += w;
    details.push(`${p.name} → ${t.name}${note}`);
  }
  for (const p of room.players) { p.muted = false; p.double = false; p.immune = false; }
  addLog(room, 'vote', 'Голоса: ' + (details.join('; ') || 'никто не проголосовал'));
  const max = Math.max(...Object.values(counts));
  let leaders = cand.filter((id) => counts[id] === max);
  if (leaders.length === 1) return exile(room, leaders[0], counts);
  if (!room.revote) { startVote(room, leaders); return; }
  const unlucky = pick(leaders);
  addLog(room, 'warn', 'Снова ничья. Решает жребий…');
  exile(room, unlucky, counts);
}

function exile(room, id, counts) {
  const p = byId(room, id);
  p.exiled = true;
  p.exiledRound = room.round;
  KEYS.forEach((k) => (p.revealed[k] = true));
  room.lastVote = { id, name: p.name, counts };
  room.revote = null; room.votes = {};
  addLog(room, 'exile', `🚪 ${p.name} ${p.female ? 'выгнана' : 'выгнан'} из бункера. Все карты открыты.`);
  if (room.settings.outsiders) {
    p.actions = shuffle(C.outsideActions.slice()).slice(0, 2).map((a) => ({ ...a, used: false }));
  }
  if (alive(room).length <= room.capacity) { finish(room); return; }
  room.phase = 'result';
}

// ---------- финал ----------
// Всё в финале вытекает из карт: никаких случайностей, исход можно просчитать заранее.
const PHYS = ['build', 'hunt', 'defense', 'farm', 'rescue'];
const FLAVOR_ORDER = ['minus', 'phobia', 'health', 'hobby', 'baggage', 'profession', 'fact'];

function playerTags(p) {
  const s = new Set();
  const neg = [];
  for (const k of KEYS) for (const t of p.cards[k].tags) (t.startsWith('-') ? neg.push(t.slice(1)) : s.add(t));
  neg.forEach((t) => s.delete(t));
  return s;
}

function supplyTags(room) {
  const list = [];
  for (const f of room.bunker.features) if (!f.broken) f.tags.forEach((t) => list.push({ t, src: f.t }));
  for (const s of room.supplyBonus) s.tags.forEach((t) => list.push({ t, src: s.t }));
  return list;
}

function cardWith(p, tag) {
  for (const k of KEYS) if (p.cards[k].tags.includes(tag)) return `${LABEL[k].toLowerCase()} «${p.cards[k].t}»`;
  return '';
}

const gv = (p, s) => gend(s, p.female);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// связки, обе части которых есть у двух разных людей из списка
function combosOf(members) {
  const res = [];
  for (const c of C.combos) {
    const [h1, h2] = c.parts.map(([cat, text]) => members.filter((p) => p.cards[cat] && p.cards[cat].b === text));
    let pair = null;
    for (const a of h1) for (const b of h2) if (!pair && a !== b) pair = [a, b];
    if (pair) res.push({ combo: c, who: pair });
  }
  return res;
}

// кто решает задачу: человек, связка или оборудование бункера
function solve(needs, people, tagsOf, combos, sup) {
  const savers = people.filter((p) => needs.some((n) => tagsOf(p).has(n)));
  if (savers.length) return { kind: 'person', savers, tag: (p) => needs.find((n) => tagsOf(p).has(n)) };
  const cb = combos.find((x) => needs.some((n) => x.combo.gives.includes(n)));
  if (cb) return { kind: 'combo', cb };
  const s = sup && needs.map((n) => sup.find((x) => x.t === n)).find(Boolean);
  if (s) return { kind: 'sup', src: s.src };
  return null;
}

function evaluate(room, ids) {
  const members = ids.map((id) => byId(room, id));
  const outside = room.players.filter((p) => !ids.includes(p.id));
  const tagMap = new Map(members.map((p) => [p.id, playerTags(p)]));
  const has = (p, t) => tagMap.get(p.id).has(t);
  const sup = supplyTags(room);
  const supHas = (t) => sup.some((x) => x.t === t);
  const per = {};
  members.forEach((p) => (per[p.id] = { s1: [], s2: [], notes: [], bad: [], died: null, combos: [] }));
  const s1 = [], s2 = [];

  // 1. болезни: кто доживёт до выхода
  const combos0 = combosOf(members);
  const dead = new Set();
  for (const p of members) {
    const h = p.cards.health.t;
    if (has(p, 'terminal')) {
      dead.add(p.id);
      per[p.id].died = gv(p, `Не дожил{|а} до выхода: «${h}» не лечится.`);
    } else if (has(p, 'dying')) {
      const medic = members.find((m) => m !== p && has(m, 'med'));
      const cm = combos0.find((x) => !x.who.includes(p) && x.combo.gives.includes('med'));
      if (medic) { per[p.id].notes.push(`«${h}» — болезнь тяжёлая, но ${medic.name} ${gv(medic, 'держал{|а}')} её под контролем.`); per[medic.id].s1.push('лечение больных'); }
      else if (cm) per[p.id].notes.push(`«${h}» — болезнь тяжёлая, но выручила связка «${cm.combo.name}».`);
      else if (supHas('med')) per[p.id].notes.push(gv(p, `«${h}» — болезнь тяжёлая, но ${p.female ? 'её' : 'его'} вытащили лекарства из медпункта бункера.`));
      else { dead.add(p.id); per[p.id].died = gv(p, `Не пережил{|а} первый год: «${h}», а медика в бункере не было.`); }
    }
  }
  const living = members.filter((p) => !dead.has(p.id));
  const combos = combosOf(living);
  combos.forEach((x) => x.who.forEach((p) => per[p.id].combos.push(x)));
  const anyHas = (t, except) => living.some((p) => p !== except && has(p, t)) || combos.some((x) => !x.who.includes(except) && x.combo.gives.includes(t));

  // 2. заразные
  let incidents = 0;
  const sick = living.filter((p) => has(p, 'contagious'));
  if (sick.length) {
    const cure = anyHas('med') || supHas('med');
    for (const p of sick) {
      if (cure) per[p.id].notes.push(gv(p, `«${p.cards.health.t}» — заразно, но в бункере было чем лечить, и болезнь не разошлась.`));
      else per[p.id].bad.push(gv(p, `«${p.cards.health.t}» — заразно, а лечить было нечем: полгода весь бункер лежал пластом.`));
    }
    if (!cure) { incidents += 2; s1.push(`🦠 ${namesList(sick)} принесли в бункер заразу, а лечить было нечем.`); }
  }

  // 3. угрозы внутри бункера
  let s1solved = 0, s1failed = 0;
  const failed = [];
  const tags1 = (p) => tagMap.get(p.id);
  for (const th of room.threats) {
    const T = C.threats[th.id];
    const r = solve(T.needs, living, tags1, combos, sup);
    if (r && r.kind === 'person') {
      s1solved++;
      const p = r.savers[0];
      r.savers.forEach((x) => per[x.id].s1.push(`«${T.name}» (${cardWith(x, r.tag(x))})`));
      s1.push('✅ ' + cap(gend(T.win, p.female).replace('{who}', p.name)));
    } else if (r && r.kind === 'combo') {
      s1solved++;
      r.cb.who.forEach((x) => per[x.id].s1.push(`«${T.name}» (связка «${r.cb.combo.name}»)`));
      s1.push(`✅ «${T.name}» — выручила связка «${r.cb.combo.name}»: ${namesList(r.cb.who)}.`);
    } else if (r) {
      s1solved++;
      s1.push(`✅ «${T.name}» — выручило оборудование бункера: «${r.src}».`);
    } else {
      s1failed++; failed.push({ stage: 1, id: th.id, name: T.name, needs: T.needs });
      let line = `❌ «${T.name}». ${T.lose}`;
      const could = outside.find((p) => T.needs.some((n) => playerTags(p).has(n)));
      if (could) line += ` Спас бы ${could.name} (${cardWith(could, T.needs.find((n) => playerTags(could).has(n)))}), но ${could.female ? 'её' : 'его'} выгнали.`;
      s1.push(line);
    }
  }

  // 4. плохие черты из карт
  const cardOf = (p, t) => { for (const k of KEYS) if (p.cards[k].tags.includes(t)) return p.cards[k].t; return ''; };
  for (const p of living) {
    const keeper = (tagsList) => living.find((m) => m !== p && tagsList.some((t) => has(m, t)));
    const rules = [
      ['danger', ['defense', 'leader'], (k) => `«${cardOf(p, 'danger')}» — ${k.name} ${gv(k, 'держал{|а}')} ${p.female ? 'её' : 'его'} в узде.`, `«${cardOf(p, 'danger')}» — остановить ${p.female ? 'её' : 'его'} было некому, в бункере были драки.`],
      ['thief', ['leader', 'defense'], (k) => gv(p, `«${cardOf(p, 'thief')}» — таскал{|а} запасы, но ${k.name} быстро ${gv(k, 'вычислил{|а}')} вора.`), gv(p, `«${cardOf(p, 'thief')}» — тихо таскал{|а} запасы, и склад опустел раньше срока.`)],
      ['glutton', ['food', 'farm'], () => gv(p, `«${cardOf(p, 'glutton')}» — ел{|а} за троих, но еды хватало.`), gv(p, `«${cardOf(p, 'glutton')}» — съедал{|а} больше всех, а пополнять запасы было некому.`)],
      ['conflict', ['morale', 'leader'], (k) => gv(p, `«${cardOf(p, 'conflict')}» — ругал{ся|ась} со всеми, но ${k.name} ${gv(k, 'гасил{|а}')} ссоры.`), gv(p, `«${cardOf(p, 'conflict')}» — перессорил{|а} весь бункер, мирить было некому.`)],
    ];
    for (const [tag, fix, ok, bad] of rules) {
      if (!has(p, tag)) continue;
      const k = keeper(fix) || (combos.find((x) => !x.who.includes(p) && fix.some((t) => x.combo.gives.includes(t))) ? { name: 'связка', female: true } : null)
        || (tag === 'glutton' && supHas('food') ? { name: 'склад', female: false } : null);
      if (k) per[p.id].notes.push(ok(k));
      else { incidents++; per[p.id].bad.push(bad); }
    }
    if (has(p, 'lazy')) per[p.id].notes.push(gv(p, `«${cardOf(p, 'lazy')}» — работал{|а} меньше всех, но вреда от этого не было.`));
  }
  // фобии, которые перечеркнули навык
  for (const p of members) {
    const neg = p.cards.phobia.tags.filter((t) => t.startsWith('-')).map((t) => t.slice(1));
    for (const t of neg) {
      const src = KEYS.find((k) => k !== 'phobia' && p.cards[k].tags.includes(t));
      if (src) per[p.id].notes.push(`«${p.cards.phobia.t}» перечеркнула навык: ${SKILL_NAMES[t]} (${LABEL[src].toLowerCase()} «${p.cards[src].t}») не пригодилась.`);
    }
  }

  // 5. после выхода: только люди и связки, оборудование бункера с собой не унесёшь
  const medOut = living.some((p) => has(p, 'med')) || combos.some((x) => x.combo.gives.includes('med'));
  const tags2map = new Map();
  for (const p of living) {
    const t = new Set(tagMap.get(p.id));
    const elder = p.age >= 65;
    const weak = t.has('weak') && !medOut;
    if (elder || weak) {
      const lost = PHYS.filter((x) => t.has(x));
      PHYS.forEach((x) => t.delete(x));
      if (elder) per[p.id].notes.push(gv(p, `В ${p.age} ${yearsWord(p.age)} тяжёлую работу на поверхности уже не тянул{|а}${lost.length ? ' — ' + lost.map((x) => SKILL_NAMES[x]).join(', ') + ' после выхода не в счёт' : ''}.`));
      else per[p.id].notes.push(gv(p, `«${p.cards.health.t}» — без медика после выхода быстро ослаб{|ла}${lost.length ? ' и не мог{|ла} работать руками' : ''}.`));
    }
    tags2map.set(p.id, t);
  }
  let s2solved = 0, s2failed = 0;
  for (const id of room.after) {
    const A = C.after[id];
    const r = solve(A.needs, living, (p) => tags2map.get(p.id), combos, null);
    if (r && r.kind === 'person') {
      s2solved++;
      const p = r.savers[0];
      r.savers.forEach((x) => per[x.id].s2.push(`«${A.name}» (${cardWith(x, r.tag(x))})`));
      s2.push('✅ ' + cap(gend(A.win, p.female).replace('{who}', p.name)));
    } else if (r) {
      s2solved++;
      r.cb.who.forEach((x) => per[x.id].s2.push(`«${A.name}» (связка «${r.cb.combo.name}»)`));
      s2.push(`✅ «${A.name}» — выручила связка «${r.cb.combo.name}»: ${namesList(r.cb.who)}.`);
    } else {
      s2failed++; failed.push({ stage: 2, id, name: A.name, needs: A.needs });
      let line = `❌ «${A.name}». ${A.lose}`;
      const could = outside.find((p) => A.needs.some((n) => playerTags(p).has(n)));
      if (could) line += ` Справил${could.female ? 'ась' : 'ся'} бы ${could.name} (${cardWith(could, A.needs.find((n) => playerTags(could).has(n)))}).`;
      s2.push(line);
    }
  }
  // продолжение рода
  const fertile = (p) => !has(p, 'infertile') && (p.female ? p.age <= 45 : p.age <= 65);
  const pregnant = living.find((p) => has(p, 'pregnant'));
  const men = living.filter((p) => !p.female && fertile(p)), women = living.filter((p) => p.female && fertile(p));
  const pop = !!pregnant || (men.length > 0 && women.length > 0);
  if (!living.length) s2.push('❌ Выходить на поверхность было некому.');
  else if (pregnant) s2.push(`✅ Продолжить род: ${pregnant.name} пришла в бункер беременной, и в новом мире родился первый ребёнок.`);
  else if (pop) s2.push(`✅ Продолжить род: среди выживших есть и мужчины, и женщины подходящего возраста — у человечества будет будущее.`);
  else {
    const why = !men.length && !women.length ? 'нет никого подходящего возраста и здоровья' : !men.length ? 'не осталось мужчин подходящего возраста' : 'не осталось женщин подходящего возраста';
    s2.push(`❌ Продолжить род некому: ${why}. Вы последние.`);
    failed.push({ stage: 2, id: 'kids', name: 'Продолжить род', needs: [] });
  }

  const s2f = s2failed + (pop ? 0 : 1);
  const score = s1solved * 3 - s1failed * 3 - incidents - dead.size * 1.5 + s2solved * 2 - s2failed * 2 + (pop ? 3 : -3);
  const total = s1failed + s2f + (incidents >= 2 ? 1 : 0);
  let verdict;
  if (!living.length) verdict = { kind: 'doom', title: 'Бункер опустел', text: 'До выхода на поверхность не дожил никто.' };
  else if (s1failed >= 2) verdict = { kind: 'doom', title: 'Бункер погиб', text: 'Внутри случилось слишком много бед, с которыми было некому справиться.' };
  else if (total === 0) verdict = { kind: 'win', title: 'Человечество спасено!', text: 'Пережили бункер и отстроили новый мир.' };
  else if (total === 1) verdict = { kind: 'win', title: 'Выжили и отстроились', text: 'Не без потерь, но у человечества есть будущее.' };
  else if (s2f >= 2) verdict = { kind: 'loss', title: 'Бункер пережили, а новый мир — нет', text: 'Внутри справились, но после выхода оказались беспомощны.' };
  else verdict = { kind: 'loss', title: 'Выжили, но с тяжёлыми потерями', text: 'Слишком многое пошло не так.' };

  return { score, verdict, s1, s2, per, dead, living, combos, failed, s1failed, s2failed: s2f, incidents, pop };
}

function finish(room) {
  room.phase = 'epilogue';
  const kept = alive(room).map((p) => p.id);
  const A = evaluate(room, kept);
  const cat = room.catastrophe;
  const teamWin = A.verdict.kind === 'win';

  const intro = [`🚪 Гермодверь закрылась. Внутри: ${namesList(alive(room)) || 'никого'}. Снаружи — ${cat.name.toLowerCase()}. Сидеть ${cat.years} ${yearsWord(cat.years)}.`];
  const hidden = room.threats.filter((t) => !t.known).map((t) => C.threats[t.id].name);
  if (hidden.length) intro.push(`🔍 Скрытые проблемы бункера были: ${hidden.join(', ')}.`);
  const sections = [
    { title: `В бункере, ${cat.years} ${yearsWord(cat.years)}`, lines: A.s1 },
    { title: 'После выхода', lines: A.s2 },
  ];

  // связки
  const all = combosOf(room.players);
  const combos = all.map((x) => {
    const names = namesList(x.who);
    const out = x.who.filter((p) => p.exiled);
    const died = x.who.filter((p) => A.dead.has(p.id));
    let status, note;
    if (out.length) { status = 'broken'; note = `Развалили: ${namesList(out)} — выгнали.`; }
    else if (died.length) { status = 'lost'; note = `Не сработала: ${namesList(died)} не ${died.length > 1 ? 'дожили' : gv(died[0], 'дожил{|а}')}.`; }
    else { status = 'worked'; note = x.combo.text; }
    return { name: x.combo.name, who: names, status, note, planted: room.planted.includes(x.combo.id) };
  });

  // история каждого игрока
  const people = room.players.map((p) => {
    const inside = kept.includes(p.id);
    const head = `${p.cards.profession.t} · ${p.cards.bio.t}`;
    const text = [];
    let personal;
    if (inside) {
      const r = A.per[p.id];
      personal = !r.died;
      if (r.died) text.push(r.died);
      if (r.s1.length) text.push(gv(p, `В бункере выручил{|а}: ${r.s1.join(', ')}.`));
      if (r.s2.length) text.push(gv(p, `После выхода пригодил{ся|ась}: ${r.s2.join(', ')}.`));
      for (const x of r.combos) {
        const other = x.who.find((o) => o !== p);
        text.push(`🔗 Связка «${x.combo.name}» (в паре: ${other.name}). ${x.combo.text}`);
      }
      text.push(...r.notes);
      text.push(...r.bad);
      if (!r.died && !r.s1.length && !r.s2.length && !r.combos.length) text.push(gv(p, `Из того, что понадобилось бункеру, ${p.female ? 'она' : 'он'} ничего не умел{|а}.`));
      const fk = FLAVOR_ORDER.find((k) => p.cards[k].e);
      if (fk) text.push('💬 ' + p.cards[fk].e.replace(/\{name\}/g, p.name));
    } else {
      personal = false;
      text.push(gv(p, `Выгнан{|а} в ${p.exiledRound || '?'}-м раунде.`));
      const t = playerTags(p);
      const skills = [...t].filter((x) => SKILL_NAMES[x]).map((x) => SKILL_NAMES[x]);
      const missed = A.failed.filter((f) => f.needs.some((n) => t.has(n)));
      if (missed.length) text.push(`Как раз ${p.female ? 'её' : 'его'} и не хватило: ${missed.map((f) => `«${f.name}» (${cardWith(p, f.needs.find((n) => t.has(n)))})`).join(', ')}.`);
      const broken = all.filter((x) => x.who.includes(p));
      for (const x of broken) {
        const other = x.who.find((o) => o !== p);
        text.push(`🔗 Мог${p.female ? 'ла' : ''} бы собрать связку «${x.combo.name}» (в паре: ${other.name}).`);
      }
      if (!missed.length && !broken.length) text.push(skills.length ? `Умел${p.female ? 'а' : ''}: ${skills.join(', ')}, но это бункер закрыл и без ${p.female ? 'неё' : 'него'}.` : `Бункер без ${p.female ? 'неё' : 'него'} ничего не потерял.`);
      const bads = Object.keys(BAD_TAGS).filter((k) => t.has(k));
      if (bads.length) text.push(`Зато в бункере ${p.female ? 'она' : 'он'} ${bads.map((k) => gend(BAD_TAGS[k], p.female)).join(', ')}.`);
    }
    return { id: p.id, name: p.name, color: p.color, inside, head, text, personal, team: teamWin, tomatoes: p.tomatoes || 0 };
  });

  // идеальный состав
  const ids = room.players.map((p) => p.id);
  let best = null;
  for (const combo of combinations(ids, kept.length)) {
    const ev = evaluate(room, combo);
    const overlap = combo.filter((id) => kept.includes(id)).length;
    if (!best || ev.score > best.ev.score + 1e-9 || (Math.abs(ev.score - best.ev.score) < 1e-9 && overlap > best.overlap)) best = { combo, ev, overlap };
  }
  const perfect = A.score >= best.ev.score - 1e-9;
  if (perfect) best = { combo: kept, ev: A, overlap: kept.length };
  const verdicts = room.players.map((p) => {
    const inBest = best.combo.includes(p.id), wasKept = kept.includes(p.id);
    const ok = inBest === wasKept;
    let label, reason;
    if (wasKept && ok) {
      label = '✅ Правильно оставили';
      const r = A.per[p.id];
      const got = r.s1.concat(r.s2);
      reason = got.length ? `Пригодил${p.female ? 'ась' : 'ся'}: ${got.slice(0, 3).join(', ')}.` : A.pop ? 'Особых навыков нет, но был нужен для продолжения рода.' : 'Особой пользы не было, но и лучшей замены тоже.';
    } else if (!wasKept && ok) {
      label = '✅ Правильно выгнали';
      const t = playerTags(p);
      const b = Object.keys(BAD_TAGS).filter((k) => t.has(k)).map((k) => gend(BAD_TAGS[k], p.female));
      reason = b.length ? `В бункере ${p.female ? 'она' : 'он'} ${b.join(', ')}.` : 'Ничего такого, чего не умели бы остальные.';
    } else if (!wasKept) {
      label = '❌ Зря выгнали';
      const r = best.ev.per[p.id];
      const got = r ? r.s1.concat(r.s2) : [];
      reason = got.length ? `С ${p.female ? 'ней' : 'ним'} закрыли бы: ${got.slice(0, 3).join(', ')}.` : `С ${p.female ? 'ней' : 'ним'} состав был бы надёжнее.`;
    } else {
      label = '❌ Зря оставили';
      const r = A.per[p.id];
      const b = [];
      if (r.died) b.push(gv(p, 'не дожил{|а} до выхода'));
      if (r.bad.length) b.push(gv(p, 'создавал{|а} проблемы'));
      if (!r.s1.length && !r.s2.length) b.push(gv(p, 'ничем не помог{|ла}'));
      const instead = best.combo.filter((id) => !kept.includes(id)).map((id) => byId(room, id));
      const verb = instead.length > 1 ? 'дали бы' : instead[0] && instead[0].female ? 'дала бы' : 'дал бы';
      reason = b.length ? cap(b.join(', ') + '.') : `Польза была, но ${namesList(instead)} ${verb} бункеру больше.`;
    }
    return { id: p.id, name: p.name, color: p.color, ok, label, reason };
  });

  const extra = [];
  const shooter = room.players.slice().sort((x, y) => (y.tomatoes || 0) - (x.tomatoes || 0))[0];
  if (shooter && shooter.tomatoes) extra.push(`🍅 Главная мишень бункера: ${shooter.name}, ${shooter.tomatoes} ${shooter.tomatoes % 10 === 1 && shooter.tomatoes % 100 !== 11 ? 'помидор' : [2, 3, 4].includes(shooter.tomatoes % 10) && ![12, 13, 14].includes(shooter.tomatoes % 100) ? 'помидора' : 'помидоров'} в противогаз.`);

  room.epilogue = {
    verdict: A.verdict, intro, sections, people, combos, extra,
    analysis: {
      perfect, matched: kept.filter((id) => best.combo.includes(id)).length, capacity: kept.length,
      bestNames: best.combo.map((id) => byId(room, id).name), bestVerdict: best.ev.verdict,
      hopeless: best.ev.verdict.kind === 'doom', players: verdicts,
    },
  };
  addLog(room, 'big', `🏁 Игра окончена: ${A.verdict.title}`);
}

// ---------- действия игроков ----------
function handle(room, p, msg) {
  const isHost = room.hostId === p.id;
  const type = msg.type;
  const target = msg.target ? byId(room, msg.target) : null;

  switch (type) {
    case 'settings': {
      if (!isHost || room.phase !== 'lobby') return { error: 'Настройки меняет только ведущий в лобби.' };
      if (typeof msg.adult === 'boolean') room.settings.adult = msg.adult;
      if (typeof msg.outsiders === 'boolean') room.settings.outsiders = msg.outsiders;
      return {};
    }
    case 'start': {
      if (!isHost) return { error: 'Начать может только ведущий.' };
      if (room.phase !== 'lobby') return { error: 'Игра уже идёт.' };
      if (room.players.length < MIN_PLAYERS) return { error: `Нужно хотя бы ${MIN_PLAYERS} игрока.` };
      startGame(room);
      return {};
    }
    case 'reveal': {
      const sp = currentSpeaker(room);
      if (!sp || sp.id !== p.id) return { error: 'Сейчас не твой ход.' };
      if (room.turnRevealed) return { error: 'Ты уже открыл карту в этом ходу. Нажми «Закончить ход».' };
      if (!KEYS.includes(msg.key) || p.revealed[msg.key]) return { error: 'Эту карту открыть нельзя.' };
      if (room.round === 1 && msg.key !== 'profession' && !p.revealed.profession) return { error: 'В первом раунде все открывают профессию.' };
      revealCard(room, p, msg.key);
      room.turnRevealed = true;
      return {};
    }
    case 'endTurn': {
      const sp = currentSpeaker(room);
      if (!sp || sp.id !== p.id) return { error: 'Сейчас не твой ход.' };
      if (!room.turnRevealed && hiddenKeys(p).length) return { error: 'Сначала открой одну карту.' };
      endTurn(room);
      return {};
    }
    case 'skipTurn': {
      if (!isHost) return { error: 'Только ведущий.' };
      const sp = currentSpeaker(room);
      if (!sp) return { error: 'Сейчас никто не ходит.' };
      if (!room.turnRevealed) {
        const h = hiddenKeys(sp);
        const key = room.round === 1 && h.includes('profession') ? 'profession' : pick(h);
        if (key) revealCard(room, sp, key, '⏩ Ход пропущен, карта открыта автоматически.');
      }
      endTurn(room);
      return {};
    }
    case 'toVote': {
      if (!isHost) return { error: 'Только ведущий.' };
      if (room.phase !== 'discuss') return { error: 'Сейчас нельзя.' };
      if (!room.voteRounds.includes(room.round) && room.round < ROUNDS) return { error: 'В этом раунде голосования нет.' };
      startVote(room);
      return {};
    }
    case 'nextRound': {
      if (!isHost) return { error: 'Только ведущий.' };
      if (room.phase === 'discuss' && room.voteRounds.includes(room.round)) return { error: 'Сначала голосование.' };
      if (room.phase !== 'discuss' && room.phase !== 'result') return { error: 'Сейчас нельзя.' };
      nextRound(room);
      return {};
    }
    case 'vote': {
      if (room.phase !== 'vote') return { error: 'Сейчас не голосование.' };
      if (p.exiled) return { error: 'Выгнанные не голосуют.' };
      if (!target || target.exiled || target.id === p.id) return { error: 'За этого игрока голосовать нельзя.' };
      if (room.revote && !room.revote.includes(target.id)) return { error: 'В переголосовании можно выбрать только тех, у кого ничья.' };
      room.votes[p.id] = target.id;
      if (alive(room).every((x) => room.votes[x.id])) tally(room);
      return {};
    }
    case 'fx': {
      if (!target || target.id === p.id || target.exiled) return { error: 'Посмотри на игрока за столом.' };
      const now = Date.now();
      if (now - (p.lastFx || 0) < 900) return { error: 'Не так быстро!' };
      if (msg.kind === 'throw') {
        p.lastFx = now;
        target.tomatoes = (target.tomatoes || 0) + 1;
        addLog(room, 'fx', `🍅 ${p.name}${p.exiled ? ' (из вентиляции)' : ''} → ${target.name}: помидор прямо в противогаз!`);
        return { fx: { kind: 'throw', from: p.id, to: target.id } };
      }
      if (msg.kind === 'slap') {
        if (p.exiled) return { error: 'Из вентиляции не дотянуться.' };
        const n = room.players.length;
        const i = room.players.indexOf(p), j = room.players.indexOf(target);
        const d = Math.abs(i - j);
        if (d !== 1 && d !== n - 1) return { error: 'Подзатыльник можно дать только соседу.' };
        p.lastFx = now;
        addLog(room, 'fx', `👋 ${p.name} → ${target.name}: подзатыльник!`);
        return { fx: { kind: 'slap', from: p.id, to: target.id } };
      }
      return { error: 'Неизвестное действие.' };
    }
    case 'closeVote': {
      if (!isHost || room.phase !== 'vote') return { error: 'Только ведущий во время голосования.' };
      tally(room);
      return {};
    }
    case 'trump': {
      if (p.exiled || !p.trump || p.trump.used) return { error: 'Козырь недоступен.' };
      if (!['reveal', 'discuss', 'vote', 'result'].includes(room.phase)) return { error: 'Сейчас нельзя.' };
      const tr = p.trump;
      if (tr.target && (!target || target.exiled || target.id === p.id)) return { error: 'Выбери игрока в бункере.' };
      switch (tr.id) {
        case 'immunity': p.immune = true; addLog(room, 'trump', `🛡️ ${p.name} достаёт козырь «Иммунитет»: голоса против ${p.female ? 'неё' : 'него'} в ближайшем голосовании не засчитаются.`); break;
        case 'double': p.double = true; addLog(room, 'trump', `✌️ ${p.name} достаёт козырь «Двойной голос».`); break;
        case 'peek': {
          const h = hiddenKeys(target);
          if (!h.length) return { error: 'У этого игрока всё открыто.' };
          const k = pick(h);
          p.notes.push(`👁️ ${target.name} · ${LABEL[k]}: ${target.cards[k].t}`);
          addLog(room, 'trump', `👁️ ${p.name} тайком подглядывает одну из карт игрока ${target.name}.`);
          break;
        }
        case 'expose': {
          const h = hiddenKeys(target);
          if (!h.length) return { error: 'У этого игрока всё открыто.' };
          revealCard(room, target, pick(h), `🔦 ${p.name} использует «Разоблачение»!`);
          break;
        }
        case 'heal':
          p.cards.health = { t: p.female ? 'Абсолютно здорова (чудесно исцелилась)' : 'Абсолютно здоров (чудесно исцелился)', b: 'heal', tags: ['healthy'], e: null };
          addLog(room, 'trump', `✨ ${p.name} чудесно исцеляется!${p.revealed.health ? ' Новое здоровье: ' + p.cards.health.t : ''}`);
          break;
        case 'reroll_baggage': {
          const c = room.decks.baggage.draw();
          p.cards.baggage = dealCard(c, p.female);
          addLog(room, 'trump', `🎒 ${p.name} меняет багаж.${p.revealed.baggage ? ' Теперь у ' + (p.female ? 'неё' : 'него') + ': ' + p.cards.baggage.t : ''}`);
          break;
        }
        case 'scout': {
          const t = room.threats.find((x) => !x.known) || room.threats[0];
          p.notes.push(`🔭 Разведка: в бункере будет проблема «${C.threats[t.id].name}».`);
          addLog(room, 'trump', `🔭 ${p.name} что-то разведал${p.female ? 'а' : ''} о бункере.`);
          break;
        }
      }
      tr.used = true;
      return {};
    }
    case 'outside': {
      if (!p.exiled) return { error: 'Это только для выгнанных.' };
      if (!['reveal', 'discuss', 'vote', 'result'].includes(room.phase)) return { error: 'Сейчас нельзя.' };
      const act = p.actions[msg.index];
      if (!act || act.used) return { error: 'Действие недоступно.' };
      if (act.target && (!target || target.exiled)) return { error: 'Выбери игрока в бункере.' };
      switch (act.id) {
        case 'expose': {
          const h = hiddenKeys(target);
          if (!h.length) return { error: 'У этого игрока всё открыто.' };
          revealCard(room, target, pick(h), '🌫️ Голос снаружи раскрывает секрет!');
          break;
        }
        case 'noise': target.muted = true; addLog(room, 'outside', '🌫️ Снаружи кто-то стучит по трубам. Чей-то голос в ближайшем голосовании не услышат.'); break;
        case 'hint': {
          const t = room.threats.find((x) => !x.known) || room.threats[0];
          target.notes.push(`🌫️ Шёпот из вентиляции: в бункере будет проблема «${C.threats[t.id].name}».`);
          addLog(room, 'outside', '🌫️ Кто-то шепчет в вентиляцию…');
          break;
        }
        case 'supplies': {
          const s = room.decks.supplies.draw();
          room.supplyBonus.push(s);
          addLog(room, 'outside', `🌫️ Из вентиляции что-то выпадает: «${s.t}». Это останется в бункере.`);
          break;
        }
        case 'rumor': {
          const t = String(msg.text || '').trim().slice(0, 160);
          if (!t) return { error: 'Напиши текст слуха.' };
          addLog(room, 'rumor', `🌫️ Анонимный слух: ${t}`);
          break;
        }
        case 'sabotage': {
          const f = room.bunker.features.filter((x) => !x.broken);
          if (!f.length) return { error: 'В бункере уже нечего ломать.' };
          const x = pick(f); x.broken = true;
          addLog(room, 'outside', `🌫️ Снаружи что-то грохнуло. Сломано: «${x.t}».`);
          break;
        }
      }
      act.used = true;
      return {};
    }
    case 'chat': {
      const t = String(msg.text || '').trim().slice(0, 300);
      if (!t) return { error: 'Пустое сообщение.' };
      room.log.push({ k: 'chat', t, who: p.name, color: p.color, at: Date.now() });
      if (room.log.length > 150) room.log.shift();
      return {};
    }
    case 'restart': {
      if (!isHost) return { error: 'Только ведущий.' };
      room.phase = 'lobby'; room.epilogue = null; room.round = 0; room.votes = {}; room.revote = null;
      for (const x of room.players) { x.exiled = false; x.revealed = {}; x.cards = {}; x.notes = []; x.actions = []; x.trump = null; }
      room.log = [];
      addLog(room, 'sys', 'Новая игра! Ждём, пока ведущий нажмёт «Начать».');
      return {};
    }
    case 'kick': {
      if (!isHost || room.phase !== 'lobby' || !target || target.id === p.id) return { error: 'Нельзя.' };
      removePlayer(room, target.id);
      return { kicked: target.id };
    }
    case 'leave': {
      if (room.phase !== 'lobby') return { error: 'Во время игры выйти нельзя, просто закрой вкладку.' };
      removePlayer(room, p.id);
      return { left: true };
    }
    default:
      return { error: 'Неизвестное действие.' };
  }
}

// ---------- что видит конкретный игрок ----------
function view(room, me) {
  const sp = currentSpeaker(room);
  const voteRound = room.voteRounds.includes(room.round) || room.round >= ROUNDS;
  const v = {
    code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS,
    hostId: room.hostId, settings: room.settings, capacity: room.capacity,
    voteRound, speaker: sp ? sp.id : null, turnRevealed: room.turnRevealed,
    revote: room.revote, lastVote: room.lastVote,
    players: room.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, connected: p.connected, exiled: p.exiled,
      revealed: Object.fromEntries(KEYS.filter((k) => p.revealed[k] && p.cards[k]).map((k) => [k, p.cards[k].t])),
      voted: room.phase === 'vote' ? !!room.votes[p.id] : false,
      trumpUsed: p.trump ? p.trump.used : false,
      yaw: p.yaw, pitch: p.pitch,
    })),
    catastrophe: room.catastrophe,
    bunker: room.bunker && {
      size: room.bunker.size, food: room.bunker.food,
      features: room.bunker.features.map((f) => ({ t: f.t, broken: f.broken })),
      supplies: room.supplyBonus.map((s) => s.t),
    },
    knownThreats: room.threats.filter((t) => t.known).map((t) => C.threats[t.id].name),
    after: (room.after || []).map((x) => C.after[x].name).concat(room.after ? ['Продолжить род'] : []),
    log: room.log.slice(-90),
    labels: LABEL, keys: KEYS,
    epilogue: room.epilogue,
  };
  if (me) {
    v.me = {
      id: me.id, name: me.name, isHost: room.hostId === me.id, exiled: me.exiled,
      cards: KEYS.filter((k) => me.cards[k]).map((k) => ({ key: k, label: LABEL[k], t: me.cards[k].t, revealed: !!me.revealed[k] })),
      trump: me.trump, actions: me.actions, notes: me.notes,
      vote: room.votes[me.id] || null,
    };
  }
  if (room.phase === 'epilogue') {
    v.allCards = room.players.map((p) => ({ id: p.id, cards: KEYS.filter((k) => p.cards[k]).map((k) => ({ label: LABEL[k], t: p.cards[k].t })) }));
  }
  return v;
}

module.exports = { createRoom, addPlayer, removePlayer, handle, view, byId, MAX_PLAYERS };
