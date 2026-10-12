/* 별 헤는 밤 — 랭킹과 주간 리그
   app.js 에서 떼어 냈습니다. 동작은 그대로입니다. */
import { $, $$, esc, num, api, euroRo } from './core.js';
import { state, CHEERS, challengeToast } from './shared.js';

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

export async function loadRanking() {
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

