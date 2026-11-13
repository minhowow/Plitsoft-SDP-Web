@AGENTS.md

# Plitsoft-SDP-Web — 작업 안내

policypack CLI(가칭)로 GitHub 공개 저장소를 분석하고, 그 결과를 조문과 함께 누구나 보게 하는 웹 서비스다(방향 B,
`docs/direction.md`). 오너의 개인 개발 프로젝트로 진행한다. 아주대 2026-2 자기주도프로젝트, 플리트소프트 연계.
CLI 는 옆 폴더 `../Plitsoft-SDP` 에 따로 있고, 다른 사람(에이전트)이 개발한다.

일을 시작하기 전에 이 순서로 읽는다.

1. `docs/direction.md` — 지금의 방향, 쪽 구조, 서버·실행기 구조, 일정(B0~B4)
2. `docs/ROADMAP.md` — 무엇을 어떤 순서로 하는지, 지금 해도 되는 일과 사람 결정이 필요한 일
3. `docs/commitments.md` — 어기면 안 되는 약속 (문구, 저장, 공개 범위)
4. `contract/README.md` — CLI 와 이어지는 방식
5. `docs/architecture.md` — 세 개의 층과 지금 있는 것

## 절대 규칙

- **`../Plitsoft-SDP` 는 읽기만 한다.** 고치지 않는다. 그 소스(`src/policypack`)를 가져다 쓰지도 않는다.
  CLI 와는 설치된 명령의 출력(`contract/`)과 팩 메타데이터(`data/pack-meta.json`)로만 이어진다.
- **CLI 출력에 없는 정보를 꾸며 내지 않는다.** `decision_path` 같은 자유 문장을 해석해 구조를 만들지 않는다.
  필요한 것이 출력에 없으면 `docs/cli-requests.md` 에 요청으로 적고, 화면에는 "아직 알 수 없음"으로 정직하게 보인다.
- **서버는 `docs/direction.md` 의 구조 안에서만 넣는다.** route handler, DB, GitHub API 호출, 실행기(GitHub Actions)
  콜백은 그 구조대로 둔다. 분석 도구·광고·외부 글꼴·외부 스크립트는 넣지 않는다. 브라우저 쪽 코드는 같은 사이트의 `/api/`
  말고는 요청하지 않는다(코드 줄은 GitHub 링크로 보낸다). 비밀값(토큰, API 키)은 서버 환경 변수와 Actions secret 에만 두고
  저장소·로그·화면에 남기지 않는다. 브라우저 저장소(localStorage 등)는 쓰지 않는다. `/view` 에서 연 파일은 브라우저 안에만 둔다.
- **`tests/commitments.test.ts` 와 `tests/wording.ts` 를 고쳐서 통과시키지 않는다.** 시험을 고치는 것은 `docs/commitments.md`
  가 먼저 바뀌었을 때, 그 바뀐 약속에 맞추는 경우뿐이다.
  이 시험은 흔한 실수를 잡는 그물일 뿐이다. 통과했다고 약속을 지킨 것은 아니다. `docs/commitments.md` 를 기준으로 판단한다.
- **사람만 하는 일을 대신하지 않는다.** 배포(Vercel 등), 계정·저장소·도메인 만들기, 비밀값 만들기, 원격에 올리기(push),
  라이선스 정하기, 비용 상한 정하기. 실제 공개 저장소의 분석은 서비스가 사용자의 요청으로 한다. 에이전트가 남의 저장소를
  스스로 골라 분석하지 않는다(개발 중 시험은 합성 저장소나 오너가 정한 저장소로). 필요해지면 멈추고 `docs/ROADMAP.md` 의
  "사람 결정이 필요한 것"에 적는다.
- **법에 관한 사실을 지어내지 않는다.** 조문은 `data/pack-meta.json` 의 `legal[].text` 원문만 쓴다. 팩에서 온 다른 글
  가운데 제목·질문·메시지·고치는 법은 화면에 써도 된다. 팩 작성자 메모(`rationale`)는 쓰지 않는다(처분·액수 같은 주장이
  들어 있다). 처분 사례·과징금 액수는 화면에 싣지 않는다. 싣는 것은 사람이 출처를 확인한 뒤의 일이다.

## 표기 (자세한 것은 docs/commitments.md)

- 대상은 "JS/TS 코드(누가 썼든)"다. 특정 도구가 만든 코드용이라고 쓰지 않는다.
- 판정 문구는 `src/lib/report/status.ts` 에 있는 것만 쓴다(다섯 가지 상태와 "발견 없음", "알 수 없음"). 단정하는 말,
  점수, 등급, 순위는 없다.
- 판정자를 켜 보라고 권할 때는 판정 대상 코드가 외부 API 로 나간다는 사실을 함께 적는다. AI 가 푼 경고와 적용 질문으로
  빠진 판정은 숨기지 않는다.
- 인공지능기본법 조문은 "제31조 제1항"(사전 고지), "제31조 제2항"(결과물 표시)으로 적는다. 정책 id `31-1` 은 id 일 뿐이다.
- 이름과 고정 문구는 `src/lib/site.ts` 에서 가져다 쓴다. CLI 이름은 바뀔 수 있다.
- 예시 결과에는 항상 "합성 예시"라고 밝힌다.

## 명령

```bash
npm run local       # 계정 없이 서비스 전체를 한 번에: 가짜 GitHub(4010) + 사이트(3000, RUNNER=local, PGlite .data/local) + 로컬 실행기
                    #   (scripts/dev-local.mjs, docs/deploy.md 의 3. -- --cli 는 옆 폴더 CLI 로, -- --step-delay ms 로 단계 사이를 늦춘다.
                    #   POOL_SIZE=n 을 앞에 붙이면 사이트의 실행 자리와 로컬 실행기의 동시 수가 함께 바뀐다)
npm run dev         # 개발 서버. 환경 변수 없이 띄우면 실제 GitHub API 를 부르므로 개발 중에는 아래 둘 가운데 하나로 띄운다
SERVICE_STORE=synthetic npm run dev                 # 합성 예시 미리보기(DB·GitHub 없음)
npm run github-stub                                 # 가짜 GitHub API(127.0.0.1:4010). 그 뒤
GITHUB_API_BASE=http://127.0.0.1:4010 npm run dev   # PGlite(.data/) + 가짜 GitHub
#   요청부터 결과까지 이 컴퓨터에서: 위 dev 에 RUNNER=local RUNNER_SECRET=<아무 글> 을 더하고, 다른 창에서
RUNNER_SECRET=<같은 글> npm run local-runner -- --fixture   # 로컬 실행기(합성 데모 코드의 수집본을 결과로. 판정자 없음. --parallel n 은 POOL_SIZE 와 같게)
npm run check       # lint + typecheck + test + build + 브라우저 시험. 일을 마쳤다고 하기 전에 반드시 통과시킨다
npm run test        # vitest (계약·화면 구조·약속)
npm run capture     # 합성 데모 코드를 설치된 CLI 로 다시 검사 → contract/cli-current/
npm run pack-meta   # 팩에서 data/pack-meta.json 다시 만들기
```

`capture` 와 `pack-meta` 는 `uv` 와 옆 폴더의 CLI 저장소가 있어야 돈다. 둘은 항상 같이 돌린다(팩 판이 어긋나면
`tests/contract.test.ts` 가 실패한다). 자세한 규칙은 `contract/README.md` 에 있다.

- 돌린 뒤 `git diff contract/ data/` 를 읽는다. 판정이 바뀌었으면 왜 바뀌었는지 커밋 메시지에 적는다.
- `MANIFEST.json` 의 `dirty` 가 `true` 면(CLI 저장소에 커밋되지 않은 변경) 수집본을 커밋하지 않고 되돌린다.
- 새 수집본이 계약 시험을 깨면(예: CLI 출력 모양이 바뀜) 파서를 서둘러 고치지 말고 수집본을 되돌린 뒤
  `docs/ROADMAP.md` 의 "사람 결정이 필요한 것"에 적는다. 출력 계약을 바꾸는 것(새 결과 판, `--agent` 처럼 뜻이 다른 출력을
  받기)은 관문 G1 의 일이다. 2026-11-03 에 고정 CLI(`7300205`)의 결과 판 1(`schema_version: 1`)은 받았고,
  2026-11-10 에 고정 판을 `handoff-w11`(`50c70bc`)로, 2026-11-11 에 `handoff-w11-2`(`54e048a`, 발견마다 파일 역할), 같은 날 `handoff-w11-3`(`fe98fb7`, 저장소 프로필), `handoff-w11-5`(`e12e6ba`, review 2판)로, 2026-11-12 에 `handoff-w11-6`(`f4967db`, review 2판에 키 덧붙임), 같은 날 `handoff-w11-7`(`2a24d94`, review 금액을 공식 단가로, 갈래 고침), `handoff-w11-8`(`b5888e5`, 조사 답의 basis 누락 고침)로 옮겼다.
- 수집본, `data/pack-meta.json`, 실행기의 `CLI_COMMIT`·`CLI_EXCLUDE_NEWER` 는 같은 CLI 커밋이어야 한다(시험이 본다).
  CLI 를 따라가는 때와 순서는 `docs/cli-followup.md` 에 있다. 원격에 없는 CLI 커밋은 고정하지 않는다.
- `scripts/export-pack-meta.mjs` 는 팩의 필드를 그대로 옮기기만 한다. 읽는 필드를 더하는 것은 된다. Semgrep 패턴이나
  YAML 주석을 해석해 설명을 만들어 내는 것은 안 된다.

## 어디에 무엇이 있나

| 경로 | 내용 |
|---|---|
| `src/app/` | 페이지: `/`(첫 화면: 표지·검색창·최근 분석), `/search`(빈 상태: 최근 분석·검사하는 정책, 질의: 결과·0건), `/r/[owner]/[repo]`(저장소), `/r/[owner]/[repo]/a/[id]`(분석), `/r/[owner]/[repo]/a/[id]/checklist`(의무 체크리스트 인쇄용 보기) — 이 다섯은 요청 때 그린다, `/view`(결과 파일), `/demo`(고치기 전·후), `/policy`(조문 도감), `/how`(구조 그림: 쉬운 판 셋·따라가 보기·접어 둔 자세한 판 셋. 자료는 `src/lib/how/`, 포스터·보고서용 파일은 `docs/figures/`), `/cases`(사례 넷, 41곳 평가 `data/eval-41.json`), `/cases/[slug]/checklist`(사례의 인쇄용 보기) — 빌드할 때 그린다. 체크리스트 마크다운 파일은 `/api/analyses/[id]/checklist/`, `/api/cases/[slug]/checklist/`(`src/lib/review/checklist.ts`) |
| `src/lib/service/` | 분석 서비스의 데이터 모델과 `ServiceStore` 인터페이스, 합성 구현(`synthetic.ts`, SERVICE_STORE=synthetic 미리보기·시험용), 이름 검사, 최근 분석 고르기(`activity.ts`), 두벌식 → QWERTY(`keyboard.ts`), 자동 완성의 질의 꼴·합치기·상태 줄(`suggest.ts`) |
| `src/server/` | 서버 코드(모두 `import "server-only"`): 설정(`config.ts`, 환경 변수와 기본값), DB(`db/`, pg·PGlite, `migrations/*.sql`), GitHub 클라이언트(`github.ts`), 실행기 깨우기(`runner.ts`), 저장소 구현(`store/`, `getStore()` 가 고른다), `/api/` 의 일(`api.ts`), 실행기 콜백의 상태 전이(`callbacks.ts`)와 서명(`signature.ts`) |
| `src/app/api/` | route handler: `analyses/`(요청), `analyses/[id]/`(진행), `repos/suggest/`(검색창 자동 완성), `runner/[id]/`(실행기 콜백), `runner/claim/`(로컬 실행기). `src/server/api.ts` 를 부르기만 한다. 서버 코드는 `src/server/` 와 여기에만 둔다 |
| `runner/`, `.github/workflows/analyze.yml` | 분석 실행기(GitHub Actions). `run.mjs`·`tar.mjs` 는 Node 내장 모듈만 쓴다. 대상 코드를 실행하지 않는다 |
| `src/components/service/` | 검색창(`SearchForm.tsx` 가 셋 모두 `SearchCombobox.tsx` 로 그린다), 최근 분석 줄(`activity.tsx`), 저장소 쪽의 최신 분석(`repository.tsx`), 분석 쪽 부품, 분석 대시보드. 브라우저 부품은 요청 단추(`RequestButton.tsx`), 진행 다시 읽기(`LiveAnalysis.tsx`), 검색창 자동 완성(`SearchCombobox.tsx`) 셋이고 같은 사이트의 `/api/` 만 부른다. 머리글의 브라우저 부품(`src/components/HeaderBehavior.tsx`, 메뉴 닫기·지금 쪽 표시·쪽 이동 중 표시)은 어디에도 요청하지 않는다 |
| `src/components/result/` | 결과 화면 부품. 모든 페이지가 함께 쓴다 |
| `src/components/policy/` | 조문 도감의 정책 쪽(`PolicyDetail.tsx`, 서버 부품). 브라우저 부품은 `PolicyNav.tsx` 하나(쪽 안의 자리로 옮기기, 주소의 규칙 자리 펼치기)이고 어디에도 요청하지 않는다. 규칙의 자리 이름은 `ruleAnchor()`, 그 주소는 `ruleHref()`(`src/lib/pack/href.ts`) |
| `src/lib/report/` | 결과 JSON 타입, 파서, 상태 문구, 화면용 구조 |
| `src/lib/pack/` | 팩 메타데이터 타입과 읽기 |
| `contract/` | CLI 와의 이음매: 스키마, 실제 출력 수집본, v1 초안 예시, 합성 데모 코드 |
| `data/pack-meta.json` | 생성물. 정책·조문 원문·대안·질문 |
| `scripts/` | 수집, 팩 메타데이터 생성, 가짜 GitHub API(`github-stub.mjs`), 로컬 실행기(`local-runner.mjs`, `--fixture`), 죽은 CSS 점검(`css-unused.mjs`), 구조 그림 내보내기(`export-figures.mjs`), 41곳 평가의 숫자와 포스터 그림(`export-eval.mjs`, `export-eval-figure.mjs`) |
| `.env.example` | 환경 변수 이름(값은 비운다). 배포할 때 오너가 할 일은 `docs/deploy.md` |
| `tests/` | 계약 시험, 화면 구조 시험, 그려 본 화면 시험, 약속 시험, 서버 시험(`server-*.test.ts`, 메모리 PGlite + 가짜 GitHub), 실행기 시험(`runner.test.ts`). `tests/browser/` 는 빌드된 사이트를 `next start` 로 띄워 Chrome 으로 연다. `tests/fixtures/` 는 손으로 만든 시험용 자료 |
| `docs/` | 로드맵, 약속, 구조, CLI 에 보낸 요청, CLI 따라가기(`cli-followup.md`) |

## 일하는 방식

- `docs/ROADMAP.md` 의 "지금 할 일"에서 맨 위 항목부터 한다. 항목마다 완료 조건이 있다.
- 한 항목을 마치면 `npm run check` 를 통과시키고, 로드맵의 그 항목에 한 줄로 결과를 적는다.
- 커밋은 항목 단위로, 한국어 제목(무엇을 했는지 한 줄)으로 한다. 원격에 올리지 않는다.
- 화면을 바꿨으면 브라우저에서 실제로 열어 확인한다(좁은 화면과 어두운 테마 포함). 확인할 도구가 없으면 로드맵에
  "브라우저 확인 못 함"이라고 적는다.
- 조문 도감 주소는 `policyHref()` 로, 규칙의 자리는 `ruleHref()` 로 만든다. 주소에 점을 넣지 않는다.
- 의존성은 꼭 필요할 때만 더한다. 더하면 왜 필요한지 커밋 메시지에 적는다.
- 판단이 서지 않는 것, 약속과 부딪치는 것은 추측으로 밀고 가지 말고 로드맵의 "사람 결정이 필요한 것"에 적고 다음 항목으로 간다.

## 배경 자료

- 전체 구상(아이디어 21개, 대표 웹앱 설계, 로드맵): https://claude.ai/artifact/NhoRuJeTcEfxaz5WbNBhKU (비공개. 오너 계정에서만 열린다)
- CLI 설명: `../Plitsoft-SDP/README.md`
