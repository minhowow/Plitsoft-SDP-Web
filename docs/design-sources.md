# 디자인 원칙과 값의 출처

재디자인(`docs/redesign.md`)의 2.2 "적용한 원칙과 출처" 표에 든 출처의 주소와 판이다. D2(토큰·바탕)에서 적었다.
받아 둔 사본은 저장소에 넣지 않았다. 아래 "확인"은 2026-11-07 에 주소에서 다시 받거나 해시를 견주어 본 것이다. 확인하지 못한 것은
그렇다고 적는다.

외부 스킬은 저장소에 설치하지 않는다. 원칙만 `docs/redesign.md` 의 표로 옮겼다.

## 값을 옮긴 것

| 출처 | 판 | 주소 | 쓴 곳 | 확인 |
|---|---|---|---|---|
| GitHub Primer Primitives, 기능 토큰(밝은·어두운 테마) | npm `@primer/primitives@11.10.0` | https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/css/functional/themes/light.css , https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/css/functional/themes/dark.css | `src/app/globals.css` 의 색 토큰 값(방향 A) | 다시 받은 두 파일이 목업에 쓴 사본과 바이트까지 같다 |
| 같은 패키지의 바탕 색 단계(base scale, 밝은 테마) | npm `@primer/primitives@11.10.0` | https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/internalCss/light.css | 칩 글자색 `#953800`·`#7d4e00`·`#116329`(`base-color-orange-6`·`yellow-6`·`green-6`), 경고 테두리 `#d4a72c`(`base-color-yellow-3`) | 2026-11-07 에 받은 파일에서 네 값을 찾았다 |
| 같은 패키지의 라이선스(MIT) | 11.10.0 | https://unpkg.com/@primer/primitives@11.10.0/LICENSE | `THIRD_PARTY_NOTICES.md` 에 원문 그대로 | 받은 원문을 옮겼다 |

무엇을 어떻게 옮겼는지(반투명 값을 바탕 위에 칠한 색으로 바꾼 것, 칩 글자색, 경고 테두리)는 `THIRD_PARTY_NOTICES.md` 에 있다.

## 원칙을 가져온 것

| 원칙(redesign.md 2.2) | 출처 | 판 | 주소 | 확인 |
|---|---|---|---|---|
| 눈썹 글과 순서 아닌 번호를 두지 않는다. 같은 카드를 쪽의 뼈대로 쓰지 않는다 | Anthropic `frontend-design` 스킬(SKILL.md) | `main` 갈래(판 번호 없음) | https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md | raw 주소에서 다시 받은 파일이 사본과 같다 |
| 눈썹 글과 번호(`craft-floor`), 한 사실은 한 번(`distill`·`clarify`), 빈 상태를 가른다(`clarify`) | impeccable(pbakaus) 스킬 `reference/craft-floor.md`, `distill.md`, `clarify.md` | SKILL.md 의 `version: 4.8.0`, git tree `f864521bbb1c9350e8f6cf7742c139a04a1020af` | https://github.com/pbakaus/impeccable | 사본 세 파일의 git blob 해시가 그 tree 의 `plugin/skills/impeccable/reference/` 아래 파일과 같다. 라이선스는 SKILL.md 의 머리에 Apache 2.0 으로 적혀 있다 |
| 목록은 한 구획 안의 줄로 쓴다. 숫자는 타일이 아니라 글자로, 색은 데이터에만 | taste-skill(`design-taste-frontend`, "tasteskill v2")의 `app-screens` 장 | 사본에 적힌 이름 "tasteskill v2" 말고 판을 알 수 없음 | **확인하지 못함.** 사본에 저장소 주소가 적혀 있지 않다 | 사본의 내용만 보았다 |
| 기술 점검: `:focus-visible`, 진행 표시의 `aria-live`, `tabular-nums`, 제목의 `text-wrap: balance`, 식별자의 `translate="no"`, `transition: all` 금지, `color-scheme`·`theme-color` | Vercel Web Interface Guidelines(`command.md`) | `main` 갈래(판 번호 없음). 이를 부르는 스킬 `web-design-guidelines` 의 머리에는 `version: "1.0.0"` | https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md | 다시 받은 파일이 사본과 같다 |

impeccable 을 설치하지 않는 까닭 하나(live 모드의 Apply 가 승인·권한 확인을 끈 채로 다른 에이전트를 부를 수 있다)는
`docs/redesign.md` 2.2 에 있다. impeccable 의 "시스템 기본 글꼴 남용" 규칙은 받아 둔 사본에서 찾지 못했다(같은 곳).

## 쓰지 않은 것

- Octicons(GitHub 의 아이콘 묶음): 쓰지 않는다. 선 아이콘 다섯은 직접 그렸다(`src/components/Icon.tsx`, `docs/redesign.md` 2.1).
- 바깥 글꼴: 쓰지 않는다. 시스템 글꼴 이름만 적는다(`docs/commitments.md` 의 바깥 요청 약속).
