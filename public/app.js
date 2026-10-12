/* 별 헤는 밤 — 프런트엔드
   빌드 도구 없이 도는 표준 ES 모듈입니다.
   공용 도우미는 core.js, 「동주의 길」은 journey.js 에 있습니다. */

import {
  $, $$, esc, icon, mascot, num, api, toast,
  poemBodyHtml, poemHtml, formatWritten, euroRo, iGa, guarded,
} from './core.js';
import { mountJourney, loadJourney } from './journey.js';
import { mountTranscribe, openTranscribe, layout } from './transcribe.js';
import { mountExam, loadExamCard } from './exam.js';

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
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
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
  try {
    await api('/auth/logout', { method: 'POST' });
  } catch (err) {
    toast(err.message);
    return;
  }
  state.eventSource?.close();
  // 오프라인용으로 받아 둔 시집 응답에는 '읽음' 표시가 섞여 있다. 같은 기기를
  // 다른 사람이 쓸 수 있으니 나갈 때 비운다.
  try {
    await caches.delete('byeol-poems');
  } catch {
    // 캐시를 못 쓰는 브라우저 — 비울 것도 없다.
  }
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
  mountJourney({ onPoints: refreshPills, onTranscribe: openTranscribe });
  mountExam({ onPoints: refreshPills });
  addEventListener('journey:changed', () => {
    if (document.body.dataset.view === 'path') loadExamCard();
  });
  mountTranscribe({ onSave: () => { refreshPills(); if (document.body.dataset.view === 'me') loadMe(); } });
  // 하나가 실패해도 나머지는 뜬다. 예전에는 셋 중 하나만 실패해도 앱에 들어가지 못했다.
  await Promise.all([
    guarded(loadToday, { into: 'section[data-view="today"]' }),
    guarded(loadJourney, { into: 'section[data-view="path"]' }),
    guarded(loadRooms, { into: 'section[data-view="room"]' }),
  ]);
  switchView(location.hash.slice(1) || 'path');
}

// ───────── 화면 전환 ─────────
function switchView(name) {
  const views = $$('.view');
  const target = views.some((v) => v.dataset.view === name) ? name : 'path';

  for (const v of views) v.hidden = v.dataset.view !== target;
  document.body.dataset.view = target; // 토스트 위치가 화면마다 달라집니다
  for (const t of $$('.tab')) {
    if (t.dataset.view === target) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  }
  if (location.hash.slice(1) !== target) history.replaceState(null, '', `#${target}`);

  // 화면마다 실패하면 그 자리에 이유와 '다시 시도' 가 뜬다. 빈 화면으로 두지 않는다.
  const into = `section[data-view="${target}"]`;
  if (target === 'path') {
    guarded(loadJourney, { into });
    guarded(loadExamCard, { into: '#exam-card' });
  }
  if (target === 'library') guarded(loadLibrary, { into });
  if (target === 'room') guarded(renderRoomView, { into });
  if (target === 'ranking') guarded(loadRanking, { into });
  if (target === 'me') guarded(loadMe, { into });
}

for (const tab of $$('.tab')) tab.addEventListener('click', () => switchView(tab.dataset.view));
addEventListener('hashchange', () => switchView(location.hash.slice(1) || 'path'));

// ───────── 오늘 ─────────
async function loadToday() {
  state.today = await api('/missions/today');
  renderToday();
}

/** 상단 알약. 길에서 점수가 오르면 레슨 화면에서도 이걸 부릅니다. */
function renderPills(stats) {
  // 쉼표는 연속 옆에 작게. 하루를 쉬어도 이어진다는 것을 미리 알고 있어야
  // 하루 빠진 날 '이제 다 끝났다' 고 앱을 지우지 않는다.
  const freeze = stats.freezes ? ` · 쉼표 ${stats.freezes}` : '';
  $('#streak-pill').innerHTML =
    stats.streak > 0 ? `${icon('flame')}${stats.streak}일${freeze}` : `${icon('flame')}오늘 시작`;
  $('#streak-pill').setAttribute(
    'aria-label',
    stats.streak > 0
      ? `연속 ${stats.streak}일${stats.freezes ? `, 쉼표 ${stats.freezes}개 — 하루를 쉬어도 이어집니다` : ''}`
      : '오늘 시작',
  );
  $('#points-pill').innerHTML = `${icon('star')}${num(stats.totalPoints)}`;
}

/** 레슨에서 점수를 받으면 서버에서 다시 읽어 알약을 고칩니다. */
async function refreshPills() {
  try {
    const me = await api('/me');
    renderPills(me.stats);
    if (state.today) state.today.stats = { ...state.today.stats, ...me.stats };
  } catch {
    // 알약이 한 박자 늦는 것은 치명적이지 않습니다. 조용히 넘어갑니다.
  }
}

function renderToday() {
  const { poem, missions, stats } = state.today;

  renderPills(stats);

  $('#today-poem').innerHTML = poemHtml(poem);
  $('#today-note').innerHTML = readingNoteHtml(poem);
  $('#mission-list').innerHTML = missions.map(missionHtml).join('');

  const left = missions.filter((m) => !m.completed).length;
  $('#today-left').textContent = left ? `${left}개 남음` : '다 했습니다';
  // 지도에 남은 한 줄. 무엇이 오늘의 시인지, 해 볼 것이 몇 개 남았는지만.
  $('#today-link-sub').innerHTML = `「${esc(poem.title)}」 · ${left ? `해 볼 것 ${left}개` : '다 했습니다'}`;

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

/**
 * 원고지에 놓이는 것은 시뿐입니다.
 * 연은 배열이고, 연 안의 행은 시인이 나눈 그대로 줄바꿈으로 남습니다.
 */

/**
 * 해설과 주제어. 시가 놓인 종이가 아니라 그 곁에 적힙니다.
 * 해설은 사실 진술이 아니라 이 앱이 쓴 읽기 안내입니다.
 */
function readingNoteHtml(poem) {
  const tags = (poem.themes || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
  return `${
    poem.note ? `<h3>읽기 도움말</h3><p>${esc(poem.note)}</p>` : ''
  }<div class="tag-row">${tags}</div>`;
}

/**
 * 창작 시기를 사람이 읽는 꼴로 바꿉니다.
 *
 * 달력에 없는 날짜(예: 9월 31일)는 날짜를 떼고 연·월까지만 보여 줍니다.
 * 시 본문과 창작 시기는 아직 정본 대조 전이라, 확인되지 않은 값을
 * 사실인 것처럼 내보내지 않기 위해서입니다.
 * 어떤 항목이 이에 해당하는지는 `npm run content:check` 가 알려 줍니다.
 */

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
        counter.style.color = length >= min ? 'var(--ok)' : '';
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
const library = { data: null, q: '', filter: 'all' };

async function loadLibrary() {
  library.data = await api('/poems');
  const d = library.data;
  $('#library-count').textContent = `${d.readCount} / ${d.total}편 읽음`;
  renderLibrary();
}

/** 띄어쓰기·문장부호를 걷어 내고 비교한다. "별헤는" 으로도 「별 헤는 밤」이 나온다. */
const squash = (t) => String(t).toLowerCase().replace(/[\s.,!?…·—\-:;"'“”‘’「」『』()]/gu, '');

function renderLibrary() {
  const d = library.data;
  if (!d) return;
  const q = squash(library.q);
  const pass = (p) =>
    library.filter === 'unread' ? !p.read : library.filter === 'transcribed' ? p.transcribed : true;

  const rows = d.poems
    .filter(pass)
    .map((p) => {
      if (!q) return { p, hit: null };
      if (squash(p.title).includes(q)) return { p, hit: null };
      const hit = p.lines.find((l) => squash(l).includes(q));
      return hit ? { p, hit } : null;
    })
    .filter(Boolean);

  const empty = $('#library-empty');
  empty.hidden = rows.length > 0;
  empty.textContent = q
    ? `"${library.q}"${iGa(library.q)} 든 시가 없습니다. 띄어쓰기는 상관없습니다 — 낱말을 줄여 보세요.`
    : library.filter === 'transcribed'
      ? '아직 옮겨 적은 시가 없습니다. 시를 펼쳐 \'옮겨 적기\' 를 눌러 보세요.'
      : '모두 읽었습니다.';

  const rowHtml = ({ p, hit }) => `<button class="poem-row" data-poem="${esc(p.id)}" data-read="${p.read}">
      ${icon(p.transcribed ? 'pen' : 'star', p.read ? 'icon-solid' : '')}
      <span>
        <span class="poem-row-title">${esc(p.title)}</span>
        <span class="poem-row-sub">${
          hit ? `<span class="poem-row-hit">${esc(hit)}</span>` : esc(formatWritten(p.written))
        }${p.transcribed ? ' · 옮겨 적음' : ''}</span>
      </span>
    </button>`;

  // 장마다 묶는다. 길의 장과 같은 이름이라 '어디까지 왔는지' 와 이어진다.
  const groups = d.chapters
    .map((c) => ({ c, items: rows.filter((r) => r.p.chapterId === c.id) }))
    .filter((g) => g.items.length);
  const loose = rows.filter((r) => !r.p.chapterId);
  $('#poem-index').innerHTML =
    groups
      .map(
        (g) => `<section class="library-group">
          <h3 class="library-group-h">${esc(g.c.place)} <span>${esc(g.c.hint)} · ${num(g.items.length)}편</span></h3>
          ${g.items.map(rowHtml).join('')}
        </section>`,
      )
      .join('') + loose.map(rowHtml).join('');

  for (const btn of $$('.poem-row')) {
    btn.addEventListener('click', () => openPoem(btn.dataset.poem));
  }
}

$('#library-q').addEventListener('input', (e) => {
  library.q = e.target.value;
  renderLibrary();
});
for (const btn of $$('#library-filter button')) {
  btn.addEventListener('click', () => {
    for (const b of $$('#library-filter button')) b.setAttribute('aria-selected', String(b === btn));
    library.filter = btn.dataset.filter;
    renderLibrary();
  });
}

async function openPoem(poemId) {
  const { poem } = await api(`/poems/${poemId}`);
  state.openPoem = poem;
  $('#poem-dialog-body').innerHTML =
    `<div class="manuscript is-sheet">${poemHtml(poem)}</div>` +
    `<aside class="reading-note is-inset">${readingNoteHtml(poem)}</aside>`;
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

$('#poem-transcribe').addEventListener('click', () => {
  if (!state.openPoem) return;
  $('#poem-dialog').close();
  openTranscribe(state.openPoem);
});

// ───────── 방 ─────────
async function loadRooms() {
  const { rooms } = await api('/rooms');
  state.rooms = rooms;
  if (!rooms.some((r) => r.id === state.activeRoomId)) state.activeRoomId = rooms[0]?.id ?? null;
}

async function renderRoomView() {
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

  return openRoom(state.activeRoomId);
}

$('#room-picker').addEventListener('change', (e) => {
  state.activeRoomId = Number(e.target.value);
  guarded(() => openRoom(state.activeRoomId), { into: 'section[data-view="room"]' });
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
  const { messages, isOwner, reportReasons } = await api(`/rooms/${roomId}/messages?limit=60`);
  state.messages = messages;
  state.roomOwner = Boolean(isOwner);
  state.reportReasons = reportReasons || [];
  $('#room-progress-btn').hidden = !state.roomOwner;
  renderMessages();
  connectStream(roomId);
}

/** 가리기·되돌리기는 보는 사람마다 결과가 다르므로(선생님은 원문, 나머지는 빈 자리) 서버에서 다시 받는다. */
async function refetchMessages() {
  const { messages } = await api(`/rooms/${state.activeRoomId}/messages?limit=60`);
  state.messages = messages;
  renderMessages({ keepScroll: true });
}

function connectStream(roomId) {
  state.eventSource?.close();
  const source = new EventSource(`/api/rooms/${roomId}/stream`);
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === 'message') {
      state.messages.push(payload.message);
      renderMessages();
    } else if (payload.type === 'hidden' || payload.type === 'unhidden') {
      refetchMessages();
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

  for (const btn of $$('.msg-more', log)) {
    btn.addEventListener('click', () => openMessageActions(Number(btn.dataset.message)));
  }

  if (!keepScroll || atBottom) log.scrollTop = log.scrollHeight;
}

// ── 글 하나에 대해: 신고 · 차단 · (선생님) 가리기 ──
function openMessageActions(messageId) {
  const msg = state.messages.find((m) => m.id === messageId);
  if (!msg) return;
  state.actionMessage = msg;
  $('#msg-dialog-quote').textContent = msg.body ? msg.body.slice(0, 120) : '(가려진 글)';
  $('#msg-dialog-owner').hidden = !state.roomOwner;
  $('#msg-hide').textContent = msg.hidden ? '가린 것을 되돌리기' : '이 글 가리기';
  const mine = msg.userId === state.user?.id;
  $('#msg-report').hidden = mine;
  $('#msg-block').hidden = mine;
  $('#msg-reasons').innerHTML = state.reportReasons
    .map((r) => `<button class="btn btn-sm" type="button" data-reason="${esc(r)}">${esc(r)}</button>`)
    .join('');
  $('#msg-dialog').showModal();
}

$('#msg-reasons').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-reason]');
  if (!btn) return;
  const msg = state.actionMessage;
  try {
    const { hidden } = await api(`/rooms/${state.activeRoomId}/messages/${msg.id}/report`, {
      method: 'POST',
      body: { reason: btn.dataset.reason },
    });
    $('#msg-dialog').close();
    toast(hidden ? '신고했습니다. 신고가 쌓여 글이 가려졌습니다.' : '신고했습니다. 누가 신고했는지는 보이지 않습니다.');
  } catch (err) {
    toast(err.message);
  }
});

$('#msg-hide').addEventListener('click', async () => {
  const msg = state.actionMessage;
  try {
    await api(`/rooms/${state.activeRoomId}/messages/${msg.id}/hide`, {
      method: 'POST',
      body: { hidden: !msg.hidden },
    });
    $('#msg-dialog').close();
  } catch (err) {
    toast(err.message);
  }
});

$('#msg-block').addEventListener('click', async () => {
  const msg = state.actionMessage;
  try {
    await api('/me/blocks', { method: 'POST', body: { userId: msg.userId } });
    $('#msg-dialog').close();
    toast(`${msg.authorName} 님을 차단했습니다. 「나」에서 풀 수 있습니다.`);
    refetchMessages();
  } catch (err) {
    toast(err.message);
  }
});

// ── 선생님 보기 ──
$('#room-progress-btn').addEventListener('click', async () => {
  let data;
  try {
    data = await api(`/rooms/${state.activeRoomId}/progress`);
  } catch (err) {
    toast(err.message);
    return;
  }
  const { summary, members } = data;
  $('#progress-summary').textContent =
    `${num(summary.count)}명 · 오늘 목표를 채운 사람 ${num(summary.metToday)}명 · 멈춘 사람 ${num(summary.stalled)}명`;
  $('#progress-list').innerHTML = members
    .map((m) => {
      const idle = m.lastActive === null ? '아직 시작 전' : m.idleDays === 0 ? '오늘' : `${num(m.idleDays)}일 전`;
      return `<li class="progress-row" data-stalled="${m.stalled}">
        <div class="progress-name">${esc(m.name)}${m.role === 'owner' ? ' <span class="muted">· 방장</span>' : ''}${
          m.stalled ? ' <span class="pill-stall">멈춤</span>' : ''
        }</div>
        <div class="progress-nums">
          <span>마디 ${num(m.nodesDone)} / ${num(m.totalNodes)}</span>
          <span>연속 ${num(m.streak)}일</span>
          <span>필사 ${num(m.transcribed)}편</span>
          <span>오답 ${num(m.openMistakes)}</span>
          <span>마지막 ${idle}</span>
        </div>
      </li>`;
    })
    .join('');
  $('#progress-dialog').showModal();
});

// ── 방에 나누기 ──
function openShare(type, id, preview) {
  if (!state.rooms.length) {
    toast('방에 들어가면 나눌 수 있습니다.');
    return;
  }
  state.sharing = { type, id };
  $('#share-preview').textContent = preview.slice(0, 160);
  $('#share-room').innerHTML = state.rooms
    .map((r) => `<option value="${r.id}" ${r.id === state.activeRoomId ? 'selected' : ''}>${esc(r.name)}</option>`)
    .join('');
  $('#share-dialog').showModal();
}

$('#share-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const roomId = Number($('#share-room').value);
  try {
    await api(`/rooms/${roomId}/share`, { method: 'POST', body: state.sharing });
    $('#share-dialog').close();
    toast('방에 나눴습니다.');
  } catch (err) {
    toast(err.message);
  }
});

const BOT_ICON = { poem: 'book', mission: 'check', challenge: 'star', notice: 'info' };

function messageHtml(msg) {
  const isBot = msg.authorType === 'bot';
  const isMine = !isBot && msg.userId === state.user?.id;

  // 가린 글. 원문이 빈 채로 왔으면 자리만 남긴다. 선생님과 글쓴이에게는 원문이
  // 오고, 가려졌다는 표시를 붙인다.
  if (msg.hidden && !msg.body) {
    return `<div class="msg is-hidden" data-mine="${isMine}">
      <div class="msg-bubble">가려진 글입니다.</div>
    </div>`;
  }

  const SOURCE = { response: '한 줄 감상', transcription: '원고지 필사' };
  const shareTag =
    msg.kind === 'share' && msg.meta?.poemTitle
      ? `<span class="share-tag">「${esc(msg.meta.poemTitle)}」 · ${esc(
          SOURCE[msg.meta.source] || msg.meta.missionTitle || '감상',
        )}</span>`
      : '';
  const hiddenTag = msg.hidden
    ? `<span class="hidden-tag">가려진 글 — ${state.roomOwner ? '방장' : '글쓴이'}에게만 보입니다</span>`
    : '';
  const more = isBot
    ? ''
    : `<button class="icon-btn msg-more" type="button" data-message="${msg.id}" aria-label="이 글에 대해">${icon('more')}</button>`;

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

  return `<div class="msg" data-kind="${esc(msg.kind)}" data-bot="${isBot}" data-mine="${isMine}" data-source="${esc(msg.meta?.source || '')}" data-hidden="${Boolean(msg.hidden)}">
    ${isBot || isMine ? '' : `<span class="msg-author">${esc(msg.authorName)}</span>`}
    <div class="msg-bubble">${isBot ? icon(BOT_ICON[msg.kind] || 'info') : ''}${hiddenTag}${shareTag}<span>${esc(
      msg.body,
    )}</span></div>
    <div class="msg-foot">${msg.hidden ? '' : cheers}${more}</div>
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

async function loadLeague() {
  let t;
  try {
    t = await api('/ranking/league');
  } catch {
    return;
  }
  const l = t.league;
  const ends = new Date(`${l.weekEnds}T00:00:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });
  $('#league-week').textContent = `${ends}까지`;

  // 등급 사다리. 지금 자리와 다음 자리만 또렷하게.
  const ladder = ['한 줄', '한 연', '한 편', '시집']
    .map((name, i) => `<li data-state="${i < l.tierIndex ? 'past' : i === l.tierIndex ? 'here' : 'ahead'}">${name}</li>`)
    .join('');

  const status = l.top
    ? '맨 위 등급입니다. 더 올라갈 곳은 없고, 내려가는 일도 없습니다.'
    : l.promotesNextWeek
      ? `이번 주 문턱을 넘었습니다. 다음 주에 「${esc(l.next.name)}」${euroRo(l.next.name)} 올라갑니다.`
      : `「${esc(l.next.name)}」까지 이번 주 <b>${num(l.remaining)}점</b> 남았습니다.`;

  const rows = t.rows
    .map(
      (r) => `<li class="rank-row" data-me="${r.me}">
        <span class="rank-no">${r.rank}</span>
        <span>${r.me ? '나' : esc(r.name ?? '')}</span>
        <span class="rank-points">${num(r.points)}</span>
      </li>`,
    )
    .join('');

  $('#league').innerHTML = `
    <ol class="league-ladder" aria-label="등급">${ladder}</ol>
    <p class="league-status">${status}</p>
    ${
      l.top
        ? ''
        : `<div class="meter meter-lg" role="progressbar" aria-label="이번 주 문턱까지" aria-valuemin="0" aria-valuemax="${l.threshold}" aria-valuenow="${l.points}"><i style="--fill:${Math.min(1, l.points / l.threshold).toFixed(3)}"></i></div>`
    }
    <p class="note">내려가는 일은 없습니다. 한 주를 쉬어도 등급은 그대로입니다.</p>
    <h3 class="league-sub">「${esc(l.tier.name)}」에 있는 ${num(t.size)}명</h3>
    <ol class="rank-list">${rows}</ol>`;
}

async function loadRanking() {
  loadLeague();
  const { scope, period } = state.ranking;
  const useRoom = scope === 'room' && state.activeRoomId;
  const { ranking, me } = await api(
    useRoom ? `/rooms/${state.activeRoomId}/ranking?period=${period}` : `/ranking?period=${period}`,
  );

  if (!ranking.length) {
    $('#rank-list').innerHTML =
      '<li class="rank-me-note">아직 기록이 없습니다. 길을 한 마디 걸어 보세요.</li>';
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
  const [me, board, push, journey, trs, lines] = await Promise.all([
    api('/me'),
    api('/me/challenges'),
    api('/me/push'),
    api('/journey'),
    api('/transcriptions'),
    api('/journey/responses'),
  ]);
  renderWalked(journey);
  renderGallery(trs.transcriptions);
  renderMyLines(lines.responses);
  renderBlocks();

  const s = me.stats;
  // 표식은 여기에 두지 않습니다. 첫 화면 대기와 하루 완료에서는 표식이
  // 할 일이 있지만(기다리는 동안 볼 것, 끝냈다는 표시), 이 줄에서는 이름
  // 옆에 아무 일도 하지 않는 그림이 하나 붙을 뿐이었습니다.
  $('#me-head').innerHTML = `
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
  if (me.goal?.goal) $('#goal-select').value = String(me.goal.goal);
}

$('#goal-select').addEventListener('change', async (e) => {
  try {
    await api('/me/goal', { method: 'PUT', body: { goal: Number(e.target.value) } });
    toast('하루 목표를 바꿨습니다.');
  } catch (err) {
    toast(err.message);
  }
});

/** 걸어온 길 — 장마다 몇 마디를 걸었는지. 아직 걷지 않은 장도 길 위에 그대로 둡니다. */
function renderWalked(journey) {
  $('#walked-count').textContent = `${num(journey.doneCount)} / ${num(journey.total)} 마디`;
  $('#walked').innerHTML = journey.chapters
    .map((c) => {
      const state = c.empty ? 'empty' : c.doneCount === c.total ? 'done' : c.doneCount ? 'walking' : 'ahead';
      return `<div class="walked-step" data-state="${state}">
        <span class="walked-dot" aria-hidden="true"></span>
        <span class="walked-place">${esc(c.place)}</span>
        <span class="walked-n">${c.empty ? '시 없음' : `${c.doneCount} / ${c.total}`}</span>
      </div>`;
    })
    .join('');
}

/** 필사 갤러리 — 원고지 한 장을 작게. 앞 서른 칸만 보입니다. */
function renderGallery(items) {
  const poems = new Set(items.map((t) => t.poemId)).size;
  $('#gallery-count').textContent = items.length ? `${num(poems)}편 · ${num(items.length)}장` : '';
  if (!items.length) {
    $('#gallery').innerHTML = `<p class="note">아직 옮겨 적은 시가 없습니다. 시집에서 시를 펼치고 '옮겨 적기'를 누르면 여기에 원고지가 한 장씩 쌓입니다.</p>`;
    return;
  }
  $('#gallery').innerHTML = items
    .map((t) => {
      const rows = layout(t.text, 6).slice(0, 5);
      while (rows.length < 5) rows.push([]);
      const grid = rows
        .map((r) => {
          const cells = [];
          for (let i = 0; i < 6; i++) cells.push(`<span>${r[i] ? esc(r[i]) : ''}</span>`);
          return cells.join('');
        })
        .join('');
      const day = new Date(t.createdAt).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
      return `<figure class="sheet-card">
        <div class="sheet-mini" aria-hidden="true">${grid}</div>
        <figcaption><b>「${esc(t.title)}」</b><span>${esc(day)} · ${num(t.chars)}자</span></figcaption>
        <button class="btn btn-quiet btn-sm" type="button" data-share="transcription" data-id="${t.id}">방에 나누기</button>
      </figure>`;
    })
    .join('');
  bindShareButtons('#gallery', items);
}

async function renderBlocks() {
  let blocks = [];
  try {
    ({ blocks } = await api('/me/blocks'));
  } catch {
    return;
  }
  $('#blocks-section').hidden = !blocks.length;
  $('#blocks-list').innerHTML = blocks
    .map(
      (b) => `<li class="switch-row"><span>${esc(b.name)}</span>
        <button class="btn btn-sm" type="button" data-unblock="${b.id}">차단 풀기</button></li>`,
    )
    .join('');
  for (const btn of $$('#blocks-list [data-unblock]')) {
    btn.addEventListener('click', async () => {
      await api(`/me/blocks/${btn.dataset.unblock}`, { method: 'DELETE' });
      renderBlocks();
    });
  }
}

function bindShareButtons(root, items) {
  for (const btn of $$(`${root} [data-share]`)) {
    btn.addEventListener('click', () => {
      const item = items.find((x) => x.id === Number(btn.dataset.id));
      openShare(btn.dataset.share, Number(btn.dataset.id), item?.text ?? '');
    });
  }
}

/** 레슨 끝에 남긴 한 줄 감상들. 채팅으로 흘러가지 않고 여기 남습니다. */
function renderMyLines(items) {
  if (!items.length) {
    $('#my-lines').innerHTML = `<p class="note">길을 걸으면 마디마다 한 줄씩 남습니다.</p>`;
    return;
  }
  $('#my-lines').innerHTML = items
    .slice(0, 12)
    .map(
      (r) => `<blockquote class="my-line"><p>${esc(r.text)}</p>
        <footer><cite>「${esc(r.title)}」</cite>
        <button class="btn btn-quiet btn-sm" type="button" data-share="response" data-id="${r.id}">방에 나누기</button></footer>
      </blockquote>`,
    )
    .join('');
  bindShareButtons('#my-lines', items);
}

function challengeHtml(c) {
  const meter =
    !c.earned && c.progress?.target
      ? `<div class="meter"><i style="--fill:${(c.progress.ratio ?? 0).toFixed(3)}"></i></div>
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
    // 학생에게 npm 명령과 .env 를 말하던 자리입니다. 그 말을 들어야 할 사람은
    // 서버를 띄운 사람이므로, 화면에는 지금 쓸 수 없다는 것만 적고 고치는 법은
    // 개발자 도구 콘솔에 남깁니다.
    $('#push-panel').innerHTML = `<p class="note">
      지금은 알림을 켤 수 없습니다. 이 앱을 운영하는 쪽에서 알림 설정을 마치면 여기서 켤 수 있습니다.</p>`;
    console.info('[별 헤는 밤] 웹푸시 키(VAPID)가 없습니다. npm run keys 로 만들어 .env 에 넣고 서버를 다시 시작하세요.');
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

// ───────── 연결 상태 ─────────
// 끊기면 맨 위에 한 줄. 무엇이 되고 무엇이 안 되는지를 말한다.
function renderConnection() {
  $('#offline-bar').hidden = navigator.onLine !== false;
}
addEventListener('online', () => {
  renderConnection();
  // 돌아오면 지금 화면을 다시 불러온다. 실패 칸이 떠 있었으면 그것도 지워진다.
  if (state.user) switchView(document.body.dataset.view || 'path');
});
addEventListener('offline', renderConnection);
renderConnection();

// 마지막 그물. 화면 어딘가에서 처리하지 못한 오류가 학생에게 영어로 뜨거나
// 조용히 묻히지 않게, 같은 말은 한 번만 한국어로 알린다. 콘솔에는 그대로 남긴다.
const told = new Set();
addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.offline ? e.reason.message : '문제가 생겼습니다. 화면을 새로 고쳐 주세요.';
  console.error(e.reason);
  e.preventDefault();
  if (told.has(msg)) return;
  told.add(msg);
  setTimeout(() => told.delete(msg), 8000);
  toast(msg);
});

// ───────── 계정 지우기 ─────────
$('#delete-account-btn').addEventListener('click', () => {
  $('#delete-handle').textContent = state.user.handle;
  $('#delete-form').reset();
  $('#delete-error').textContent = '';
  $('#delete-form button[type=submit]').disabled = true;
  $('#delete-dialog').showModal();
});
// 아이디가 맞을 때만 버튼이 켜진다. 누르다 지우는 일을 막는다.
$('#delete-form [name=confirm]').addEventListener('input', (e) => {
  $('#delete-form button[type=submit]').disabled = e.target.value.trim() !== state.user.handle;
});
$('#delete-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/me', { method: 'DELETE', body: { confirmHandle: e.target.confirm.value } });
  } catch (err) {
    $('#delete-error').textContent = err.message;
    return;
  }
  state.eventSource?.close();
  try {
    await caches.delete('byeol-poems');
  } catch {
    // 캐시를 못 쓰는 브라우저 — 비울 것도 없다.
  }
  location.replace('/');
});
