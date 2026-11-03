# 배포할 때 오너가 할 일

에이전트는 계정·저장소·비밀값을 만들지 않고 배포하지 않는다(CLAUDE.md). 이 문서는 오너가 할 일과 넣을 환경 변수의 **이름**만
적는다. 값은 어디에도 적지 않는다. 기본값과 뜻은 `docs/direction.md` 의 "기본 제한 값", 전체 목록은 `.env.example` 이다.

지금(B2)은 계정 없이 이 컴퓨터에서 돈다(PGlite + 가짜 GitHub + 로컬 실행기, 3절의 `npm run local`). 아래를 갖추면 환경 변수만
바꿔 실제 환경으로 간다.

## 1. 웹(Vercel)

- Vercel 프로젝트를 이 저장소에 잇는다. 빌드 명령은 `npm run build`, Node 는 22 이상.
- Postgres 를 붙인다(Vercel Marketplace 의 Neon 등). 풀러(pooled) 주소를 `DATABASE_URL` 로 둔다. 스키마는 서버가 처음 DB 를
  열 때 `src/server/db/migrations/*.sql` 을 차례로 한 번 적용한다(따로 돌릴 명령이 없다).
- 환경 변수(Production):

| 이름 | 비밀값 | 무엇 |
|---|---|---|
| `DATABASE_URL` | 예 | Postgres 주소 |
| `GITHUB_TOKEN` | 예 | 검색·저장소 정보를 읽는 토큰. 권한이 없는 읽기 전용(fine-grained, 공개 저장소 읽기)이면 된다. 없으면 토큰 없이 부른다(시간당 요청 수가 낮다) |
| `RUNNER` | 아니오 | `github` |
| `RUNNER_REPO` | 아니오 | 실행기 저장소(`owner/repo`) |
| `RUNNER_WORKFLOW` | 아니오 | 비우면 `analyze.yml` |
| `RUNNER_REF` | 아니오 | 비우면 `main` |
| `RUNNER_TOKEN` | 예 | 실행기 저장소의 workflow_dispatch 를 부를 토큰(그 저장소의 Actions 쓰기만) |
| `RUNNER_SECRET` | 예 | 실행기 콜백의 서명 열쇠(실행기 저장소의 secret 과 같은 값). 없으면 콜백을 모두 거절한다. 길고 무작위인 값(예: 32바이트) |
| `SITE_URL` | 아니오 | 이 사이트의 주소(`https://…`, 실행기가 콜백할 곳. 실행기는 https 주소만 받는다) |
| `MAX_REPO_KB`, `DEDUPE_MINUTES`, `DAILY_LIMIT`, `POOL_SIZE`, `QUEUE_LIMIT`, `RUN_TIMEOUT_MINUTES`, `DISPATCH_TIMEOUT_MINUTES`, `QUEUE_TIMEOUT_MINUTES`, `RESULT_MAX_KB` | 아니오 | 상한. 비우면 기본값. `POOL_SIZE`(실행 자리 수)를 비우면 옛 이름 `CONCURRENT_LIMIT` 을 읽는다. 이미 `CONCURRENT_LIMIT` 을 넣어 두었으면 `POOL_SIZE` 로 옮긴다 |
| `SEARCH_CACHE_SECONDS`, `REPO_CACHE_SECONDS`, `COMMIT_CACHE_SECONDS`, `GITHUB_SEARCH_PER_MINUTE`, `GITHUB_CALLS_PER_MINUTE` | 아니오 | GitHub 을 부르는 캐시(서버 인스턴스마다)와 1분 예산(DB 의 카운터라 인스턴스가 함께 쓴다). 비우면 기본값 |

`SERVICE_STORE`·`PGLITE_DIR`·`GITHUB_API_BASE` 는 운영에서 비워 둔다(개발·시험용).

- **운영에 열기 전에, 실제 Postgres 에서 동시 요청 시험을 한 번 돌린다.** `npm run check` 는 PGlite(연결 하나)로만 돌아
  여러 연결이 같은 요청을 동시에 보내는 시험(`tests/server-db-pg.test.ts` 의 셋째 묶음)을 건너뛴다. 운영 DB 가 아닌 **비어 있는
  시험용** Postgres(이 컴퓨터에 설치, Neon 의 시험용 가지 등. 시험이 표를 지우고 쓴다)를 정한 뒤
  `TEST_DATABASE_URL=… npx vitest run tests/server-db-pg.test.ts` 로 돌려 건너뛴 시험이 0 이고 모두 통과하는지 본다(같은 요청,
  실행 자리 수를 넘기지 않는 대기열 넘기기, 집어 가기를 여러 연결로 동시에 보낸다).
  어디서 돌릴지는 `docs/ROADMAP.md` 의 "사람 결정이 필요한 것".

## 2. 실행기(GitHub Actions)

- 실행기로 쓸 GitHub 저장소를 정하고 Actions 를 켠다. 그 저장소에 이 저장소의 `.github/workflows/analyze.yml` 과 `runner/`
  (`run.mjs`, `tar.mjs`)를 둔다(이 저장소를 실행기 저장소로 써도 된다). 그 이름을 웹의 `RUNNER_REPO` 로 둔다.
- Actions secret(이름만 적는다):

| 이름 | 무엇 | 쓰는 단계 |
|---|---|---|
| `RUNNER_SECRET` | 웹의 `RUNNER_SECRET` 과 같은 값 | 알림·정리·멈춤(콜백) |
| `ANTHROPIC_API_KEY` | AI 판정자 | 검사 |
| `CLI_REPO_TOKEN` | CLI 저장소(`minhowow/Plitsoft-SDP`)가 비공개일 때만. 그 저장소 읽기 토큰 | 도구 설치 |

- Actions 변수(variable, 비밀값이 아니다):

| 이름 | 무엇 |
|---|---|
| `SITE_URL` | 웹의 `SITE_URL` 과 같은 주소(`https://…`). 워크플로가 입력으로 받은 콜백 주소의 출처를 이것과 견주고, 다르면 멈춘다. 두지 않으면 모든 분석이 입력 확인에서 멈춘다 |

- 저장소 tarball 은 워크플로 자체의 읽기 토큰(`github.token`)으로 받는다. 따로 만들 것이 없다.
- 도구의 판(CLI 저장소·고정 커밋, uv 판, 딸린 꾸러미의 날짜 `CLI_EXCLUDE_NEWER`)과 AI 판정자 모델(`JUDGE_MODEL`, 기본 `haiku`), 실행기 쪽 상한은 워크플로 파일의 `env` 에
  있다(`docs/direction.md` 의 표). 바꾸려면 그 파일을 고친다.
- Anthropic 콘솔에서 월 지출 상한을 정한다.

## 3. 로컬에서 운영 구성 흉내 내기

한 명령으로 셋(가짜 GitHub, 사이트, 로컬 실행기)을 함께 띄운다(`scripts/dev-local.mjs`). 하나가 멈추거나 Ctrl-C 를 누르면 모두 끈다.

```bash
npm run local                         # http://127.0.0.1:3000 (가짜 GitHub 은 127.0.0.1:4010). 검색 예: kids, genai, example-labs
npm run local -- --step-delay 3000    # 단계 사이 쉬는 시간(ms, 기본 1500). 진행과 대기열이 움직이는 것을 보기 좋다
npm run local -- --cli                # 수집본 대신 옆 폴더(../Plitsoft-SDP)의 CLI 를 uv 로 실제로 돌린다(판정자 없음)
```

사이트는 `RUNNER=local`, PGlite(`.data/local`, 지우면 처음부터)로 뜨고, 실행 자리(`POOL_SIZE`)는 기본 2다. 저장소 셋 이상을
잇따라 요청하면 셋째부터 대기열에 들어가고, 앞의 것이 끝나면 차례대로 돈다. 환경 변수는 이 명령 앞에 붙여 바꾼다(예:
`POOL_SIZE=1 npm run local`). `POOL_SIZE` 는 로컬 실행기가 함께 돌리는 수(`--parallel`)에도 같이 간다(자리를 얻은 분석을 모두
곧바로 집어 가게). 포트 3000·4010 은 고정이다(다른 사이트를 그 포트에 띄워 두었으면 먼저 끈다).

셋을 따로 띄울 수도 있다.

```bash
npm run github-stub                     # 가짜 GitHub API: http://127.0.0.1:4010
GITHUB_API_BASE=http://127.0.0.1:4010 RUNNER=local RUNNER_SECRET=local-dev npm run dev
RUNNER_SECRET=local-dev npm run local-runner -- --fixture --parallel 2   # 다른 창에서. 실행 자리를 얻은 분석을 집어 끝까지 돌린다(--parallel 은 POOL_SIZE 와 같게)
```

로컬 실행기는 GitHub 에서 받지 않고 가짜 GitHub 의 합성 저장소마다 정한 합성 데모 코드(`contract/fixtures/<이름>/main`)를 쓰고,
판정자를 켜지 않는다. `--fixture` 는 CLI 대신 `contract/cli-current` 의 수집본을 결과로 보낸다(빼면 `uv` 와 옆 폴더의 CLI 로
돌린다). `local-dev` 는 이 컴퓨터에서만 쓰는 아무 글이다(비밀값이 아니다). 로컬 실행기가 집어 가기를 물을 때도 서버가 대기열을
넘기므로 실행 자리 수를 넘겨 돌리지 않는다. `--parallel` 이 `POOL_SIZE` 보다 작으면 자리를 얻었는데 집히지 않은 분석이 생기고,
`DISPATCH_TIMEOUT_MINUTES`(10) 뒤에 "시작을 알리지 않아"로 실패한다.

DB 는 `.data/pglite`(`npm run local` 은 `.data/local`)에 생긴다(저장소에 올리지 않는다). 한 폴더를 두 서버가 함께 열지 않는다
(PGlite 는 한 프로세스만 연다).
