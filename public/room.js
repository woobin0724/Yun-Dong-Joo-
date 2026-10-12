/* 별 헤는 밤 — 방(감상 피드·안전 장치·선생님 보기·나누기)
   app.js 에서 떼어 냈습니다. 동작은 그대로입니다. */
import { $, $$, esc, icon, num, api, toast, guarded } from './core.js';
import { state, CHEERS, challengeToast } from './shared.js';

// ───────── 방 ─────────
export async function loadRooms() {
  const { rooms } = await api('/rooms');
  state.rooms = rooms;
  if (!rooms.some((r) => r.id === state.activeRoomId)) state.activeRoomId = rooms[0]?.id ?? null;
}

export async function renderRoomView() {
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
export function openShare(type, id, preview) {
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

