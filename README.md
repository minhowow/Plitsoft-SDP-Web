# Plitsoft-SDP-Web

policypack CLI(가칭)의 결과를 조문과 함께 보여 주는 웹. 아주대학교 2026-2 자기주도프로젝트 · 플리트소프트 연계. (개발 중)

CLI 는 JS/TS 코드(누가 썼든)에서 국내 법·정책상 검토가 필요한 지점을 찾는다. 이 저장소는 그 결과를 사람이 읽기 좋게
보여 준다. CLI 저장소는 옆 폴더 `../Plitsoft-SDP` 에 따로 있다.

출력은 "검토 필요 + 근거 조문 + 확인 질문"이다. 법률 자문이 아니다.

## 지금 있는 것

GitHub 공개 저장소를 찾아 분석 결과를 보고 분석을 요청하는 서비스로 가는 중이다(방향 B, [docs/direction.md](docs/direction.md)).
B2 차례 A 까지: 서버(설정·DB·GitHub·저장소 구현)가 있고, 분석 서비스의 쪽은 요청 때 그린다. 분석 요청을 받는 `/api/` 와
실행기는 다음 차례다. 배포할 때 오너가 할 일은 [docs/deploy.md](docs/deploy.md).

| 주소 | 내용 |
|---|---|
| `/` | 온보딩, 검색창, 최근 분석된 저장소 |
| `/search/?q=` | 서버가 GitHub 공개 저장소를 검색하고, 저장소마다 이 사이트의 분석 수를 붙인다 |
| `/r/{owner}/{repo}/` | 저장소의 분석 기록과 요청 단추. `/r/{owner}/{repo}/a/{id}/` 는 분석 하나(진행 또는 결과 대시보드) |
| `/view/` | CLI 결과(JSON, SARIF)를 브라우저 안에서 열어 본다. 파일을 어디로도 보내지 않는다 |
| `/demo/` | 합성 예시 코드 세 가지의 고치기 전·후와, 그 코드를 검사한 CLI 실제 출력 |
| `/policy/` | 조문 도감. 정책마다 근거 조문 원문, 적법한 대안, 개발자에게 할 질문 |

`/view/` 와 `/demo/` 의 결과는 단추를 눌러 조문별 검사 기록으로도 본다. 정책마다 대표 조문과 그 시행일·원문 해시, 상태별
발견 수, 발견의 자리와 지문을 한 장에 적은 것이고, 브라우저의 인쇄로 종이나 PDF 가 된다. 코드와 AI 가 인용한 줄은 싣지
않는다. 법률 자문도 인증도 아니다.

## 써 보기

```bash
npm ci
SERVICE_STORE=synthetic npm run dev     # 합성 예시 미리보기(DB·GitHub 을 부르지 않는다). http://localhost:3000
npm run github-stub                     # 또는: 가짜 GitHub(127.0.0.1:4010)을 띄우고
GITHUB_API_BASE=http://127.0.0.1:4010 npm run dev   # DB(PGlite, .data/) + 가짜 GitHub 으로 띄운다
# 요청부터 결과까지 돌려 보려면 dev 에 RUNNER=local RUNNER_SECRET=<아무 글> 을 더하고, 다른 창에서
RUNNER_SECRET=<같은 글> npm run local-runner -- --fixture
npm run check    # lint + typecheck + 부품 시험 + build + 브라우저 시험
```

환경 변수를 주지 않고 `npm run dev` 를 띄우면 실제 GitHub API 를 부른다. 개발 중에는 위처럼 가짜 GitHub 이나 합성 미리보기를
쓴다. 환경 변수 목록은 `.env.example`.

Node.js 22.12 이상의 22, 24, 또는 26 이상이 필요하다(시험 도구 vitest 의 요구).

`npm run check` 의 마지막 단계(브라우저 시험, `npm run test:browser`)는 빌드된 사이트를 `next start` 로 127.0.0.1 에 띄우고
(합성 저장소, 또는 PGlite + 가짜 GitHub) 이 컴퓨터에 깔린 Google Chrome 으로 열어 본다. 연 파일을 어디로도 보내지 않는지, 키보드와 끌어다 놓기가 되는지, 좁은 화면에서
넘치지 않는지를 본다.

- **Chrome 이 없으면 건너뛰지 않고 실패한다.** 건너뛰면 "연 파일을 어디로도 보내지 않는다"를 보지 않은 채 통과하기
  때문이다. Chrome 을 설치하거나, Chrome·Chromium 실행 파일의 경로를 `CHROME_PATH` 환경 변수로 준다. Chrome 없이
  나머지만 보려면 `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` 를 따로 돌린다.
- 브라우저를 내려받지 않는다. 시험 도구(`playwright-core`)는 브라우저를 함께 받지 않고, 깔려 있는 Chrome 을 쓴다.
  시험이 여는 쪽이 내보내는 요청은 127.0.0.1 의 그 서버로 가는 것뿐이다. Chrome 이 스스로 하는 통신은 끄는 옵션으로
  띄운다. 어느 쪽이든 개발 도구가 하는 일이고, 사이트가 밖으로 내보내는 요청이 아니다.
- 자세한 것은 [docs/architecture.md](docs/architecture.md) 의 "브라우저 시험".

CLI 출력을 다시 수집하려면 `uv` 와 옆 폴더의 CLI 저장소가 있어야 한다. 자세한 것은 [contract/README.md](contract/README.md).

```bash
npm run capture && npm run pack-meta && npm test
```

## 문서

- [docs/ROADMAP.md](docs/ROADMAP.md) — 할 일과 관문
- [docs/commitments.md](docs/commitments.md) — 지켜야 할 약속
- [docs/architecture.md](docs/architecture.md) — 구조
- [docs/direction.md](docs/direction.md) — 방향 B 와 일정, 기본 제한 값
- [docs/deploy.md](docs/deploy.md) — 배포할 때 오너가 할 일
- [docs/cli-requests.md](docs/cli-requests.md) — CLI 에 보내는 요청
- [contract/README.md](contract/README.md) — CLI 와 이어지는 방식
- [CLAUDE.md](CLAUDE.md) — 에이전트 작업 안내

## 라이선스

아직 정하지 않았다. 공개 전에 정한다. 조문 원문은 법령이라 누구나 쓸 수 있다(저작권법 제7조).
