# CLI 따라가기

웹은 CLI(`../Plitsoft-SDP`)의 출력만 계약으로 받는다(`contract/README.md`). CLI 는 11/30 도구 고정까지 바뀐다. 이 문서는
CLI 가 바뀐 것을 언제, 어떻게 보고 어떤 순서로 받아들이는지 적는다. 요청은 `docs/cli-requests.md`, 사람이 정할 것은
`docs/ROADMAP.md` 의 "사람 결정이 필요한 것"에 둔다.

## 지금 맞춘 판 (2026-11-03)

| 자리 | CLI 커밋 | 팩 판(`pack.yaml` sha256 앞 16자) |
|---|---|---|
| 수집본 `contract/cli-current/` (`MANIFEST.json`) | `7300205` (2026-10-08, `dirty: false`) | `366a3dd4fdae08d8` |
| 팩 메타데이터 `data/pack-meta.json` | `7300205` 의 `policies/kr-core` | `366a3dd4fdae08d8` |
| 실행기 `.github/workflows/analyze.yml` | `CLI_COMMIT` `7300205b7e…`, `CLI_EXCLUDE_NEWER` 2026-10-08 | 같다 |

셋이 같은 커밋이라는 것은 `tests/contract.test.ts` 의 "수집본, 팩 메타데이터, 실행기가 같은 CLI 커밋이다"가 본다. 그 전에는
수집본과 팩 메타데이터가 `8ae72d8`(팩 판 `fa6fc2b3…`)이고 실행기만 `7300205` 였다. 그 사이에 웹 파서는 `7300205` 의
출력(`schema_version: 1`)을 "모르는 schema_version"으로 거부했으므로, 배포했다면 모든 분석이 정리 단계에서 실패로 끝났다
(`callbacks.ts` 가 결과를 읽지 못하면 실패로 적는다).

### `8ae72d8` → `7300205` 로 다시 수집하며 바뀐 것 (판정자 없음, 표본 7개)

정책, 규칙, 상태(`outcome`), 파일, 줄, 종료 코드, 판정 단위 수, 발견 수는 표본 7개 모두 같다. 바뀐 것:

| 표본 | 바뀐 것 | 까닭 |
|---|---|---|
| 모두 | `schema_version: 1`, `run.fingerprint_version`("policypack/v1"), `run.questions_skipped`(0), `run.static_cleared` 가 더해졌다 | CLI `e1e46a9` 의 출력 계약 덧붙임 |
| 모두 | `run.pack_digest` 가 `fa6fc2b3…` 에서 `366a3dd4…` 로, 그에 따라 모든 `fingerprint` | 지문이 팩 판에 묶여 있다(R3) |
| `kids-signup.fixed` | `run.static_cleared` 에 `kr.pipa.22-2` / `signup-without-guard` / `src/auth/signup.ts` 5행, 대안 `under14-branch` 가 맞은 줄 7행 | 강한 정적 대안으로 풀린 단위가 결과에 실린다(R1 의 충족 근거 위치) |
| `kids-signup.main` | 확인되지 않은 대안에 `age-gate-text`(약한 정적 대안, 고치는 법 없음)가 더해졌다. 판정 경로에도 한 줄 | 팩의 가입 규칙에 대안이 더해졌다(`17c7894`) |
| `night-push.fixed` | 제50조 제3항 발견의 `scope` 가 `file` 에서 `anchor` 로, `region` 9~19행, `anchor_lines` [12]. 판정 경로 첫 줄 끝에 `[구역 9~19행]` | 야간 광고 규칙이 발송 함수마다 판정하게 됐다(`1df8cd3`). kr-core 의 첫 함수 단위 규칙이다 |
| `kids-signup.main.sarif` | 규칙 도움말의 작성자 메모 위에 "팩 작성자의 설명 (법 원문이 아닙니다)" 제목, 시행일 줄의 풀이, 태그에서 `effective-from:` 이 빠졌다 | CLI `sarif.py` 바뀜. 웹은 이 필드를 읽지 않는다 |
| `data/pack-meta.json` | 시행령 제23조 두 곳의 `effective_from` 이 2026-01-22 에서 2026-08-20 으로, 가입 규칙의 적용 조건에 `signup-hint` 와 대안 `age-gate-text`, 야간 광고 규칙의 `scope: anchor`, 대안의 글 두 곳(`ai-prior-notice` 의 질문에서 "법 제2조 제7호", `ai-start-block` 의 고치는 법에서 "별표 6"), 작성자 메모 여러 곳(웹은 싣지 않는다) | 팩의 법 문구 정리(`b5c277e`)와 규칙 고침 |

화면에 생긴 변화:

- 고친 뒤의 아동 가입(`kids-signup.fixed`)에서 `kr.pipa.22-2` 가 "발견 없음"이 아니라 **"충족 근거 발견"**이고, 카드에
  "`src/auth/signup.ts:7` 에서 대안 `under14-branch` 확인"이 적힌다. 판정 단위 수 옆의 말도 그 자리를 가리킨다. 데모의 두
  결과의 표와 조문별 검사 기록의 정책 표도 같은 상태를 적는다. 정적 대안으로 풀린 단위가 없는 정책은 그대로 "발견
  없음"이다. CLI 가 적는 "단위 수 = 발견 + AI 가 푼 것 + 정적 대안으로 풀린 것"으로 정책별 수나 "적용 신호 없음"을 셈해
  낼 수는 있지만 하지 않았다. `--agent` 판에서 이 관계가 깨질 수 있다(`docs/cli-requests.md` 의 R20).
- 고친 뒤의 광고 푸시에서 12행 발견이 "함수 단위로 내린 판정입니다. 판정 구역은 9~19행입니다."로 보인다.
- 고치기 전의 아동 가입 발견을 펼치면 확인되지 않은 대안이 셋이고 셋째(`age-gate-text`)에는 "고치는 법이 실려 있지
  않습니다"가 적힌다.
- 같은 결과를 SARIF 로 열면 정적 대안으로 풀린 단위가 실리지 않아 "발견 없음"이다(R11 에 덧붙임).

## 2026-11-03 에 본 CLI 의 다음 판: `7300205` → `2eebd3a`

CLI 의 작업 사본(`interim-report-f1-evaluation` 가지)에서 읽고, 저장소 밖 사본에서 판정자를 끈 채로 표본 7개를 돌려 봤다.
두 저장소 모두 고치지 않았다. 판정자는 켜지 않았다.

- **원격에 없다.** 커밋 14개, 파일 64개. HEAD `2eebd3a`(2026-11-03)는 `git ls-remote --heads origin` 에 없다(원격의 `main`
  은 `7300205`). 실행기는 원격 커밋만 설치할 수 있으므로 이 판은 지금 고정할 수 없다.
- **판정자를 끈 출력은 `7300205` 와 같다.** 표본 7개의 판정, 키, 종료 코드가 같다. 다른 것은 `run.pack_digest`
  (`366a3dd4…` → `a4a03e6c59c55602`)와 그에 따른 모든 지문(SARIF 의 `packDigest`, `partialFingerprints` 도)이다.
  `schema_version` 은 여전히 1, `tool.version` 은 계속 `0.3.0.dev0` 이다. 결과 JSON 의 스키마 파일은 아직 없다.
- **팩 문법 v0.4.** 정책 다섯 개에 `duties`(의무 id 여섯 개)가 붙고 `_duties.jsonl` 이 생겼다. 정책 id, 조문 원문, 규칙,
  작성자 메모는 같다. CLI 주석은 duties 가 판정에 쓰이지 않는다고 적는다. 그런데도 팩 판이 바뀌어 지문이 모두 바뀐다
  (R3 에 덧붙임). 웹의 `scripts/export-pack-meta.mjs` 는 `duties` 를 조용히 버린다(R5 에 덧붙임).
- **`--agent anthropic:<모델 id>`.** 새 판정 방식이다. `--agent-mode review|combined|independent`, `--agent-recheck`
  (combined 에서만), `--agent-max-units`, `--agent-budget`. 켰을 때만 `run.agent`(records, questions, combined 는 discover·recheck),
  `findings[].agent`, 팩에 없는 규칙 id(`agent-discovered`, `agent-independent`)의 발견이 실린다. **에이전트가 푼 경고는
  `findings` 에서도 `ai_cleared` 에서도 빠지고 `run.agent.records[]` 의 `action: "cleared"` 에만 남는다.** 별칭을 풀지 않아
  전체 모델 id 를 줘야 한다.
- **`[api]` extra 가 없어졌다.** 판정자는 SDK 없이 표준 라이브러리 HTTP 로 부른다. `runner/run.mjs` 는 `policypack[api]` 를
  설치한다. 로컬 사본 설치에서는 경고(`does not have an extra named 'api'`)만 남았다(실행기의 `git+https` 경로로는 확인하지
  않았다).
- **`--judge` 의 별칭이 5.5 세대로.** `haiku` 가 `claude-haiku-4-5-20251001` 에서 `claude-haiku-5-5` 로, `sonnet`·`opus` 도
  5.5 다. 실행기의 `JUDGE_MODEL: haiku` 는 판을 옮기는 순간 조용히 다른 모델이 된다. API 판정자를 쓰면 `run.judge_usage` 가
  실린다(`7300205` 에는 없어 계약에 넣지 않았다).
- **일정.** CLI 로드맵은 11주(11/10~11/16)의 끝 기준을 "네 방식이 같은 JSON 으로 나옴"으로, 13주(11/24~11/30)를 "도구
  고정, 표본 추첨"으로 둔다. 출력 모양은 11/16 까지 바뀌고 11/30 에 굳는다.

## 웹에 미치는 영향

| 영역 | 영향 | 지금 | 할 일 | 언제 |
|---|---|---|---|---|
| 결과 파서·스키마 | 결과 판 1 을 받는다 | **풀었다**(2026-11-03). `7300205` 의 출력을 받고, 모르는 판은 거부한다 | 판이 2 로 오르면 다시 본다 | 판을 옮길 때 |
| 수집본·팩 메타데이터·실행기의 판 | 셋이 다르면 결과를 읽지 못하거나 조문별 기록을 만들지 못한다 | **맞췄다**(`7300205`). 시험이 고정한다 | 셋을 한 커밋에서 함께 옮긴다 | 판을 옮길 때 |
| `npm run local -- --cli` | 옆 폴더의 CLI(HEAD `7300205`)를 빌드해 돌린다 | 파서가 받으므로 이제 돈다(돌려 보지는 않았다. 수집본이 같은 커밋의 같은 출력이다) | — | — |
| 지문 | 팩 판이 바뀌면 모두 바뀐다(판정에 쓰이지 않는 duties 만 더해도) | 판이 다른 결과끼리 지문으로 견주지 않는다 | R3 | 판을 옮길 때 |
| 팩 메타데이터 내보내기 | v0.4 의 `duties` 를 버린다 | 안 깨진다 | duties id 옮기기는 해도 된다. 의무 설명을 싣는 것은 사람이 정한다(`_duties.jsonl` 의 `quote` 는 해시로 고정한 원문이 아니라 조문으로 쓰지 않는다) | 판을 옮길 때 |
| 실행기 설치 | 없는 `[api]` 를 청한다 | `7300205` 에는 있다 | `[api]` 를 빼고 `docs/direction.md`, `docs/architecture.md` 의 글도 고친다 | 판을 옮길 때 |
| `CLI_EXCLUDE_NEWER` | 고정 커밋의 날짜여야 한다 | 2026-10-08 | 커밋과 함께 바꾼다. `tests/runner.test.ts` 는 그 날짜가 오늘보다 2주 넘게 앞이기를 바란다. 11/30 판이면 12/14 전에는 그 시험과 부딪친다(사람 결정) | 판을 옮길 때 |
| `JUDGE_MODEL: haiku` | 판을 옮기면 4.5 에서 5.5 로 조용히 바뀐다. `--agent` 는 전체 id 가 필요하다 | 안 깨진다 | 전체 모델 id 로 적는다(사람 결정) | 판을 옮길 때 |
| `--agent` 출력 | 푼 경고가 `findings`·`ai_cleared` 밖에 있다. 팩에 없는 규칙 id. `reason` 은 자유 문장. `run.agent.questions[].sent.read` 는 밖으로 보낸 파일 목록 | 쓰지 않으면 영향 없다 | 푼 경고를 `records` 에서 읽어 보인다(약속: AI 가 푼 것을 숨기지 않는다). 보낸 파일 목록을 보인다. `reason` 은 해석하지 않는다 | 11/30 뒤 |
| 시간·크기 상한 | combined 는 dev 에서 최대 1,601초였다(CLI 저장소 밖의 평가 기록). `run.agent.questions[].raw` 가 결과를 키운다 | 쓰지 않으면 영향 없다 | scan 15분, job 20분, 사이트 25분, `RESULT_MAX_KB` 4000 을 다시 본다 | 11/30 뒤 |
| SARIF | 정적 대안으로 풀린 단위가 없다 | SARIF 로 연 결과는 "발견 없음" | R11 에 덧붙임 | CLI 쪽 |

## 언제 무엇을 하나

**지금(11/3~11/16)**

- 고정 판은 `7300205` 그대로다. 원격에 있는 커밋이 그것뿐이다.
- 결과 판 1 은 받았다. 화면은 판정자를 끈 `7300205` 출력으로 만든다.
- `docs/cli-requests.md` 의 R20~R23 과 R2·R3·R5·R7·R11 의 덧붙임을 CLI 쪽에 전한다(사람의 일).

**11/16 직후 (출력 모양이 정해진 뒤)**

- 아래 절차 1~2 로 그 판을 사본에서 돌려 본다. 원격에 올라갔는지부터 본다.
- `--agent` 출력의 모양(`run.agent`, `findings[].agent`)이 굳었는지, R20(푼 경고의 자리)에 답이 있는지 본다.
- 판정 방식(`--judge` 와 `--agent` review/combined)과 모델 id 를 오너가 정하도록 ROADMAP 에 올린 것을 다시 알린다.

**11/30 직후 (도구 고정)**

- 고정 커밋이 원격에 있으면 절차 3 으로 수집본·팩 메타데이터·실행기를 그 커밋으로 함께 옮긴다(옮길지는 사람 결정).
- 함께 하는 것: `[api]` 빼기, `JUDGE_MODEL` 을 전체 id 로, `CLI_EXCLUDE_NEWER` 를 그 커밋의 날짜로, 시간·크기 상한 다시 보기.
- `--agent` 를 쓰기로 했으면 그 출력을 계약에 넣고(스키마·타입·파서) 푼 경고와 보낸 파일 목록을 화면에 보인다.
- 판정자를 켠 실제 수집본은 API 키와 비용이 드는 사람 결정이다.

## 따라가는 절차

1. **본다.** 주 1회, 그리고 11/16 과 11/30 직후.
   - `git -C <CLI> log <고정>..HEAD`
   - `git -C <CLI> ls-remote --heads origin` (원격에 올라갔는지. 원격에 없는 커밋은 고정하지 않는다)
   - `git -C <CLI> diff <고정>..HEAD -- src/policypack/report/ src/policypack/cli.py pyproject.toml policies/ schemas/ docs/roadmap.md`
   - 읽기만 한다. CLI 저장소에 아무것도 쓰지 않는다.
2. **사본에서 먼저 돌린다.** 이 저장소의 `contract/` 와 `data/` 를 바꾸기 전에 저장소 밖(scratchpad)에서 한다.
   - `git -C <CLI> archive <커밋>` 으로 꺼내 `contract/fixtures` 의 표본 7개를 `--judge none` 으로 돌리고 종료 코드를 적는다.
   - 결과를 웹 파서(`parseReport`)로 읽어 본다.
   - 팩 판을 셈한다(`pack.yaml` sha256 앞 16자).
   - 판정·키·종료 코드를 지금 수집본과 견준다.
3. **같이 돌리고 고정 판을 맞춘다.** 판정·키·종료 코드가 설명되고 파서가 통과하면, 원격에 있는 그 커밋으로:
   - `POLICYPACK_FROM=<CLI 폴더> POLICYPACK_PACK_DIR=<CLI 폴더>/policies/kr-core npm run capture && npm run pack-meta`
     (늘 함께 돌린다. 작업 사본에서 돌릴 때는 두 변수로 CLI 폴더를 가리킨다)
   - `MANIFEST.json` 의 `cli.dirty` 가 `false` 인지 본다. `true` 면 되돌린다.
   - `git diff contract/ data/` 를 읽고 판정이 바뀐 까닭을 커밋 메시지에 적는다. v1 초안 예시(`contract/samples-v1-draft/`)와
     손으로 만든 시험용 자료(`tests/fixtures/`)의 팩 판도 맞춘다.
   - 같은 커밋에서 `analyze.yml` 의 `CLI_COMMIT`(40자)과 `CLI_EXCLUDE_NEWER`(그 커밋의 날짜)를 바꾼다. 시험이 셋을 견준다.
   - `npm run check` 를 통과시킨다.
4. **파서가 깨지거나 뜻이 바뀌면** 파서를 서둘러 고치지 않는다. 수집본을 되돌리고 ROADMAP 의 "사람 결정이 필요한 것"에
   적는다. 판 번호가 오르면(있던 키가 없어지거나 뜻이 바뀜) 계약을 다시 정하는 일이다.
5. **"해시까지 고정".** 실행기는 CLI 를 git 에서 설치하므로 CLI 의 `uv.lock` 을 쓰지 않는다. `--exclude-newer` 는 그날 뒤의
   판만 막고 받은 파일의 해시는 보지 않는다. 더 묶으려면 CLI 가 해시가 든 제약 파일을 내 주거나(R22), 실행기가 CLI 저장소를
   받아 `uv sync --frozen` 으로 설치해야 한다(ROADMAP 의 결정).
