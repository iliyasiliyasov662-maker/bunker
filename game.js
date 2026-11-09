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
  return { female, age, card: { t, tags, e: null } };
}

function startGame(room) {
  const n = room.players.length;
  const adult = room.settings.adult;
  const deckOf = (key) => new Deck(C[key].concat(adult && C.adult[key] ? C.adult[key] : []));
  room.decks = {};
  for (const k of ['profession', 'health', 'hobby', 'phobia', 'baggage', 'fact', 'minus']) room.decks[k] = deckOf(k);
  room.decks.supplies = new Deck(C.supplies);
  room.decks.fates = new Deck(C.outsideFates);
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
      p.cards[k] = { t: gend(c.t, p.female), tags: c.tags.slice(), e: c.e ? gend(c.e, p.female) : null };
    }
    const exp = Math.min(p.age - 18, rnd(Math.max(1, Math.floor((p.age - 16) * 0.8))));
    p.cards.profession.t += exp <= 0 ? ' (без стажа)' : ` (стаж ${exp} ${yearsWord(exp)})`;
    p.trump = { ...trumpDeck.draw(), used: false };
    p.actions = [];
  }

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
  for (const k of KEYS) if (p.cards[k].tags.includes(tag)) return `${LABEL[k].toLowerCase()}: ${p.cards[k].t}`;
  return '';
}

// Оценивает, как прожил бы бункер с данным составом
function evaluate(room, ids, story) {
  const members = ids.map((id) => byId(room, id));
  const outside = room.players.filter((p) => !ids.includes(p.id));
  const tags = new Map(members.map((p) => [p.id, playerTags(p)]));
  const sup = supplyTags(room);
  const supHas = (t) => sup.find((s) => s.t === t);
  const lines = [];
  const per = {};
  members.forEach((p) => (per[p.id] = { saved: [], bad: [], died: false }));
  const g = (p, s) => gend(s, p.female);

  // смерти
  const dead = new Set();
  for (const p of members) {
    const t = tags.get(p.id);
    const medic = members.find((m) => m !== p && tags.get(m.id).has('med'));
    if (t.has('terminal')) {
      dead.add(p.id);
      lines.push(g(p, `💀 ${p.name} не дожил{|а} до конца: ${p.cards.health.t.toLowerCase()}.`));
    } else if (t.has('dying')) {
      if (medic) { lines.push(g(medic, `🩺 ${p.name}: болезнь удалось держать под контролем, помог{|ла} ${medic.name}.`)); per[medic.id].saved.push('лечение больных'); }
      else if (supHas('med')) lines.push(`🩺 ${p.name} выжил${p.female ? 'а' : ''} благодаря лекарствам из бункера.`);
      else { dead.add(p.id); lines.push(g(p, `💀 ${p.name} не пережил{|а} первый год: ${p.cards.health.t.toLowerCase()}, а лечить было некому.`)); }
    }
  }
  dead.forEach((id) => (per[id].died = true));
  const living = members.filter((p) => !dead.has(p.id));
  const lt = (p, t) => tags.get(p.id).has(t);

  // заразные
  let incidents = 0;
  const sick = living.filter((p) => lt(p, 'contagious'));
  if (sick.length) {
    const medic = living.find((p) => lt(p, 'med'));
    if (medic || supHas('med')) lines.push(`🦠 ${namesList(sick)} ${sick.length > 1 ? 'были заразны' : 'был' + (sick[0].female ? 'а' : '') + ' ' + (sick[0].female ? 'заразна' : 'заразен')}, но болезнь не разошлась${medic ? ', ' + medic.name + ' всех вылечил' + (medic.female ? 'а' : '') : ''}.`);
    else { incidents += 2; sick.forEach((p) => per[p.id].bad.push('заразил{|а} весь бункер')); lines.push(`🦠 ${namesList(sick)} ${sick.length > 1 ? 'заразили' : 'заразил' + (sick[0].female ? 'а' : '')} весь бункер. Полгода все лежали пластом.`); }
  }

  // угрозы
  let solved = 0, failed = 0;
  const failedList = [];
  for (const th of room.threats) {
    const T = C.threats[th.id];
    const savers = living.filter((p) => T.needs.some((n) => lt(p, n)));
    if (savers.length) {
      solved++;
      savers.forEach((p) => per[p.id].saved.push(`«${T.name}»`));
      const line = gend(T.win, savers[0].female).replace('{who}', savers[0].name);
      lines.push(`✅ ${line.charAt(0).toUpperCase() + line.slice(1)}`);
      continue;
    }
    const s = T.needs.map(supHas).find(Boolean);
    if (s) { solved++; lines.push(`✅ «${T.name}» — не беда: в бункере нашлось «${s.src}».`); continue; }
    failed++; failedList.push(th.id);
    let line = `❌ ${T.lose}`;
    const could = outside.filter((p) => T.needs.some((n) => playerTags(p).has(n)));
    if (could.length) {
      const p = could[0];
      const need = T.needs.find((n) => playerTags(p).has(n));
      line += ` А ведь ${p.name} (${cardWith(p, need)}) мог${p.female ? 'ла' : ''} всё исправить.`;
    }
    lines.push(line);
  }

  // плохие черты
  const has = (t, except) => living.some((p) => p !== except && lt(p, t));
  for (const p of living) {
    const t = tags.get(p.id);
    if (t.has('danger')) {
      if (has('defense', p) || has('leader', p)) {
        const cop = living.find((m) => m !== p && (lt(m, 'defense') || lt(m, 'leader')));
        lines.push(`🔒 ${p.name} пытал${p.female ? 'ась' : 'ся'} устроить беспредел, но ${cop.name} быстро это ${cop.female ? 'пресекла' : 'пресёк'}.`);
      }
      else { incidents++; per[p.id].bad.push('устроил{|а} поножовщину'); lines.push(`🔪 ${p.name} однажды ночью сорвал${p.female ? 'ась' : 'ся'}. Остановить было некому, бункер это запомнил надолго.`); }
    }
    if (t.has('thief')) {
      if (has('leader', p) || has('defense', p)) lines.push(`🕵️ ${p.name} таскал${p.female ? 'а' : ''} запасы, но ${p.female ? 'её' : 'его'} быстро поймали.`);
      else { incidents++; per[p.id].bad.push('разворовал{|а} запасы'); lines.push(`🕵️ ${p.name} тихо таскал${p.female ? 'а' : ''} запасы. Заметили, когда склад опустел наполовину.`); }
    }
    if (t.has('glutton')) {
      if (has('food') || supHas('food')) lines.push(`🍖 ${p.name} ел${p.female ? 'а' : ''} за троих, но еды хватало.`);
      else { incidents++; per[p.id].bad.push('съел{|а} лишнее'); lines.push(`🍖 ${p.name} съел${p.female ? 'а' : ''} недельный запас за ночь. Пополнить его было нечем.`); }
    }
    if (t.has('conflict')) {
      if (has('morale', p) || has('leader', p)) lines.push(`🗣️ ${p.name} постоянно со всеми ругал${p.female ? 'ась' : 'ся'}, но до драк не доходило.`);
      else { incidents++; per[p.id].bad.push('перессорил{|а} всех'); lines.push(`🗣️ ${p.name} перессорил${p.female ? 'а' : ''} весь бункер. Последний год никто ни с кем не разговаривал.`); }
    }
  }

  // забавные эпизоды
  if (story) {
    for (const p of shuffle(living.slice())) {
      const c = shuffle(KEYS.slice()).map((k) => p.cards[k]).find((c) => c.e);
      if (c) lines.push('💬 ' + c.e.replace(/\{name\}/g, p.name));
    }
  }

  // продолжение рода
  const fertile = (p) => !lt(p, 'infertile') && (p.female ? p.age <= 45 : p.age <= 65);
  const pregnant = living.some((p) => lt(p, 'pregnant'));
  const pop = pregnant || (living.some((p) => !p.female && fertile(p)) && living.some((p) => p.female && fertile(p)));
  if (living.length) {
    if (pop) lines.push(pregnant ? '👶 В бункере родился ребёнок. Человечество продолжается!' : '👶 Среди выживших есть те, кто сможет продолжить род. У человечества есть будущее.');
    else lines.push('🚫 Продолжить род среди выживших некому. Вы последние.');
  }

  const score = solved * 3 - failed * 3 - incidents - dead.size * 1.5 + (pop ? 2 : 0);
  let verdict;
  if (!living.length) verdict = { kind: 'doom', title: 'Бункер опустел', text: 'Никто не дожил до выхода на поверхность.' };
  else if (failed >= 2) verdict = { kind: 'doom', title: 'Бункер погиб', text: 'Слишком много проблем, с которыми некому было справиться.' };
  else if (failed === 1 || incidents >= 2) verdict = { kind: 'loss', title: 'Выжили, но с потерями', text: pop ? 'Было тяжело, но кто-то всё-таки вышел на поверхность.' : 'Вы вышли наружу, но новых людей уже не будет.' };
  else if (pop) verdict = { kind: 'win', title: 'Человечество спасено!', text: 'Бункер справился со всем, и у человечества есть будущее.' };
  else verdict = { kind: 'loss', title: 'Выжили, но вы последние', text: 'Вы справились со всеми бедами, но продолжить род некому.' };

  return { score, verdict, lines, per, failedList, dead, solved, failed, incidents, pop };
}

function finish(room) {
  room.phase = 'epilogue';
  const kept = alive(room).map((p) => p.id);
  const actual = evaluate(room, kept, true);
  const cat = room.catastrophe;

  const lines = [];
  lines.push(`🚪 Гермодверь закрылась. Внутри: ${namesList(alive(room))}. Снаружи — ${cat.name.toLowerCase()}. Продержаться нужно ${cat.years} ${yearsWord(cat.years)}.`);
  const hidden = room.threats.filter((t) => !t.known).map((t) => C.threats[t.id].name);
  if (hidden.length) lines.push(`🔍 Скрытые проблемы бункера: ${hidden.join(', ')}.`);
  lines.push(...actual.lines);
  for (const p of room.players.filter((x) => x.exiled)) lines.push('🌫️ ' + gend(room.decks.fates.draw(), p.female).replace(/\{name\}/g, p.name));
  const target = room.players.slice().sort((x, y) => (y.tomatoes || 0) - (x.tomatoes || 0))[0];
  if (target && target.tomatoes) lines.push(`🍅 Главная мишень бункера: ${target.name}, ${target.tomatoes} ${target.tomatoes % 10 === 1 && target.tomatoes % 100 !== 11 ? 'помидор' : [2, 3, 4].includes(target.tomatoes % 10) && ![12, 13, 14].includes(target.tomatoes % 100) ? 'помидора' : 'помидоров'} в противогаз.`);

  // ищем идеальный состав
  const all = room.players.map((p) => p.id);
  let best = null;
  for (const combo of combinations(all, kept.length)) {
    const ev = evaluate(room, combo, false);
    const overlap = combo.filter((id) => kept.includes(id)).length;
    if (!best || ev.score > best.ev.score + 1e-9 || (Math.abs(ev.score - best.ev.score) < 1e-9 && overlap > best.overlap)) {
      best = { combo, ev, overlap };
    }
  }
  const perfect = actual.score >= best.ev.score - 1e-9;
  if (perfect) best = { combo: kept, ev: actual, overlap: kept.length };

  const players = room.players.map((p) => {
    const inBest = best.combo.includes(p.id);
    const wasKept = kept.includes(p.id);
    const ok = inBest === wasKept;
    let label, reason;
    const bads = () => {
      const t = playerTags(p);
      const r = Object.keys(BAD_TAGS).filter((k) => t.has(k)).map((k) => gend(BAD_TAGS[k], p.female));
      return r;
    };
    if (wasKept && ok) {
      label = '✅ Правильно оставили';
      const s = actual.per[p.id].saved;
      if (s.length) reason = 'Пригодил' + (p.female ? 'ась' : 'ся') + ': ' + s.join(', ') + '.';
      else if (actual.pop) reason = 'Проблем не создавал' + (p.female ? 'а' : '') + ' и пригодил' + (p.female ? 'ась' : 'ся') + ' для продолжения рода.';
      else reason = 'Особой пользы не было, но и лучшей замены тоже.';
    } else if (!wasKept && ok) {
      label = '✅ Правильно выгнали';
      const b = bads();
      reason = b.length ? 'В бункере ' + (p.female ? 'она' : 'он') + ' ' + b.join(', ') + '.' : 'Ничего такого, чего не умели бы остальные.';
    } else if (!wasKept && !ok) {
      label = '❌ Зря выгнали';
      const s = best.ev.per[p.id] ? best.ev.per[p.id].saved.map((x) => gend(x, p.female)) : [];
      const sk = [...playerTags(p)].filter((t) => SKILL_NAMES[t]).map((t) => SKILL_NAMES[t]);
      reason = s.length ? 'Пригодил' + (p.female ? 'ась' : 'ся') + ' бы: ' + s.join(', ') + '.' : sk.length ? 'Пригодил' + (p.female ? 'ась' : 'ся') + ' бы: ' + sk.join(', ') + '.' : 'С ' + (p.female ? 'ней' : 'ним') + ' состав был бы надёжнее.';
    } else {
      label = '❌ Зря оставили';
      const r = actual.per[p.id];
      const b = r.bad.map((x) => gend(x, p.female));
      if (r.died) b.unshift('не дожил' + (p.female ? 'а' : '') + ' до конца');
      if (!r.saved.length) b.push('ничем особо не помог' + (p.female ? 'ла' : ''));
      reason = b.join(', ') + '.';
      reason = reason.charAt(0).toUpperCase() + reason.slice(1);
    }
    return { id: p.id, name: p.name, color: p.color, kept: wasKept, inBest, ok, label, reason };
  });
  const matched = kept.filter((id) => best.combo.includes(id)).length;

  room.epilogue = {
    verdict: actual.verdict,
    lines,
    analysis: {
      perfect,
      matched, capacity: kept.length,
      bestNames: best.combo.map((id) => byId(room, id).name),
      bestVerdict: best.ev.verdict,
      hopeless: best.ev.verdict.kind === 'doom',
      players,
    },
  };
  addLog(room, 'big', `🏁 Игра окончена: ${actual.verdict.title}`);
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
          p.cards.health = { t: p.female ? 'Абсолютно здорова (чудесно исцелилась)' : 'Абсолютно здоров (чудесно исцелился)', tags: ['healthy'], e: null };
          addLog(room, 'trump', `✨ ${p.name} чудесно исцеляется!${p.revealed.health ? ' Новое здоровье: ' + p.cards.health.t : ''}`);
          break;
        case 'reroll_baggage': {
          const c = room.decks.baggage.draw();
          p.cards.baggage = { t: gend(c.t, p.female), tags: c.tags.slice(), e: c.e ? gend(c.e, p.female) : null };
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
