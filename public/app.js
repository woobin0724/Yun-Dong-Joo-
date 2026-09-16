/* 별 헤는 밤 — 프런트엔드
   빌드 도구 없이 동작하도록 표준 ES 모듈 하나로 작성했습니다. */

// ───────── 작은 도우미 ─────────
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** 사용자 입력이 섞여도 안전하도록 텍스트는 항상 이 함수를 거쳐 넣는다. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

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

function toast(message, { star = false, ms = 3800 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${star ? ' is-star' : ''}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

const KIND_LABEL = { check: '낭독', text: '쓰기', quiz: '퀴즈' };

// ───────── 상태 ─────────
const state = {
  user: null,
  today: null,
  rooms: [],
  activeRoomId: null,
  messages: [],
  eventSource: null,
  ranking: { scope: 'room', period: 'week' },
  poems: [],
};

// ───────── 로그인 ─────────
function showGate() {
  $('#gate').hidden = false;
  $('#app').hidden = true;
}

$$('[data-gate-tab]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.gateTab;
    $$('[data-gate-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
    $('#login-form').hidden = tab !== 'login';
    $('#signup-form').hidden = tab !== 'signup';
    $('#gate-error').textContent = '';
  });
});

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
    toast('반갑습니다. 오늘의 시부터 펼쳐 보세요.', { star: true });
  } catch (err) {
    $('#gate-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  state.eventSource?.close();
  location.reload();
});

async function enterApp(user) {
  state.user = user;
  $('#gate').hidden = true;
  $('#app').hidden = false;
  await Promise.all([loadToday(), loadRooms()]);
  switchView(location.hash.slice(1) || 'today');
}

// ───────── 화면 전환 ─────────
function switchView(name) {
  const views = $$('[data-view]', $('#views'));
  const known = views.some((v) => v.dataset.view === name);
  const target = known ? name : 'today';

  views.forEach((v) => (v.hidden = v.dataset.view !== target));
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === target));
  if (location.hash.slice(1) !== target) history.replaceState(null, '', `#${target}`);

  if (target === 'library') loadLibrary();
  if (target === 'room') renderRoomView();
  if (target === 'ranking') loadRanking();
  if (target === 'me') loadMe();
}

$$('.tab').forEach((tab) => tab.addEventListener('click', () => switchView(tab.dataset.view)));
window.addEventListener('hashchange', () => switchView(location.hash.slice(1) || 'today'));

// ───────── 오늘 ─────────
async function loadToday() {
  state.today = await api('/missions/today');
  renderToday();
}

function renderToday() {
  const { poem, missions, stats } = state.today;

  $('#streak-badge').textContent = stats.streak > 0 ? `🔥 ${stats.streak}일 연속` : '오늘 시작';
  $('#points-badge').textContent = `${stats.totalPoints.toLocaleString('ko-KR')}점`;

  $('#today-poem').innerHTML = poemCardHtml(poem, { eyebrow: '오늘의 시' });
  $('#mission-list').innerHTML = missions.map(missionHtml).join('');

  const remaining = missions.filter((m) => !m.completed).length;
  const doneNote = $('#today-done');
  doneNote.hidden = remaining > 0;
  if (!remaining) {
    doneNote.textContent =
      stats.streak > 1
        ? `오늘 몫을 다 읽었습니다. ${stats.streak}일째 이어 가는 중입니다.`
        : '오늘 몫을 다 읽었습니다. 내일 또 한 편이 기다립니다.';
  }

  bindMissionHandlers();
  markPoemRead(poem.id);
}

function poemCardHtml(poem, { eyebrow = '' } = {}) {
  const stanzas = poem.stanzas
    .map((lines) => `<p class="stanza">${esc(lines.join('\n'))}</p>`)
    .join('');
  const tags = [...(poem.themes || [])]
    .map((t) => `<span class="chip">${esc(t)}</span>`)
    .join('');
  return `
    ${eyebrow ? `<p class="poem-eyebrow">${esc(eyebrow)}</p>` : ''}
    <h2 class="poem-title">${esc(poem.title)}${
      poem.hanja ? ` <span class="muted" style="font-size:.6em">${esc(poem.hanja)}</span>` : ''
    }</h2>
    <p class="poem-meta">윤동주 · ${esc(formatWritten(poem.written))}</p>
    <div class="poem-body${poem.form === 'prose' ? ' is-prose' : ''}">${stanzas}</div>
    ${poem.note ? `<div class="poem-note">${esc(poem.note)}</div>` : ''}
    <div class="poem-tags">${tags}</div>
  `;
}

function formatWritten(written) {
  const [y, m, d] = String(written).split('-');
  if (d) return `${y}년 ${Number(m)}월 ${Number(d)}일`;
  if (m) return `${y}년 ${Number(m)}월`;
  return `${y}년`;
}

function missionHtml(mission) {
  const kindLabel = KIND_LABEL[mission.kind] || mission.kind;
  const head = `
    <div class="mission-head">
      <h3 class="mission-title"><span class="mission-kind">${esc(kindLabel)}</span>${esc(mission.title)}</h3>
      <span class="mission-points">+${mission.points}점</span>
    </div>
    <p class="mission-prompt">${esc(mission.prompt)}</p>`;

  if (mission.completed) {
    const reveal = mission.reveal?.explain
      ? `<p class="mission-result ok">${esc(mission.reveal.explain)}</p>`
      : '';
    const shown =
      mission.kind === 'text' && mission.completion?.submission
        ? `<p class="mission-submission">${esc(mission.completion.submission)}</p>`
        : '';
    return `<article class="mission is-done" data-id="${mission.id}">
      ${head}
      <p class="mission-result ok">✓ 완료 · +${mission.completion?.points ?? mission.points}점</p>
      ${shown}${reveal}
    </article>`;
  }

  let controls = '';
  if (mission.kind === 'quiz') {
    controls = `<div class="choices">${(mission.data.options || [])
      .map((opt, i) => `<button class="choice" type="button" data-choice="${i}">${esc(opt)}</button>`)
      .join('')}</div>
      <div class="mission-actions">
        <button class="btn btn-primary" data-action="submit-quiz" disabled>제출</button>
        <span class="mission-hint">틀려도 다시 풀 수 있습니다.</span>
      </div>`;
  } else if (mission.kind === 'text') {
    const min = mission.data.minLength || 20;
    controls = `<textarea data-input placeholder="${esc(mission.data.placeholder || '')}"></textarea>
      <div class="mission-actions">
        <button class="btn btn-primary" data-action="submit-text">제출</button>
        <span class="mission-hint" data-counter>0 / ${min}자</span>
      </div>`;
  } else {
    controls = `<div class="mission-actions">
        <button class="btn btn-primary" data-action="submit-check">읽었습니다</button>
      </div>`;
  }

  return `<article class="mission" data-id="${mission.id}" data-kind="${esc(mission.kind)}" data-min="${
    mission.data.minLength || 0
  }">${head}${controls}<p class="mission-result" data-result></p></article>`;
}

function bindMissionHandlers() {
  $$('.mission', $('#mission-list')).forEach((card) => {
    const id = Number(card.dataset.id);

    $$('.choice', card).forEach((choice) => {
      choice.addEventListener('click', () => {
        $$('.choice', card).forEach((c) => c.classList.remove('is-selected'));
        choice.classList.add('is-selected');
        $('[data-action="submit-quiz"]', card).disabled = false;
      });
    });

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

    $('[data-action="submit-check"]', card)?.addEventListener('click', () => submit(card, id, {}));
    $('[data-action="submit-text"]', card)?.addEventListener('click', () =>
      submit(card, id, { text: input?.value ?? '' }),
    );
    $('[data-action="submit-quiz"]', card)?.addEventListener('click', () => {
      const selected = $('.choice.is-selected', card);
      if (!selected) return;
      submit(card, id, { answer: Number(selected.dataset.choice) });
    });
  });
}

async function submit(card, missionId, payload) {
  const buttons = $$('button', card);
  buttons.forEach((b) => (b.disabled = true));
  const result = $('[data-result]', card);

  try {
    const res = await api(`/missions/${missionId}/submit`, { method: 'POST', body: payload });

    if (res.correct === false) {
      result.textContent = '아직 아닙니다. 시를 한 번 더 보고 골라 보세요.';
      result.className = 'mission-result no';
      $('.choice.is-selected', card)?.classList.add('is-wrong');
      buttons.forEach((b) => (b.disabled = false));
      $('[data-action="submit-quiz"]', card).disabled = true;
      return;
    }

    state.today.missions = res.missions;
    state.today.stats.totalPoints += res.earnedPoints;
    for (const challenge of res.earnedChallenges || []) {
      toast(`${challenge.icon} ${challenge.title} — ${challenge.description}`, { star: true });
    }
    if (res.dayComplete) toast('오늘 몫을 다 읽었습니다.', { star: true });

    await loadToday();
  } catch (err) {
    result.textContent = err.message;
    result.className = 'mission-result no';
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ───────── 시집 ─────────
async function loadLibrary() {
  const data = await api('/poems');
  state.poems = data.poems;
  $('#library-count').textContent = `${data.readCount} / ${data.total}편`;
  $('#poem-list').innerHTML = data.poems
    .map(
      (p) => `<button class="poem-item" data-poem="${esc(p.id)}">
        <span class="poem-item-title">${esc(p.title)}${p.read ? '<span class="read-dot">●</span>' : ''}</span>
        <span class="poem-item-preview">${esc(p.preview)}</span>
      </button>`,
    )
    .join('');

  $$('.poem-item', $('#poem-list')).forEach((btn) =>
    btn.addEventListener('click', () => openPoem(btn.dataset.poem)),
  );
}

async function openPoem(poemId) {
  const { poem } = await api(`/poems/${poemId}`);
  $('#poem-dialog-body').innerHTML = `<div class="poem-card">${poemCardHtml(poem)}</div>`;
  $('#poem-dialog').showModal();
  const earned = await markPoemRead(poemId);
  if (earned?.length) loadLibrary();
}

async function markPoemRead(poemId) {
  try {
    const { earnedChallenges } = await api(`/poems/${poemId}/read`, { method: 'POST' });
    for (const c of earnedChallenges || []) {
      toast(`${c.icon} ${c.title} — ${c.description}`, { star: true });
    }
    return earnedChallenges;
  } catch {
    return [];
  }
}

// ───────── 방 ─────────
async function loadRooms() {
  const { rooms } = await api('/rooms');
  state.rooms = rooms;
  if (!state.activeRoomId && rooms.length) state.activeRoomId = rooms[0].id;
  if (state.activeRoomId && !rooms.some((r) => r.id === state.activeRoomId)) {
    state.activeRoomId = rooms[0]?.id ?? null;
  }
}

function renderRoomView() {
  const hasRoom = state.rooms.length > 0;
  $('#room-empty').hidden = hasRoom;
  $('#room-main').hidden = !hasRoom;
  if (!hasRoom) return;

  const picker = $('#room-picker');
  picker.innerHTML = state.rooms
    .map(
      (r) =>
        `<option value="${r.id}"${r.id === state.activeRoomId ? ' selected' : ''}>${esc(
          r.name,
        )} (${r.memberCount}명)</option>`,
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
  const names = members.map((m) => m.displayName).join(', ');
  toast(`「${room.name}」 초대 코드 ${room.code} · ${members.length}명 — ${names}`, { ms: 7000 });
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
    toast(`「${room.name}」 방을 열었습니다. 초대 코드는 ${room.code} 입니다.`, { star: true, ms: 8000 });
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
      const index = state.messages.findIndex((m) => m.id === payload.message.id);
      if (index >= 0) {
        state.messages[index] = payload.message;
        renderMessages({ keepScroll: true });
      }
    }
  };
  source.onerror = () => {
    // EventSource 는 스스로 다시 붙는다. 조용히 둔다.
  };
  state.eventSource = source;
}

const CHEERS = [
  { key: 'star', emoji: '⭐' },
  { key: 'heart', emoji: '💛' },
  { key: 'leaf', emoji: '🍃' },
  { key: 'clap', emoji: '👏' },
];

function renderMessages({ keepScroll = false } = {}) {
  const log = $('#chat-log');
  const wasAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;

  log.innerHTML = state.messages.map(messageHtml).join('');

  $$('.cheer-btn', log).forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { earnedChallenges } = await api(
          `/rooms/${state.activeRoomId}/messages/${btn.dataset.message}/cheer`,
          { method: 'POST', body: { kind: btn.dataset.cheer } },
        );
        for (const c of earnedChallenges || []) {
          toast(`${c.icon} ${c.title} — ${c.description}`, { star: true });
        }
      } finally {
        btn.disabled = false;
      }
    }),
  );

  if (!keepScroll || wasAtBottom) log.scrollTop = log.scrollHeight;
}

function messageHtml(msg) {
  const isMine = msg.userId === state.user?.id;
  const isBot = msg.authorType === 'bot';
  const classes = ['msg', isBot ? 'is-bot' : '', isMine && !isBot ? 'is-mine' : '']
    .filter(Boolean)
    .join(' ');

  const shareTag =
    msg.kind === 'share' && msg.meta?.poemTitle
      ? `<span class="msg-share-tag">「${esc(msg.meta.poemTitle)}」 · ${esc(
          msg.meta.missionTitle || '감상',
        )}</span>`
      : '';

  const cheerButtons = isBot
    ? ''
    : `<div class="msg-cheers">${CHEERS.map((c) => {
        const found = msg.cheers.find((x) => x.kind === c.key);
        const mine = found?.userIds.includes(state.user?.id);
        return `<button class="cheer-btn${mine ? ' is-on' : ''}" data-message="${msg.id}" data-cheer="${
          c.key
        }">${c.emoji}${found?.count ? ` ${found.count}` : ''}</button>`;
      }).join('')}</div>`;

  return `<div class="${classes}" data-kind="${esc(msg.kind)}">
    ${isBot || isMine ? '' : `<span class="msg-author">${esc(msg.authorName)}</span>`}
    <div class="msg-bubble">${shareTag}${esc(msg.body)}</div>
    ${cheerButtons}
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
    for (const c of earnedChallenges || []) {
      toast(`${c.icon} ${c.title} — ${c.description}`, { star: true });
    }
  } catch (err) {
    toast(err.message);
    input.value = body;
  }
});

// ───────── 랭킹 ─────────
$$('#ranking-scope button').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.ranking.scope = btn.dataset.scope;
    $$('#ranking-scope button').forEach((b) => b.classList.toggle('is-active', b === btn));
    loadRanking();
  }),
);
$$('#ranking-period button').forEach((btn) =>
  btn.addEventListener('click', () => {
    state.ranking.period = btn.dataset.period;
    $$('#ranking-period button').forEach((b) => b.classList.toggle('is-active', b === btn));
    loadRanking();
  }),
);

async function loadRanking() {
  const { scope, period } = state.ranking;
  const useRoom = scope === 'room' && state.activeRoomId;
  const path = useRoom
    ? `/rooms/${state.activeRoomId}/ranking?period=${period}`
    : `/ranking?period=${period}`;

  const { ranking, me } = await api(path);

  if (!ranking.length) {
    $('#ranking-list').innerHTML =
      '<li class="rank-me">아직 기록이 없습니다. 오늘의 미션을 먼저 해 보세요.</li>';
    $('#ranking-me').textContent = '';
    return;
  }

  $('#ranking-list').innerHTML = ranking
    .map(
      (row) => `<li class="rank-row${row.userId === state.user.id ? ' is-me' : ''}">
        <span class="rank-no">${row.rank}</span>
        <span class="rank-name">${esc(row.displayName)}</span>
        <span class="rank-points">${row.points.toLocaleString('ko-KR')}점</span>
      </li>`,
    )
    .join('');

  $('#ranking-me').textContent = me.rank
    ? `내 순위 ${me.rank}위 · ${me.points.toLocaleString('ko-KR')}점`
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
  const maxDay = Math.max(1, ...me.activity.map((a) => a.points));
  const strip = me.activity
    .map((a) => {
      const level = a.points === 0 ? 0 : a.points >= maxDay * 0.66 ? 3 : a.points >= maxDay * 0.33 ? 2 : 1;
      return `<span class="activity-cell" data-level="${level}" title="${a.day} · ${a.points}점"></span>`;
    })
    .join('');

  $('#me-summary').innerHTML = `
    <h2 class="me-name">${esc(me.user.displayName)}</h2>
    <div class="stat-grid">
      <div class="stat"><div class="stat-value">${s.totalPoints.toLocaleString('ko-KR')}</div><div class="stat-label">점수</div></div>
      <div class="stat"><div class="stat-value">${s.streak}</div><div class="stat-label">연속일</div></div>
      <div class="stat"><div class="stat-value">${s.missionsCompleted}</div><div class="stat-label">완료 미션</div></div>
      <div class="stat"><div class="stat-value">${s.poemsRead}</div><div class="stat-label">읽은 시</div></div>
      <div class="stat"><div class="stat-value">${board.earnedCount}</div><div class="stat-label">도전과제</div></div>
    </div>
    <div class="activity-strip">${strip}</div>`;

  $('#challenge-board').innerHTML = board.groups
    .map(
      (group) => `<section>
        <h3 class="challenge-group-name">${esc(group.name)}</h3>
        <div class="challenge-grid">${group.items.map(challengeHtml).join('')}</div>
      </section>`,
    )
    .join('');

  renderPushPanel(push);
}

function challengeHtml(c) {
  const bar =
    !c.earned && c.progress?.target
      ? `<div class="challenge-bar"><i style="width:${Math.round(c.progress.ratio * 100)}%"></i></div>
         <div class="challenge-desc">${c.progress.current} / ${c.progress.target}</div>`
      : '';
  return `<div class="challenge${c.earned ? ' is-earned' : ''}">
    <span class="challenge-icon">${c.icon}</span>
    <span class="challenge-title">${esc(c.title)}</span>
    <span class="challenge-desc">${esc(c.description)}</span>
    ${bar}
  </div>`;
}

// ───────── 웹푸시 ─────────
function renderPushPanel(push) {
  if (!push.configured) {
    $('#push-panel').innerHTML = `<p class="push-note">
      이 서버에는 아직 웹푸시 키(VAPID)가 설정되지 않아 알림을 보낼 수 없습니다.<br />
      <code>npm run keys</code> 로 키를 만들어 <code>.env</code> 에 넣고 서버를 다시 시작하세요.</p>`;
    return;
  }

  const supported = 'serviceWorker' in navigator && 'PushManager' in window;
  const p = push.prefs;

  $('#push-panel').innerHTML = `
    <div class="switch-row">
      <span>이 기기에서 알림 받기</span>
      <button class="btn" id="push-toggle">${push.devices > 0 ? '해제' : '켜기'}</button>
    </div>
    <label class="switch-row"><span>오늘의 시 알림</span>
      <input type="checkbox" data-pref="poemPush" ${p.poemPush ? 'checked' : ''} /></label>
    <label class="switch-row"><span>미션 발행 알림</span>
      <input type="checkbox" data-pref="missionPush" ${p.missionPush ? 'checked' : ''} /></label>
    <label class="switch-row"><span>도전과제 달성 알림</span>
      <input type="checkbox" data-pref="challengePush" ${p.challengePush ? 'checked' : ''} /></label>
    <div class="switch-row"><span>방해 금지</span>
      <span style="display:flex;gap:6px;align-items:center">
        <input type="number" min="0" max="23" data-pref="quietStart" value="${p.quietStart ?? ''}" placeholder="22" style="width:66px" />
        <span class="muted">시 ~</span>
        <input type="number" min="0" max="23" data-pref="quietEnd" value="${p.quietEnd ?? ''}" placeholder="7" style="width:66px" />
        <span class="muted">시</span>
      </span></div>
    <p class="push-note">
      ${supported
        ? `연결된 기기 ${push.devices}대. 알림은 브라우저를 닫아도 도착합니다.`
        : '이 브라우저는 웹푸시를 지원하지 않습니다. iOS 는 홈 화면에 추가한 뒤에 쓸 수 있습니다.'}
    </p>
    ${push.devices > 0 ? '<button class="btn btn-ghost" id="push-test">시험 삼아 하나 보내 보기</button>' : ''}`;

  $('#push-toggle').addEventListener('click', () =>
    push.devices > 0 ? disablePush() : enablePush(push.publicKey),
  );
  $('#push-test')?.addEventListener('click', async () => {
    const res = await api('/me/push/test', { method: 'POST' });
    toast(res.sent ? '알림을 보냈습니다.' : `보내지 못했습니다 (${res.skipped ?? '알 수 없음'}).`);
  });

  $$('[data-pref]', $('#push-panel')).forEach((input) =>
    input.addEventListener('change', async () => {
      const value =
        input.type === 'checkbox' ? input.checked : input.value === '' ? null : Number(input.value);
      await api('/me/push/prefs', { method: 'PUT', body: { [input.dataset.pref]: value } });
      toast('알림 설정을 저장했습니다.');
    }),
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function enablePush(publicKey) {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('이 브라우저는 알림을 지원하지 않습니다.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      toast('브라우저에서 알림을 허용해 주세요.');
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await api('/me/push/subscribe', { method: 'POST', body: { subscription } });
    toast('이 기기로 알림을 보내겠습니다.', { star: true });
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
  toast('이 기기의 알림을 껐습니다.');
  loadMe();
}

// ───────── 시작 ─────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

try {
  const { user } = await api('/auth/me');
  await enterApp(user);
} catch {
  showGate();
}
