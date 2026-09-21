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

### IBM Plex Sans KR — UI 전반

- **라이선스**: SIL Open Font License, Version 1.1
- **저작권**: Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
- **한글 디자인**: Sandoll
- **받아온 곳**: Google Fonts
- **라이선스 전문**: [`public/fonts/plex-sans-kr/OFL.txt`](../public/fonts/plex-sans-kr/OFL.txt)
- **저장 위치**: `public/fonts/plex-sans-kr/` (woff2 서브셋 282개, 약 3.3MB)
- **다시 받는 법**: `node scripts/fetch-fonts.js`

OFL 의 "Reserved Font Name" 조항에 따라, 글꼴을 고쳐서 배포할 때는 "Plex" 라는 이름을
쓸 수 없습니다. 이 앱은 글꼴을 고치지 않고 그대로 제공하므로 해당하지 않습니다.

**왜 시스템 글꼴을 쓰지 않는가**: 시스템 글꼴로 두면 Windows 는 맑은 고딕,
iOS 는 Apple SD Gothic Neo, Android 는 Noto 로 갈라져 사실상 세 개의 다른 앱이 됩니다.
그렇다고 Noto Sans KR 을 고르면 누구나 반사적으로 집는 선택이 되고, 용량도 8MB 를 넘습니다.
(글꼴이 아직 안 받아졌을 때를 대비한 대체 목록에는 시스템 글꼴이 그대로 남아 있습니다.)

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
