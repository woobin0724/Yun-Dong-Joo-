/* 별 헤는 밤 — 「나」 — 걸어온 길·필사·남긴 한 줄·알림·설정·계정 지우기
   app.js 에서 떼어 냈습니다. 동작은 그대로입니다. */
import { $, $$, esc, icon, num, api, toast } from './core.js';
import { state, CHEERS, challengeToast } from './shared.js';
import { layout } from './transcribe.js';
import { openShare } from './room.js';

// ───────── 나 ─────────
export async function loadMe() {
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

