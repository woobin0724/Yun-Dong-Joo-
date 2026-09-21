# 라이선스와 출처

이 앱이 쓰는 글꼴·에셋·콘텐츠의 출처와 라이선스를 모아 둡니다.
새 에셋을 추가할 때는 **반드시 여기에도 적어 주세요.**

---

## 코드

이 저장소의 코드는 **MIT License** (루트 `LICENSE` 참고).

---

## 글꼴

### Gowun Batang — 시 본문·제목

- **라이선스**: SIL Open Font License, Version 1.1
- **저작권**: Copyright 2021 The Gowun Batang Project Authors
- **원본 저장소**: https://github.com/yangheeryu/Gowun-Batang
- **받아온 곳**: Google Fonts (`fonts.googleapis.com` → `fonts.gstatic.com`)
- **라이선스 전문**: [`public/fonts/gowun-batang/OFL.txt`](../public/fonts/gowun-batang/OFL.txt)
- **저장 위치**: `public/fonts/gowun-batang/` (woff2 서브셋 190개, 약 2.9MB)
- **다시 받는 법**: `node scripts/fetch-fonts.js`

OFL 1.1 요건 중 이 앱에 해당하는 것:
- 글꼴 파일을 **그대로** 재배포합니다(변형하지 않음).
- 저작권 표시와 라이선스 전문을 함께 둡니다 (위 `OFL.txt`).
- 글꼴 이름을 바꾸지 않았고, "Gowun Batang"을 이 앱 이름으로 쓰지 않습니다.

### UI 글꼴 — 내려받는 파일 없음

각 기기의 시스템 글꼴을 씁니다. 배포되는 파일이 없으므로 라이선스 의무도 없습니다.

| 환경 | 실제로 쓰이는 글꼴 |
|---|---|
| iOS / macOS | Apple SD Gothic Neo (`-apple-system`) |
| Windows | 맑은 고딕 (Malgun Gothic) |
| Android | Noto Sans KR (`Roboto` 경유) |
| 그 외 | `system-ui` → `sans-serif` |

> Pretendard 를 쓰고 싶으시면 [배포처](https://github.com/orioncactus/pretendard)에서 받아
> `public/fonts/pretendard/` 에 넣고 `public/fonts/fonts.css` 에 `@font-face` 를 추가하시면 됩니다.
> Pretendard 역시 OFL 1.1 이므로 이 문서에 항목을 추가해 주세요.

---

## 아이콘·일러스트

| 항목 | 출처 | 라이선스 |
|---|---|---|
| UI 아이콘 세트 (`public/index.html` 인라인 스프라이트) | 이 저장소에서 직접 제작 | MIT (코드와 동일) |
| 앱 아이콘 / 파비콘 / PWA 아이콘 | 이 저장소에서 직접 제작 | MIT |
| 마스코트 "별이" | 이 저장소에서 직접 제작 | MIT |

외부 아이콘 라이브러리를 쓰지 않았습니다. 전부 이 저장소에서 그린 SVG 입니다.

---

## 개발 도구 — Impeccable

- **무엇**: AI가 만든 프론트엔드의 디자인 안티패턴을 잡는 탐지기 + Claude Code 스킬
- **출처**: https://github.com/pbakaus/impeccable (Paul Bakaus)
- **라이선스**: Apache License 2.0
- **저장 위치**: `.claude/skills/impeccable/`, `.claude/agents/impeccable-*.md`
  — 이 파일들은 **원 저장소의 산출물이며 우리가 쓴 코드가 아닙니다.**
- **CLI/바이너리**: npm devDependency (`impeccable`). 저장소에는 올라가지 않습니다.
- 자세한 설치 경위와 주의점은 [`impeccable.md`](./impeccable.md) 참고.

Apache-2.0 은 저작권·라이선스 고지를 함께 두기를 요구합니다.
원 저장소의 `LICENSE` 와 `NOTICE.md` 내용은 위 링크에서 확인할 수 있습니다.

**마스코트에 관한 원칙**: 마스코트는 **별을 의인화한 도형**입니다.
윤동주 본인의 얼굴을 캐릭터로 만들거나 사진을 쓰지 않습니다.
실존 인물의 초상을 쓰려면 별도의 권리 확인이 필요하기 때문입니다.

---

## 작품 본문 (윤동주 시)

- **저작권 상태**: 윤동주(1917~1945)의 작품은 한국 저작권법상 보호기간(사후 70년)이
  2015년에 만료되어 **공유 저작물(public domain)** 입니다.
- ⚠️ **다만 본문 표기는 아직 정본과 대조되지 않았습니다.**
  판본마다 띄어쓰기·옛 표기·행 구분이 다릅니다. `src/content/poems.js` 의 `verified` 플래그로
  관리하며, 대조 절차는 [README](../README.md) 에 정리합니다.

## 해설과 퀴즈

- `poems.js` 의 `note`(작품 해설)와 `quiz-bank.js` 의 문항·해설은 **이 저장소에서 새로 쓴 글**입니다.
- 해설은 **해석(의견)** 이고 사실 진술이 아닙니다. 화면에서도 구분해 표시합니다.
- 연대기·TMI 등 **사실 정보**는 출처와 링크를 각 항목에 달고, 검증되지 않은 항목은 노출하지 않습니다
  (자세한 원칙은 [`PLAN.md`](../PLAN.md) §5).
