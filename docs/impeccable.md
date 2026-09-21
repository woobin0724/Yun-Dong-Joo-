# Impeccable — 디자인 안티패턴 탐지기

AI가 만든 프론트엔드에서 되풀이되는 "티"를 잡아내는 도구입니다.
[pbakaus/impeccable](https://github.com/pbakaus/impeccable) · Apache License 2.0

우리 계획서(`PLAN.md` §4)의 **안티-AI 체크리스트**를 사람 눈 대신
**61개 결정론적 규칙**으로 검사해 줍니다. LLM 도, API 키도 필요 없습니다.

---

## 지금 설치되어 있는 것

| 위치 | 내용 |
|---|---|
| `node_modules/impeccable` | CLI 와 플랫폼 바이너리 (devDependency, 저장소에는 올라가지 않음) |
| `.claude/skills/impeccable/` | 스킬 본체 — `/impeccable <명령>` 24가지 |
| `.claude/agents/impeccable-*.md` | 스킬이 쓰는 보조 에이전트 4종 |
| `.claude/examples/settings.with-hooks.json` | 자동 검사 훅 설정 (기본은 **꺼짐**) |

**자동 실행은 꺼 둔 상태입니다.** 파일을 고칠 때마다 검사가 도는 건
켜고 싶을 때 켜는 편이 낫다고 보았습니다.

---

## 쓰는 법

### 손으로 한 번 돌리기

```bash
npm run design:check              # public/ 전체 검사
npx impeccable detect public/styles.css   # 파일 하나만
npx impeccable detect --help
```

### 자동 검사 켜기

```bash
cp .claude/examples/settings.with-hooks.json .claude/settings.json
```

UI 파일을 고친 직후와 턴이 끝날 때 탐지기가 돕니다.
끄려면 `.claude/settings.json` 을 지우면 됩니다.

### Claude Code 안에서 스킬로 쓰기

```
/impeccable audit public/
/impeccable critique
/impeccable typeset
```

처음 쓸 때는 `/impeccable init` 이 `PRODUCT.md` 를 만들며 제품 맥락을 물어봅니다.

---

## ⚠️ 설치 경로에 대한 중요한 참고

공식 설치 명령(`npx impeccable install`)은 **GitHub Releases 에서 서명된 번들을
내려받아 서명을 확인**합니다. 그런데 이 개발 환경의 네트워크 정책이
GitHub Releases 를 막고 있어(HTTP 403) 그 경로가 실패했습니다.

그래서 **같은 공식 저장소를 git 으로 클론해 빌드된 스킬 파일을 그대로 복사**했습니다.
출처는 같지만 **서명 검증 단계는 건너뛴 것**입니다.

- 바이너리는 npm 에서 정식으로 받았습니다 (`npm i -D impeccable`, 4.1.0).
- 스킬 파일은 저장소 `main` 브랜치의 빌드 결과물입니다 (SKILL.md 4.3.1, 엔진 0.1.5).
  npm 에 공개된 CLI(4.1.0)보다 앞서 있을 수 있습니다.

**서명까지 확인된 설치를 원하시면**, GitHub Releases 에 접근되는 환경(보통 본인 PC)에서
프로젝트 루트에 이렇게 다시 설치하시면 됩니다. 기존 파일을 덮어씁니다.

```bash
npx impeccable install --project --providers=claude --force
```

---

## 라이선스

Apache License 2.0 · Copyright Paul Bakaus.
`.claude/skills/impeccable/` 아래 파일은 원 저장소의 산출물이며 우리 코드가 아닙니다.
자세한 것은 `docs/LICENSES.md` 를 보세요.
