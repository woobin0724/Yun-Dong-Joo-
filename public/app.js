/* 별 헤는 밤 — 프런트엔드
   빌드 도구 없이 도는 표준 ES 모듈입니다.
   화면마다 파일이 따로 있습니다:
     core.js 공용 도우미 · shared.js 공용 상태 · journey.js 길과 레슨
     transcribe.js 원고지 필사 · exam.js 시험 대비 · room.js 방
     ranking.js 랭킹·리그 · me.js 「나」
   이 파일에는 로그인, 화면 전환, 오늘의 시, 시집, 테마, 시작이 남아 있습니다. */

import {
  $, $$, esc, icon, mascot, num, api, toast,
  poemBodyHtml, poemHtml, formatWritten, euroRo, iGa, guarded,
} from './core.js';
import { mountJourney, loadJourney } from './journey.js';
import { mountTranscribe, openTranscribe, layout } from './transcribe.js';
import { mountExam, loadExamCard } from './exam.js';
import { state, challengeToast } from './shared.js';
import { loadRooms, renderRoomView } from './room.js';
import { loadRanking } from './ranking.js';
import { loadMe } from './me.js';


// 미션 갈래별 아이콘
const KIND_ICON = { check: 'speak', text: 'pen', quiz: 'quiz' };
const KIND_LABEL = { check: '낭독', text: '쓰기', quiz: '퀴즈' };



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
  if (target === 'today' && state.today?.poem) {
    const id = state.today.poem.id;
    clearTimeout(state.todayReadTimer);
    state.todayReadTimer = setTimeout(() => {
      if (document.body.dataset.view === 'today') markPoemRead(id);
    }, dwellMsFor(state.today.poem) / 2);
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
      }</p>` +
      // 방금 함께 받은 도전과제는 토스트가 아니라 여기에 적는다. 토스트는 이 칸을
      // 덮었고, 말하는 것도 이 칸과 같았다(진단 5번).
      (state.justEarned?.length
        ? `<p class="day-done-earned">함께 받은 도전과제 — ${state.justEarned.map((c) => esc(c.title)).join(', ')}</p>`
        : '');
  }

  bindMissions();
  // 여기서 '읽음' 을 찍지 않는다. renderToday 는 앱을 열 때 불리므로, 여기서 찍으면
  // 시를 펴 보지도 않았는데 읽은 것이 됐다(진단 10번). 오늘의 시 화면을 실제로 열 때
  // switchView 가 찍는다.
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
    // '읽었습니다' 를 누르기만 하면 +20 이던 것(진단 3번)을 막는다. 오늘의 시를 실제로
    // 펴 둔 시간만큼 기다려야 켜진다. 화면을 떠나거나 앱을 내리면 시간도 멈춘다.
    // 서버가 시간을 재지 않는 이유는 길의 '천천히 읽기' 와 같다 — 느린 네트워크에서
    // 제대로 읽은 사람이 손해를 본다.
    controls = mission.completed
      ? ''
      : `<div class="mission-actions">
        <button class="btn btn-primary" data-act="check" disabled>${icon('check')}읽었습니다</button>
        <span class="mission-hint" data-dwell-left></span>
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
    armDwell(card);
    $('[data-act="text"]', card)?.addEventListener('click', () =>
      submit(card, id, { text: input?.value ?? '' }),
    );
    $('[data-act="quiz"]', card)?.addEventListener('click', () => {
      const picked = $('.choice[aria-pressed="true"]', card);
      if (picked) submit(card, id, { answer: Number(picked.dataset.choice) });
    });
  }
}

/** 시 길이에 맞춘 읽는 시간. 짧은 시도 8초, 긴 시도 45초를 넘지 않는다. */
function dwellMsFor(poem) {
  const chars = poem ? poem.stanzas.flat().join('').length : 200;
  return Math.min(45000, Math.max(8000, chars * 110));
}

let dwellTimer = null;
function armDwell(card) {
  const btn = $('[data-act="check"]', card);
  const left = $('[data-dwell-left]', card);
  if (!btn || !left) return;
  let remaining = state.dwellLeft ?? dwellMsFor(state.today?.poem);
  clearInterval(dwellTimer);
  const tick = () => {
    // 오늘의 시 화면을 보고 있고, 앱이 앞에 나와 있을 때만 시간이 간다.
    const reading = document.body.dataset.view === 'today' && document.visibilityState === 'visible';
    if (reading) remaining -= 500;
    state.dwellLeft = Math.max(0, remaining);
    if (remaining <= 0) {
      clearInterval(dwellTimer);
      btn.disabled = false;
      left.textContent = '';
      return;
    }
    left.textContent = reading
      ? `천천히 읽는 중 · ${Math.ceil(remaining / 1000)}초`
      : '오늘의 시를 펴 두면 시간이 갑니다';
  };
  tick();
  dwellTimer = setInterval(tick, 500);
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

    // 맞혔을 때도 말해 준다. 예전에는 아무 말 없이 다음 카드로 넘어갔다(진단 4번).
    const picked = $('.choice[aria-pressed="true"]', card);
    if (res.correct === true && picked) {
      picked.classList.add('is-correct');
      result.innerHTML = `${icon('check')}<span>맞았습니다.${res.earnedPoints ? ` <b>+${res.earnedPoints}</b>` : ''}</span>`;
      result.className = 'result ok';
      await new Promise((r) => setTimeout(r, 900));
    }

    const earned = res.earnedChallenges || [];
    state.dwellLeft = null;
    // 오늘 미션으로 받은 도전과제를 모아 둔다. 마무리 칸에 한꺼번에 적으려고.
    state.todayEarned = [...(state.todayEarned ?? []), ...earned];
    if (res.dayComplete) {
      // 하루를 다 끝낸 순간에는 토스트를 띄우지 않는다. 마무리 칸이 그 말을 하고,
      // 오늘 받은 도전과제도 모두 그 칸 안에 적는다. 앞 미션에서 띄운 토스트가 아직
      // 살아 있으면 그것이 이 칸을 덮으므로 치운다 — 말하던 것은 칸 안에 다 있다.
      const seen = new Set();
      state.justEarned = state.todayEarned.filter((c) => !seen.has(c.id ?? c.title) && seen.add(c.id ?? c.title));
      $('#toasts').replaceChildren();
      await loadToday();
      state.justEarned = null;
      state.todayEarned = [];
      const done = $('#today-done');
      done.setAttribute('tabindex', '-1');
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
      done.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
      done.focus({ preventScroll: true });
      return;
    }
    // 도전과제가 여럿 한꺼번에 오면 한 장으로 묶는다.
    if (earned.length === 1) challengeToast(earned[0]);
    if (earned.length > 1) {
      toast(`도전과제 ${earned.length}개 — ${earned.map((c) => c.title).join(', ')}`, {
        tone: 'star',
        iconName: 'star',
        ms: 5000,
      });
    }
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
  // 펴자마자 '읽음' 을 찍으면 대화상자를 다섯 번 열었다 닫는 것으로 '다섯 편을 펼쳐
  // 읽었습니다' 도전과제 점수가 생긴다. 펴 둔 시간이 시 길이만큼 지나야 읽은 것이다.
  // 반만 요구한다 — 대화상자에서는 한 번 훑어 읽는 것이 보통이다.
  clearTimeout(state.readTimer);
  state.readTimer = setTimeout(async () => {
    if (!$('#poem-dialog').open || state.openPoem?.id !== poemId) return;
    const earned = await markPoemRead(poemId);
    if (earned?.length) loadLibrary();
  }, dwellMsFor(poem) / 2);
}

$('#poem-dialog').addEventListener('close', () => clearTimeout(state.readTimer));

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
