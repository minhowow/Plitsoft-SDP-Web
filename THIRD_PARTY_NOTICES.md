# 제3자 고지

이 저장소는 아래의 것을 옮겨 쓴다. 패키지로 넣은 것은 없다(`package.json` 에 없다).

## GitHub Primer Primitives 11.10.0 — 색과 크기 값

- 무엇: `@primer/primitives` 11.10.0 의 기능 토큰(functional tokens) 가운데 색 값 일부와, 그 값들이 쓰는 모서리(6px)·줄 높이(40px)·단추
  높이(32px) 같은 크기 값. 토큰 이름, CSS 파일, 스크립트는 옮기지 않았다. 값을 이 사이트의 토큰 이름(`--bg`, `--ink`, `--rule`,
  `--accent`, `--st-*` 등)에 넣었다.
- 어디에: `src/app/globals.css` 의 `:root` 와 어두운 테마(`@media screen and (prefers-color-scheme: dark)`)의 토큰.
- 출처: npm 패키지 `@primer/primitives@11.10.0` 의 `dist/css/functional/themes/light.css` 와 `dark.css`
  (https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/css/functional/themes/light.css ,
  https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/css/functional/themes/dark.css). 2026-11-07 에 받은 파일이 재디자인
  목업(2026-11-04)에 쓴 사본과 바이트까지 같은 것을 확인했다. 기능 토큰이 아닌 값 둘은 같은 판의 바탕 색 단계(base scale)
  `dist/internalCss/light.css` (https://cdn.jsdelivr.net/npm/@primer/primitives@11.10.0/dist/internalCss/light.css)에서 왔다(아래).
- 옮기며 바꾼 것:
  - 반투명 값(예: 어두운 테마의 `bgColor-accent-muted` `#388bfd1a`)은 그 테마의 바탕(`#0d1117`) 위에 칠한 색으로 바꿔 적었다.
  - 판정 상태 칩의 글자색 셋(검토 필요 `#953800`, 판단 보류 `#7d4e00`, 충족 근거 `#116329`)은 같은 색의 기능 토큰(`fgColor-severe`,
    `fgColor-attention`, `fgColor-success`)보다 한 단계 짙은 바탕 색 단계의 값이다(옅은 칩 바탕 위에서 명도 대비 4.5:1 을 넘기려고):
    `base-color-orange-6`, `base-color-yellow-6`, `base-color-green-6`(밝은 테마의 `dist/internalCss/light.css`).
  - 밝은 테마의 경고 상자 테두리(`--warn-border` `#d4a72c`)는 기능 토큰 `borderColor-attention-muted`(`#d4a72c66`, 40% 불투명)를
    바탕 위에 칠한 색이 아니라, 투명도를 뺀 바탕 색 단계 `base-color-yellow-3` 의 값이다. 어두운 테마의 것(`#9e6a03`)은 기능 토큰
    `borderColor-attention-emphasis` 의 값이다.
  - 상자 안 줄 사이의 옅은 선(`--rule-muted`)은 `borderColor-muted` 를 흰 바탕 위에 칠한 색이다.
- 라이선스: MIT. 아래 원문은 https://unpkg.com/@primer/primitives@11.10.0/LICENSE 에서 2026-11-07 에 받은 것을 그대로 옮겼다.

```
The MIT License (MIT)

Copyright (c) 2018 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 선 아이콘

`src/components/Icon.tsx` 의 아이콘 다섯(검색, 접기, 다음, 새 창, 커밋)은 이 저장소에서 직접 그린 것이다. Octicons 등 바깥 아이콘
묶음은 쓰지 않는다(docs/redesign.md 2.1).

## 글꼴

글꼴 파일은 싣지 않는다. 사용자의 컴퓨터에 깔린 시스템 글꼴의 이름만 적는다(`src/app/globals.css` 의 `--font-*`).
