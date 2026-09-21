/* 별 헤는 밤 — 프런트엔드
   빌드 도구 없이 도는 표준 ES 모듈 하나입니다. */

// ───────── 작은 도우미 ─────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 사용자 입력이 섞이는 자리에는 반드시 이 함수를 거칩니다. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

/** 인라인 스프라이트의 아이콘 하나를 꺼냅니다. */
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}" /></svg>`;

const mascot = (mood = 'default') =>
  `<svg class="mascot" viewBox="0 0 64 64" aria-hidden="true"><use href="#m-${mood}" /></svg>`;

const num = (n) => Number(n || 0).toLocaleString('ko-KR');

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const err = new Error(data?.error?.message || '문제가 생겼습니다.');
    err.code = data?.error?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(message, { tone = '', iconName = '', ms = 4000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (tone) el.dataset.tone = tone;
  el.innerHTML = iconName ? icon(iconName) : '';
  el.append(document.createTextNode(message)); // 텍스트는 노드로 붙여 주입을 막습니다
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

const challengeToast = (c) =>
  toast(`${c.title} — ${c.description}`, { tone: 'star', iconName: 'star', ms: 5000 });

// 미션 갈래별 아이콘
const KIND_ICON = { check: 'speak', text: 'pen', quiz: 'quiz' };
const KIND_LABEL = { check: '낭독', text: '쓰기', quiz: '퀴즈' };

// 응원 종류 — 전부 시의 심상에서 가져왔습니다.
const CHEERS = [
  { key: 'star', icon: 'star', label: '별 하나' },
  { key: 'heart', icon: 'heart', label: '마음' },
  { key: 'leaf', icon: 'leaf', label: '잎새' },
  { key: 'sparkle', icon: 'sparkle', label: '반짝임' },
];

// ───────── 상태 ─────────
const state = {
  user: null,
  today: null,
  rooms: [],
  activeRoomId: null,
  messages: [],
  eventSource: null,
  ranking: { scope: 'room', period: 'week' },
};

// ───────── 테마 · 글씨 크기 ─────────
function currentTheme() {
  return (
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  );
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ydj.theme', theme); } catch {}
  const btn = $('#theme-btn');
  if (btn) {
    btn.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    btn.setAttribute('aria-label', theme === 'dark' ? '밝은 화면으로' : '어두운 화면으로');
  }
}

$('#theme-btn').addEventListener('click', () =>
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
);

$('#textsize-select').addEventListener('change', (e) => {
  const value = e.target.value;
  if (value) document.documentElement.dataset.textsize = value;
  else delete document.documentElement.dataset.textsize;
  try { localStorage.setItem('ydj.textsize', value); } catch {}
});

// ───────── 첫 화면 대기 ─────────
const boot = {
  show(message, { retry = false, mood = 'default' } = {}) {
    const el = $('#boot');
    el.hidden = false;
    el.dataset.state = retry ? 'failed' : 'loading';
    $('#boot-message').textContent = message;
    $('#boot-retry').hidden = !retry;
    $('svg use', el).setAttribute('href', `#m-${mood}`);
  },
  hide() {
    $('#boot').hidden = true;
  },
};

$('#boot-retry').addEventListener('click', () => start());

// ───────── 로그인 ─────────
const AUTH_ERRORS = {
  cancelled: '구글 로그인을 취소하셨습니다.',
  state: '로그인 절차가 만료되었습니다. 다시 시도해 주세요.',
  unverified: '구글에서 이메일 확인이 끝나지 않은 계정입니다.',
  google: '구글 로그인에 실패했습니다. 잠시 뒤에 다시 시도해 주세요.',
};

function showGate() {
  boot.hide();
  $('#gate').hidden = false;
  $('#welcome').hidden = true;
  $('#app').hidden = true;

  // 구글에서 돌아오며 실려 온 오류를 보여 주고 주소는 깨끗이 지웁니다.
  const reason = new URLSearchParams(location.search).get('auth_error');
  if (reason) {
    $('#gate-error').textContent = AUTH_ERRORS[reason] || AUTH_ERRORS.google;
    history.replaceState(null, '', location.pathname + location.hash);
  }
}

/** 구글로 갓 들어온 사람에게 이름·아이디를 받습니다. */
async function showWelcome(user) {
  boot.hide();
  state.user = user;
  $('#gate').hidden = true;
  $('#app').hidden = true;
  $('#welcome').hidden = false;

  const form = $('#welcome-form');
  form.displayName.value = user.displayName || '';
  form.handle.value = user.handle || '';
}

$('#welcome-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const { user } = await api('/me/profile', {
      method: 'PATCH',
      body: { handle: form.get('handle'), displayName: form.get('displayName') },
    });
    $('#welcome').hidden = true;
    await enterApp(user);
    toast('반갑습니다. 오늘의 시부터 펼쳐 보세요.', { tone: 'star', iconName: 'star' });
  } catch (err) {
    $('#welcome-error').textContent = err.message;
  }
});

const gateTabs = [
  { btn: $('#tab-login'), form: $('#login-form') },
  { btn: $('#tab-signup'), form: $('#signup-form') },
];
for (const { btn } of gateTabs) {
  btn.addEventListener('click', () => {
    for (const t of gateTabs) {
      const on = t.btn === btn;
      t.btn.setAttribute('aria-selected', String(on));
      t.form.hidden = !on;
    }
    $('#gate-error').textContent = '';
  });
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { handle: form.get('handle'), pin: form.get('pin') },
    });
    await enterApp(user);
  } catch (err) {
    $('#gate-error').textContent = err.message;
  }
});

$('#signup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  try {
    const { user } = await api('/auth/signup', {
      method: 'POST',
      body: {
        handle: form.get('handle'),
        displayName: form.get('displayName'),
        pin: form.get('pin'),
      },
    });
    await enterApp(user);
    toast('반갑습니다. 오늘의 시부터 펼쳐 보세요.', { tone: 'star', iconName: 'star' });
  } catch (err) {
    $('#gate-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.eventSource?.close();
  location.reload();
});

/**
 * 서버가 켜 둔 로그인 수단만 보여 줍니다.
 * 구글 로그인을 쓰면 이메일 주소를 받게 되므로 안내 문구도 그에 맞춰 바꿉니다
 * — 받는 것을 사실대로 적어야 합니다.
 */
async function loadProviders() {
  let google = false;
  try {
    ({ google } = await api('/auth/providers'));
  } catch {
    google = false;
  }
  $('#google-area').hidden = !google;
  $('#privacy-note').textContent = google
    ? '화면에는 이름과 아이디만 보입니다. 구글로 들어오시면 계정을 알아보는 데에만 이메일 주소를 씁니다.'
    : '이 앱은 아이디와 이름만 받습니다.';
}

$('#google-btn').addEventListener('click', () => {
  // 서버가 state 와 PKCE 를 만들어 쿠키에 심고 구글로 보냅니다.
  location.href = '/api/auth/google/start';
});

async function enterApp(user) {
  boot.hide();
  state.user = user;
  $('#gate').hidden = true;
  $('#app').hidden = false;
  await Promise.all([loadToday(), loadRooms()]);
  switchView(location.hash.slice(1) || 'today');
}

// ───────── 화면 전환 ─────────
function switchView(name) {
  const views = $$('.view');
  const target = views.some((v) => v.dataset.view === name) ? name : 'today';

  for (const v of views) v.hidden = v.dataset.view !== target;
  for (const t of $$('.tab')) {
    if (t.dataset.view === target) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (location.hash.slice(1) !== target) history.replaceState(null, '', `#${target}`);

  if (target === 'library') loadLibrary();
  if (target === 'room') renderRoomView();
  if (target === 'ranking') loadRanking();
  if (target === 'me') loadMe();
}

for (const tab of $$('.tab')) tab.addEventListener('click', () => switchView(tab.dataset.view));
addEventListener('hashchange', () => switchView(location.hash.slice(1) || 'today'));

// ───────── 오늘 ─────────
async function loadToday() {
  state.today = await api('/missions/today');
  renderToday();
}

function renderToday() {
  const { poem, missions, stats } = state.today;

  $('#streak-pill').innerHTML =
    stats.streak > 0 ? `${icon('flame')}${stats.streak}일` : `${icon('flame')}오늘 시작`;
  $('#points-pill').innerHTML = `${icon('star')}${num(stats.totalPoints)}`;

  $('#today-poem').innerHTML = poemHtml(poem);
  $('#mission-list').innerHTML = missions.map(missionHtml).join('');

  const left = missions.filter((m) => !m.completed).length;
  $('#today-left').textContent = left ? `${left}개 남음` : '다 했습니다';

  const done = $('#today-done');
  done.hidden = left > 0;
  if (!left) {
    done.innerHTML =
      mascot('happy') +
      `<p>${
        stats.streak > 1
          ? `오늘 몫을 다 읽었습니다.<br>${stats.streak}일째 이어 가는 중입니다.`
          : '오늘 몫을 다 읽었습니다.<br>내일 또 한 편이 기다립니다.'
      }</p>`;
  }

  bindMissions();
  markPoemRead(poem.id);
}

/** 원고지 조판. 연은 배열이고, 연 안의 행은 줄바꿈으로 유지합니다. */
function poemHtml(poem) {
  const stanzas = poem.stanzas
    .map((lines) => `<p class="stanza">${esc(lines.join('\n'))}</p>`)
    .join('');
  const tags = (poem.themes || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `
    <h2 class="poem-title">${esc(poem.title)}${
      poem.hanja ? `<span class="hanja">${esc(poem.hanja)}</span>` : ''
    }</h2>
    <p class="poem-byline">윤동주 · ${esc(formatWritten(poem.written))}</p>
    <div class="poem-body${poem.form === 'prose' ? ' is-prose' : ''}">${stanzas}</div>
    ${poem.note ? `<div class="poem-note"><b>읽기 도움말</b>${esc(poem.note)}</div>` : ''}
    <div class="tag-row">${tags}</div>`;
}

function formatWritten(written) {
  const [y, m, d] = String(written).split('-');
  if (d) return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  if (m) return `${y}년 ${Number(m)}월`;
  return `${y}년`;
}

function missionHtml(mission) {
  const head = `
    <div class="mission-head">
      <span class="mission-kind">${icon(
        mission.completed ? 'check' : KIND_ICON[mission.kind] || 'quiz',
      )}</span>
      <h3 class="mission-title">${esc(mission.title)}</h3>
      <span class="mission-points">+${mission.points}</span>
    </div>
    <p class="mission-prompt">${esc(mission.prompt)}</p>`;

  if (mission.completed) {
    const explain = mission.reveal?.explain
      ? `<p class="result ok">${esc(mission.reveal.explain)}</p>`
      : '';
    const shown =
      mission.kind === 'text' && mission.completion?.submission
        ? `<p class="submission">${esc(mission.completion.submission)}</p>`
        : '';
    return `<article class="mission is-done" data-id="${mission.id}">${head}${shown}${explain}</article>`;
  }

  let controls;
  if (mission.kind === 'quiz') {
    controls = `<div class="choices" role="group" aria-label="보기">${(mission.data.options || [])
      .map(
        (opt, i) =>
          `<button class="choice" type="button" aria-pressed="false" data-choice="${i}">${esc(opt)}</button>`,
      )
      .join('')}</div>
      <div class="mission-actions">
        <button class="btn btn-primary" data-act="quiz" disabled>제출</button>
        <span class="mission-hint">틀려도 다시 풀 수 있습니다</span>
      </div>`;
  } else if (mission.kind === 'text') {
    const min = mission.data.minLength || 20;
    controls = `<textarea data-input aria-label="${esc(mission.title)}" placeholder="${esc(
      mission.data.placeholder || '',
    )}"></textarea>
      <div class="mission-actions">
        <button class="btn btn-primary" data-act="text">제출</button>
        <span class="mission-hint" data-counter>0 / ${min}자</span>
      </div>`;
  } else {
    controls = `<div class="mission-actions">
        <button class="btn btn-primary" data-act="check">${icon('check')}읽었습니다</button>
      </div>`;
  }

  return `<article class="mission" data-id="${mission.id}" data-min="${
    mission.data.minLength || 0
  }">${head}${controls}<p class="result" data-result role="status"></p></article>`;
}

function bindMissions() {
  for (const card of $$('.mission', $('#mission-list'))) {
    const id = Number(card.dataset.id);

    for (const choice of $$('.choice', card)) {
      choice.addEventListener('click', () => {
        for (const c of $$('.choice', card)) c.setAttribute('aria-pressed', String(c === choice));
        $('[data-act="quiz"]', card).disabled = false;
      });
    }

    const input = $('[data-input]', card);
    const counter = $('[data-counter]', card);
    if (input && counter) {
      const min = Number(card.dataset.min) || 0;
      input.addEventListener('input', () => {
        const length = [...input.value.trim()].length;
        counter.textContent = `${length} / ${min}자`;
        counter.style.color = length >= min ? 'var(--leaf)' : '';
      });
    }

    $('[data-act="check"]', card)?.addEventListener('click', () => submit(card, id, {}));
    $('[data-act="text"]', card)?.addEventListener('click', () =>
      submit(card, id, { text: input?.value ?? '' }),
    );
    $('[data-act="quiz"]', card)?.addEventListener('click', () => {
      const picked = $('.choice[aria-pressed="true"]', card);
      if (picked) submit(card, id, { answer: Number(picked.dataset.choice) });
    });
  }
}

async function submit(card, missionId, payload) {
  const buttons = $$('button', card);
  for (const b of buttons) b.disabled = true;
  const result = $('[data-result]', card);

  try {
    const res = await api(`/missions/${missionId}/submit`, { method: 'POST', body: payload });

    if (res.correct === false) {
      result.textContent = '아직 아닙니다. 시를 한 번 더 보고 골라 보세요.';
      result.className = 'result no';
      $('.choice[aria-pressed="true"]', card)?.classList.add('is-wrong');
      for (const b of buttons) b.disabled = false;
      $('[data-act="quiz"]', card).disabled = true;
      return;
    }

    for (const c of res.earnedChallenges || []) challengeToast(c);
    if (res.dayComplete) toast('오늘 몫을 다 읽었습니다.', { tone: 'star', iconName: 'check' });

    await loadToday();
  } catch (err) {
    result.textContent = err.message;
    result.className = 'result no';
    for (const b of buttons) b.disabled = false;
  }
}

// ───────── 시집 ─────────
async function loadLibrary() {
  const data = await api('/poems');
  $('#library-count').textContent = `${data.readCount} / ${data.total}편`;
  $('#poem-index').innerHTML = data.poems
    .map(
      (p) => `<button class="poem-row" data-poem="${esc(p.id)}" data-read="${p.read}">
        ${icon('star', p.read ? 'icon-solid' : '')}
        <span>
          <span class="poem-row-title">${esc(p.title)}</span>
          <span class="poem-row-sub">${esc(formatWritten(p.written))}</span>
        </span>
      </button>`,
    )
    .join('');

  for (const btn of $$('.poem-row')) {
    btn.addEventListener('click', () => openPoem(btn.dataset.poem));
  }
}

async function openPoem(poemId) {
  const { poem } = await api(`/poems/${poemId}`);
  $('#poem-dialog-body').innerHTML = `<div class="manuscript is-sheet">${poemHtml(poem)}</div>`;
  $('#poem-dialog').showModal();
  const earned = await markPoemRead(poemId);
  if (earned?.length) loadLibrary();
}

async function markPoemRead(poemId) {
  try {
    const { earnedChallenges } = await api(`/poems/${poemId}/read`, { method: 'POST' });
    for (const c of earnedChallenges || []) challengeToast(c);
    return earnedChallenges;
  } catch {
    return [];
  }
}

// ───────── 방 ─────────
async function loadRooms() {
  const { rooms } = await api('/rooms');
  state.rooms = rooms;
  if (!rooms.some((r) => r.id === state.activeRoomId)) state.activeRoomId = rooms[0]?.id ?? null;
}

function renderRoomView() {
  const has = state.rooms.length > 0;
  $('#room-empty').hidden = has;
  $('#room-main').hidden = !has;
  if (!has) return;

  $('#room-picker').innerHTML = state.rooms
    .map(
      (r) =>
        `<option value="${r.id}"${r.id === state.activeRoomId ? ' selected' : ''}>${esc(
          r.name,
        )} · ${r.memberCount}명</option>`,
    )
    .join('');

  openRoom(state.activeRoomId);
}

$('#room-picker').addEventListener('change', (e) => {
  state.activeRoomId = Number(e.target.value);
  openRoom(state.activeRoomId);
});

$('#room-info-btn').addEventListener('click', async () => {
  const { room, members } = await api(`/rooms/${state.activeRoomId}`);
  toast(`초대 코드 ${room.code} · ${members.map((m) => m.displayName).join(', ')}`, {
    iconName: 'users',
    ms: 7000,
  });
  navigator.clipboard?.writeText(room.code).catch(() => {});
});

$('#create-room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { room } = await api('/rooms', {
      method: 'POST',
      body: { name: new FormData(e.target).get('name') },
    });
    e.target.reset();
    await loadRooms();
    state.activeRoomId = room.id;
    renderRoomView();
    toast(`초대 코드는 ${room.code} 입니다.`, { tone: 'star', iconName: 'users', ms: 8000 });
  } catch (err) {
    $('#room-error').textContent = err.message;
  }
});

$('#join-room-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { room } = await api('/rooms/join', {
      method: 'POST',
      body: { code: new FormData(e.target).get('code') },
    });
    e.target.reset();
    await loadRooms();
    state.activeRoomId = room.id;
    renderRoomView();
  } catch (err) {
    $('#room-error').textContent = err.message;
  }
});

async function openRoom(roomId) {
  if (!roomId) return;
  const { messages } = await api(`/rooms/${roomId}/messages?limit=60`);
  state.messages = messages;
  renderMessages();
  connectStream(roomId);
}

function connectStream(roomId) {
  state.eventSource?.close();
  const source = new EventSource(`/api/rooms/${roomId}/stream`);
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'message') {
      state.messages.push(payload.message);
      renderMessages();
    } else if (payload.type === 'cheer') {
      const i = state.messages.findIndex((m) => m.id === payload.message.id);
      if (i >= 0) {
        state.messages[i] = payload.message;
        renderMessages({ keepScroll: true });
      }
    }
  };
  state.eventSource = source; // EventSource 는 끊기면 스스로 다시 붙습니다
}

function renderMessages({ keepScroll = false } = {}) {
  const log = $('#chat-log');
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  log.innerHTML = state.messages.map(messageHtml).join('');

  for (const btn of $$('.cheer', log)) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { earnedChallenges } = await api(
          `/rooms/${state.activeRoomId}/messages/${btn.dataset.message}/cheer`,
          { method: 'POST', body: { kind: btn.dataset.cheer } },
        );
        for (const c of earnedChallenges || []) challengeToast(c);
      } finally {
        btn.disabled = false;
      }
    });
  }

  if (!keepScroll || atBottom) log.scrollTop = log.scrollHeight;
}

const BOT_ICON = { poem: 'book', mission: 'check', challenge: 'star', notice: 'info' };

function messageHtml(msg) {
  const isBot = msg.authorType === 'bot';
  const isMine = !isBot && msg.userId === state.user?.id;

  const shareTag =
    msg.kind === 'share' && msg.meta?.poemTitle
      ? `<span class="share-tag">「${esc(msg.meta.poemTitle)}」 · ${esc(
          msg.meta.missionTitle || '감상',
        )}</span>`
      : '';

  const cheers = isBot
    ? ''
    : `<div class="cheers">${CHEERS.map((c) => {
        const found = msg.cheers.find((x) => x.kind === c.key);
        const mine = found?.userIds.includes(state.user?.id);
        return `<button class="cheer" type="button" aria-pressed="${Boolean(mine)}"
          aria-label="${c.label}" title="${c.label}"
          data-message="${msg.id}" data-cheer="${c.key}">${icon(c.icon, mine ? 'icon-solid' : '')}${
            found?.count ? found.count : ''
          }</button>`;
      }).join('')}</div>`;

  return `<div class="msg" data-kind="${esc(msg.kind)}" data-bot="${isBot}" data-mine="${isMine}">
    ${isBot || isMine ? '' : `<span class="msg-author">${esc(msg.authorName)}</span>`}
    <div class="msg-bubble">${isBot ? icon(BOT_ICON[msg.kind] || 'info') : ''}${shareTag}<span>${esc(
      msg.body,
    )}</span></div>
    ${cheers}
  </div>`;
}

$('#chat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#chat-input');
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  try {
    const { earnedChallenges } = await api(`/rooms/${state.activeRoomId}/messages`, {
      method: 'POST',
      body: { body },
    });
    for (const c of earnedChallenges || []) challengeToast(c);
  } catch (err) {
    toast(err.message);
    input.value = body;
  }
});

// ───────── 랭킹 ─────────
function bindSegmented(id, key, onChange) {
  for (const btn of $$(`#${id} button`)) {
    btn.addEventListener('click', () => {
      for (const b of $$(`#${id} button`)) b.setAttribute('aria-selected', String(b === btn));
      state.ranking[key] = btn.dataset[key];
      onChange();
    });
  }
}
bindSegmented('ranking-scope', 'scope', () => loadRanking());
bindSegmented('ranking-period', 'period', () => loadRanking());

async function loadRanking() {
  const { scope, period } = state.ranking;
  const useRoom = scope === 'room' && state.activeRoomId;
  const { ranking, me } = await api(
    useRoom ? `/rooms/${state.activeRoomId}/ranking?period=${period}` : `/ranking?period=${period}`,
  );

  if (!ranking.length) {
    $('#rank-list').innerHTML =
      '<li class="rank-me-note">아직 기록이 없습니다. 오늘의 미션을 먼저 해 보세요.</li>';
    $('#rank-me').textContent = '';
    return;
  }

  $('#rank-list').innerHTML = ranking
    .map(
      (row) => `<li class="rank-row" data-me="${row.userId === state.user.id}">
        <span class="rank-no">${row.rank}</span>
        <span>${esc(row.displayName)}</span>
        <span class="rank-points">${num(row.points)}</span>
      </li>`,
    )
    .join('');

  $('#rank-me').textContent = me.rank
    ? `내 순위 ${me.rank}위 · ${num(me.points)}점`
    : '아직 이 기간에는 점수가 없습니다.';
}

// ───────── 나 ─────────
async function loadMe() {
  const [me, board, push] = await Promise.all([
    api('/me'),
    api('/me/challenges'),
    api('/me/push'),
  ]);

  const s = me.stats;
  $('#me-head').innerHTML = `${mascot(s.streak > 0 ? 'happy' : 'default')}
    <div>
      <div class="me-name">${esc(me.user.displayName)}</div>
      <div class="me-sub">${esc(me.user.handle)}</div>
    </div>`;

  const peak = Math.max(1, ...me.activity.map((a) => a.points));
  const strip = me.activity
    .map((a) => {
      const level = !a.points ? 0 : a.points >= peak * 0.66 ? 3 : a.points >= peak * 0.33 ? 2 : 1;
      return `<span class="activity-day" data-level="${level}" title="${a.day} · ${a.points}점"></span>`;
    })
    .join('');

  const stat = (value, label) =>
    `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;

  $('#me-stats').innerHTML = `<div class="stat-grid">
      ${stat(num(s.totalPoints), '점수')}${stat(s.streak, '연속일')}
      ${stat(s.missionsCompleted, '완료 미션')}${stat(s.poemsRead, '읽은 시')}
      ${stat(board.earnedCount, '도전과제')}
    </div>
    <div class="activity" role="img" aria-label="최근 3주 활동">${strip}</div>`;

  $('#challenge-count').textContent = `${board.earnedCount} / ${board.total}`;
  $('#challenge-board').innerHTML = board.groups
    .map(
      (group) => `<section class="challenge-group">
        <h3>${esc(group.name)}</h3>
        <div class="challenge-grid">${group.items.map(challengeHtml).join('')}</div>
      </section>`,
    )
    .join('');

  renderPushPanel(push);

  const size = document.documentElement.dataset.textsize || '';
  $('#textsize-select').value = size;
}

function challengeHtml(c) {
  const meter =
    !c.earned && c.progress?.target
      ? `<div class="meter"><i style="width:${Math.round(c.progress.ratio * 100)}%"></i></div>
         <div class="challenge-desc">${c.progress.current} / ${c.progress.target}</div>`
      : '';
  return `<div class="challenge" data-earned="${c.earned}">
    ${icon(esc(c.icon || 'star'), c.earned ? 'icon-solid' : '')}
    <span class="challenge-name">${esc(c.title)}</span>
    <span class="challenge-desc">${esc(c.description)}</span>
    ${meter}
  </div>`;
}

// ───────── 웹푸시 ─────────
function renderPushPanel(push) {
  if (!push.configured) {
    $('#push-panel').innerHTML = `<p class="note">
      이 서버에는 아직 웹푸시 키(VAPID)가 설정되지 않아 알림을 보낼 수 없습니다.
      <code>npm run keys</code> 로 키를 만들어 <code>.env</code> 에 넣고 서버를 다시 시작하세요.</p>`;
    return;
  }

  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  const p = push.prefs;
  const toggle = (key, label, on) =>
    `<label class="switch-row"><span>${label}</span>
       <input type="checkbox" data-pref="${key}" ${on ? 'checked' : ''} /></label>`;

  $('#push-panel').innerHTML = `
    <div class="switch-row">
      <span>이 기기에서 알림 받기</span>
      <button class="btn btn-sm" id="push-toggle">${push.devices > 0 ? '해제' : '켜기'}</button>
    </div>
    ${toggle('poemPush', '오늘의 시', p.poemPush)}
    ${toggle('missionPush', '미션 발행', p.missionPush)}
    ${toggle('challengePush', '도전과제 달성', p.challengePush)}
    <div class="switch-row"><span>방해 금지</span>
      <span class="quiet-range">
        <input type="number" min="0" max="23" data-pref="quietStart" value="${p.quietStart ?? ''}"
               placeholder="22" aria-label="방해 금지 시작 시각" />
        <span>~</span>
        <input type="number" min="0" max="23" data-pref="quietEnd" value="${p.quietEnd ?? ''}"
               placeholder="7" aria-label="방해 금지 끝 시각" />
      </span></div>
    <p class="note">${
      supported
        ? `연결된 기기 ${push.devices}대. 알림은 앱을 닫아도 도착합니다.`
        : 'iOS 는 홈 화면에 추가한 뒤에 알림을 받을 수 있습니다.'
    }</p>
    ${push.devices > 0 ? '<button class="btn btn-sm" id="push-test">시험 삼아 하나 보내 보기</button>' : ''}`;

  $('#push-toggle').addEventListener('click', () =>
    push.devices > 0 ? disablePush() : enablePush(push.publicKey),
  );
  $('#push-test')?.addEventListener('click', async () => {
    const res = await api('/me/push/test', { method: 'POST' });
    toast(res.sent ? '알림을 보냈습니다.' : `보내지 못했습니다 (${res.skipped ?? '알 수 없음'}).`, {
      iconName: 'bell',
    });
  });

  for (const input of $$('[data-pref]', $('#push-panel'))) {
    input.addEventListener('change', async () => {
      const value =
        input.type === 'checkbox' ? input.checked : input.value === '' ? null : Number(input.value);
      await api('/me/push/prefs', { method: 'PUT', body: { [input.dataset.pref]: value } });
      toast('알림 설정을 저장했습니다.', { iconName: 'check' });
    });
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from([...atob(base64)].map((c) => c.charCodeAt(0)));
}

async function enablePush(publicKey) {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 알림을 지원하지 않습니다.');
    if ((await Notification.requestPermission()) !== 'granted') {
      toast('브라우저에서 알림을 허용해 주세요.', { iconName: 'bell' });
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/me/push/subscribe', { method: 'POST', body: { subscription } });
    toast('이 기기로 알림을 보내겠습니다.', { tone: 'star', iconName: 'bell' });
    loadMe();
  } catch (err) {
    toast(err.message);
  }
}

async function disablePush() {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    await api('/me/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
    await subscription.unsubscribe();
  }
  toast('이 기기의 알림을 껐습니다.', { iconName: 'bell' });
  loadMe();
}

// ───────── 시작 ─────────
applyTheme(currentTheme());
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/**
 * 앱을 띄웁니다.
 *
 * "로그인하지 않은 것"과 "서버에 닿지 못한 것"은 다른 상황이라 나눠서 다룹니다.
 * 전자는 로그인 화면으로, 후자는 다시 시도할 수 있는 안내로 보냅니다.
 * (배포 환경에서 서버가 잠들었다 깨어나는 동안에도 이 화면이 보입니다.)
 */
async function start() {
  boot.show('잠시만요, 별을 헤아리는 중입니다.');
  try {
    const { user } = await api('/auth/me');
    if (user.profileCompleted === false) await showWelcome(user);
    else await enterApp(user);
  } catch (err) {
    if (err.status === 401) {
      showGate();
      loadProviders();
      return;
    }
    boot.show('서버에 닿지 못했습니다. 잠시 뒤에 다시 시도해 주세요.', {
      retry: true,
      mood: 'sleep',
    });
  }
}

await start();
