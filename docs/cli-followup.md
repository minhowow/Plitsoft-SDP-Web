# CLI 따라가기

웹은 CLI(`../Plitsoft-SDP`)의 출력만 계약으로 받는다(`contract/README.md`). CLI 는 2026-11-10 에 웹이 고정할 판으로 태그
`handoff-w11`(`50c70bc`)을 원격에 올렸고, 13주(11/24~11/30)에 도구 판 태그 `v0.4.0` 을 따로 단다. 그 전까지 웹은 `handoff-w11` 을
고정하라고 적는다(CLI `docs/output.md`. 아래 "`a228856` → `handoff-w11`"). 웹의 고정 판은 아직 `7300205` 다. 이 문서는
CLI 가 바뀐 것을 언제, 어떻게 보고 어떤 순서로 받아들이는지 적는다. 요청은 `docs/cli-requests.md`, 사람이 정할 것은
`docs/ROADMAP.md` 의 "사람 결정이 필요한 것"에 둔다.

## 지금 맞춘 판 (2026-11-03. 2026-11-10 에도 그대로)

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
  고정, 표본 추첨"으로 둔다. 출력 모양은 11/16 까지 바뀌고 11/30 에 굳는다. (2026-11-05: 이 일정은 바뀌었다. 아래 절.)

## 2026-11-05 에 본 CLI 의 다음 판: `2eebd3a` → `a228856`

오너가 "CLI 쪽 문서가 갱신되었다"고 알려 다시 봤다. 갱신은 같은 가지(`interim-report-f1-evaluation`)의 HEAD `a228856`
(2026-11-05)에 있다. **원격에 없다**(11/5·11/7 `git ls-remote --heads --tags origin`: `main` = `7300205` 하나, 태그 없음). 그래서
고정 판은 `7300205` 그대로다. `2eebd3a` 뒤의 코드 변경은 `947a790`(응답이 오지 않는 요청은 한 번만 다시 보냄)과 주석뿐이고,
나머지는 문서와 평가 도구 지우기다. 저장소 밖 사본(판정자 끔, `--agent` 는 프로세스 안 가짜 응답으로 모양만)에서 본 것:

| 무엇 | 웹에 미치는 것 | 지금 깨지나 |
|---|---|---|
| 판정자를 끈 출력은 `7300205` 와 같다(표본 7개와 SARIF). 다른 것은 `pack_digest`(`a4a03e6c59c55602`)와 지문뿐. `schema_version` 1, `tool.version` 0.3.0.dev0 | 파서·스키마가 그대로 받는다 | 아니오 |
| 팩 문법 v0.4(`duties`, `_duties.jsonl`). 로더가 v0.3 을 받지 않는다 | 옮길 때 수집본·`data/pack-meta.json`·`analyze.yml` 과 `366a3dd4` 가 든 파일 22개(`tests/fixtures` 6, `contract/samples-v1-draft` 3, `src/lib/service/synthetic.ts` 등)를 한 커밋에서 바꾼다. pack-meta 는 `api_version`·`digest` 두 줄만 다르다 | 판 옮길 때 |
| `[api]` extra 삭제(SDK 대신 표준 라이브러리 HTTP) | 실행기 설치는 경고 한 줄을 남기고 성공한다(`--quiet` 라 로그에도 남지 않는다) | 아니오 |
| `--judge` 의 `haiku` 가 `claude-haiku-5-5` 인데 `run.judge` 는 `anthropic:haiku` 그대로다. 5.5 가 temperature 를 거절하면 빼고 다시 묻는다 | 판을 옮기면 `JUDGE_MODEL: haiku` 가 말없이 다른 모델이 되고, 결과로는 구별하지 못한다 | 판 옮길 때 |
| 판정자 시간 초과가 `transport` 로 분류된다(회귀. 메시지에 "timed out" 이 없다) | 화면 까닭이 "시간 안에 답하지 않음"이 아니라 "부르지 못함"이 된다. 연달아 세 번이면 그만 묻기가 돌지 않아 scan 15분 상한에 잘릴 수 있다(R24) | 판 옮길 때(`--judge` 유지 시) |
| `--agent` 를 켜면 `run.judge` = null. 에이전트가 푼 경고는 `run.agent.records`(재확인은 `recheck.records`)에만 있고 `findings`·`ai_cleared` 에 없다(R20 그대로) | 대시보드가 "판정자 꺼짐"과 "AI 가 푼 경고 없음"을 적고, 에이전트가 확인한 발견에도 "AI 확인 전"이 붙는다. 약속 "AI 가 푼 것을 숨기지 않는다"를 어긴다 | `--agent` 켤 때 |
| `--agent anthropic:haiku` 는 별칭을 풀지 않아 질문이 모두 실패해도 검사는 성공으로 끝난다 | 실행기가 별칭을 주면 조용히 AI 없는 결과가 된다(R7) | `--agent` 켤 때 |
| 팩에 없는 규칙의 발견(`agent-discovered`·`agent-independent`)이 `run.units` 밖에 생긴다. independent 는 `engine` = null, `units` = 0 | "판정한 곳이 없습니다"와 발견이 한 화면에 함께 나오고, 도감에 없는 규칙 id 가 보인다 | `--agent` 켤 때 |
| 인용 관문은 주석과 짧은 글만 거른다. 문자열 리터럴과 문서 줄은 통과하고 줄 번호는 보지 않는다(모델이 적은 값) | 인용 줄로 GitHub 링크를 만들면 엉뚱한 줄을 가리킬 수 있다(R25) | `--agent` 켤 때 |
| 전송: 비밀값 가리기는 에이전트 도구의 결과에만 걸린다. 검색으로 나간 줄은 `sent.read` 에 없다. 파일 이름 목록·전화·이메일은 가리지 않는다. JS/TS 밖 파일도 읽는다 | `docs/commitments.md` 의 "나가는 것"과 `src/lib/site.ts` 의 "보지 못하는 것"이 맞지 않게 된다(R26) | `--agent` 켤 때 |
| 공개 저장소의 글(주석·README·문자열)이 에이전트 판단을 끌고 갈 수 있다. 관문은 인용 글이 파일에 있는지만 본다 | 에이전트가 푼 경고는 인용한 파일·줄과 함께 보여야 한다 | `--agent` 켤 때 |
| 결과에 모델이 쓴 글: `reason`, `citations[].text`(거절된 것도), `questions[].raw`(2000자), `failure`(API 응답 300자) | 싣는 범위를 정해야 한다(ROADMAP). `RESULT_MAX_KB` 도 다시 본다 | `--agent` 켤 때 |
| 시간: 에이전트 요청 하나가 300초, 시간 초과는 한 번 더 보낸다. `--agent-max-units` 는 review 단계만 묶는다. 에이전트에 걸린 시간은 출력에 없다 | SCAN 15·job 20·RUN 25분과 대기열 120분을 다시 정한다(R10) | `--agent` 켤 때 |
| 비용 어림(CLI dev 20곳): 저장소당 review 약 $0.02, combined + sonnet 재확인 약 $0.2. 출력에는 토큰만 있다 | `DAILY_LIMIT` 30 이면 하루 약 $6(웹이 셈한 값) | `--agent` 켤 때 |
| 결정 0004: 정확도 실험을 접었다. 정확도 수치를 홍보에 쓰지 않는다 | F1 같은 수치를 소개·발표 글에 옮기지 않는다 | 아니오 |
| 여섯째 정책(개인정보 보호법 제28조의8·제26조)은 계획뿐이다. 정책은 5개 | 들어오면 팩 판이 또 바뀐다. 정책 5개를 가정한 시험과 v1 초안 예시를 고친다 | 아니오 |
| `_duties.jsonl`·의무 지도: `quote` 는 해시로 고정되지 않았고, `*_ko` 는 조사자의 해석이며 지도 원본 제목에 처분·액수가 있다. 결과 JSON 에는 duties 가 없다 | 조문으로 쓰지 않는다. 의무 지도 수치도 싣지 않는다 | 아니오 |

**바뀐 CLI 일정**(CLI `a228856` 의 `docs/roadmap.md`): 11주(11/10~11/16) "에이전트 결과의 JSON 계약을 웹에 넘김 / 웹이
에이전트 결과를 읽음"과 여섯째 정책, 13주(11/24~11/30) "도구 판 태그", 16주 "웹 서비스로 실제 분석 요청 시연". 11/9·11/30
고정과 표본 추첨은 없어졌고, 웹 서비스가 "미루는 것"에서 빠졌다. CLI 는 같은 판정이 웹에서 돌기를 바란다. 하지만 지금 판의
`--agent` 출력을 그대로 받으면 웹이 조용히 틀린다(위 표). 그래서 `run.agent` 는 계약(G1)으로 받기 전까지 읽지 않는다.

(2026-11-10: 위 표의 별칭(R7), 시간 초과 분류(R24) 행과 인용 행의 줄 번호 몫(R25. 문자열·문서 줄 거르기는 까닭과 함께 거절)은
`handoff-w11` 에서 고쳐졌고, 여섯째 정책이 들어왔다. 전송 행은 기록 몫만 고쳐졌다(검색 결과로 줄이 나간 파일 `matched`, 목록으로
나간 이름 수 `listed`, 읽기를 거절한 비밀 파일 `refused`. R26). 가리는 범위(파일 이름 목록·전화·이메일은 가리지 않음)와 JS/TS 밖
파일 읽기는 그대로다(`src/policypack/egress.py` 가 `a228856` 과 같다). 그래서 ROADMAP 의 "에이전트로 갈 때 바뀌는 약속"은 그대로
남는다. 아래 절.)

## 2026-11-10 에 본 CLI 의 다음 판: `a228856` → `handoff-w11`

CLI 쪽이 웹의 요청(`docs/cli-requests.md` 의 2026-11-05 표)에 답해 태그 `handoff-w11`(주석 태그 `5593756` → `50c70bc`, 2026-11-10)을
원격에 올렸다. 2026-11-10 `git ls-remote origin`: 태그와 가지 `interim-report-f1-evaluation` 끝이 `50c70bc`, `main` 은 `7300205`.
`7300205` 뒤로 커밋 26개다. CLI `docs/output.md` 는 이 판을 "웹이 고정할 판"이라고 적는다. 웹의 고정 판은 아직 `7300205` 다.
옮기는 것은 G1 이고 오너가 정한다(ROADMAP 의 "CLI 판을 옮기는 때").

본 방법: CLI 저장소는 읽기만 했다(`git log/show/diff/ls-remote`, `git archive 50c70bc` 를 scratchpad 에 풀기). 웹 저장소 밖의 작업
사본에서 `POLICYPACK_FROM=<풀어 둔 사본>` 으로 `capture`·`pack-meta` 를 돌리고 단위 시험을 돌렸다(예행). 판정자·에이전트는 끄고 API
키 없이 돌렸고, GitHub API 는 부르지 않았다. 브라우저 시험은 돌리지 않았다. 요청마다의 상태는 `docs/cli-requests.md` 의 맨 위 표다.

**출력 계약**

| 무엇 | 웹에 미치는 것 | 지금 깨지나 |
|---|---|---|
| 결과 JSON Schema `schemas/report-1.json` 과 계약 문서 `docs/output.md`(R2). `schema_version` 은 1 그대로다. 스키마는 닫혀 있고, 받는 쪽은 모르는 키를 무시하라고 적는다 | 웹 파서는 손으로 보는 방식을 그대로 둔다. 웹 수집본 7개(`7300205`)와 예행 수집본 7개가 이 스키마를 통과한다. 손 자료(`tests/fixtures`, `contract/samples-v1-draft`)와 SARIF 에서 옮긴 결과는 통과하지 않는다(`$comment`, 판 번호 없음, `run.policies`, `units: null`). 그래서 웹 스키마를 이 사본으로 바꾸지 않는다(`contract/README.md`) | 아니오 |
| 없어지거나 이름이 바뀐 키는 없다. 더해진 키는 모두 조건부다: `run.judge_usage`(API 판정자), `run.agent`, `findings[].agent` | `--judge` 결과는 그대로 읽는다(`judge_usage` 는 무시). `tests/contract.test.ts` 의 "judge_usage 는 이 판의 출력에 없다"는 이 판에서는 맞지 않아, 판을 옮길 때 고친다 | 판 옮길 때 |
| `run.judge` 에 실제 모델 id 가 실린다(`anthropic:haiku` → `anthropic:claude-haiku-5-5`). `--agent anthropic:haiku` 도 풀린다(R7) | 판을 옮기면 서비스 결과의 판정자 이름이 바뀐다. 화면은 글 그대로 적어 깨지지 않는다. `7300205` 의 `haiku` 와 다른 모델이지만 이제 결과로 구별된다 | 아니오 |
| API 판정자의 시간 초과가 `timeout` 으로 분류되고, 시간 초과나 닿지 못한 답이 연달아 세 번이면 그만 묻는다(R24) | `a228856` 의 회귀가 고쳐져 `7300205` 처럼 화면의 까닭이 "시간 안에 답하지 않음"이 되고, 그만 묻기가 다시 돈다. 서비스에 닿지 못한 답도 세게 넓어졌다. `questions_skipped` 가 닿지 못한 경우도 세므로 웹 스키마·타입의 설명을 넓힌다 | 아니오 |
| `--agent` 의 키(`run.agent`, `findings[].agent`, `reason`, `citations`)가 판 1 의 계약이다. 푼 경고는 여전히 `run.agent.records`·`recheck.records` 의 `action: cleared` 에만 있다(R20 은 글·SARIF 몫만). `--agent-time-limit`(R10), 인용 줄을 코드에서 다시 구함(R25), `sent` 보강(R26) | 아래 "`--agent` 결과를 지금 파서가 받으면" | `--agent` 결과를 열 때 |

**`--agent` 결과를 지금 파서가 받으면** (소스를 읽고 추론했다. 돌려 보지 않았다)

파서는 `run.agent` 를 보지 않고 거부하지도 않는다. 규칙 id 가 팩에 있는지도 보지 않는다. 그래서 받아들이고 조용히 틀린다.

- 에이전트가 푼 경고가 화면에서 빠진다(`ai_cleared` 만 읽는다). 약속 "AI 가 푼 것을 숨기지 않는다"를 어긴다.
- `--agent` 만 켠 결과는 `run.judge` = null 이라 판정자 "꺼짐"으로 보이고, `/view` 는 이미 코드가 나간 결과에 판정자를 켜 보라고
  권한다. 에이전트가 본 경고에도 "AI 확인 전"과 "판정자가 꺼져 있어" 까닭이 붙는다.
- independent 는 `units: 0`, `engine: null` 이라 "판정한 곳이 없습니다"와 `agent-independent` 경고가 한 화면에 나온다. 질문이 모두
  실패하면 경고 0, `coverage_complete: true` 로 다 본 것처럼 보인다. CLI 는 종료 코드 1 로 알리지만 실행기는 0 과 1 을 같게 받는다.
- 답을 받지 못한 질문, 시간 상한으로 보내지 않은 질문, `--agent-max-units` 로 묻지 않은 단위가 "다 보지 못한 것"에 나오지 않는다.
- 서버가 결과를 통째로 저장하면 `raw`, `reason`, 거절된 인용의 글, 검색어가 함께 저장된다.

실행기는 `--judge` 를 쓰므로 서비스에는 이런 결과가 들어오지 않는다. `/view` 에는 사용자가 연 파일로 들어올 수 있다(`--agent` 가
처음 든 `dc23f2c`(2026-11-03) 부터의 CLI 로 만든 `--agent` 결과). 어떻게 할지는 ROADMAP 의 "서비스의 AI 방식과 모델 id".

**팩**

| 무엇 | 웹에 미치는 것 |
|---|---|
| 팩 판 `366a3dd4fdae08d8` → `7897fc0f79ce975b`. 문법 v0.4(정책마다 `duties` 한 줄) | 모든 지문이 바뀐다(R3). `scripts/export-pack-meta.mjs` 는 고치지 않고 돈다. `duties` 는 계속 버린다 |
| 여섯째 정책 `kr.pipa.28-8`(개인정보를 국외 AI API 로 보내는 국외 이전). 조문 둘: 개인정보 보호법 제28조의8 제1항, 제26조 제2항. 두 원문의 해시가 팩에 적힌 값과 맞다. 규칙 하나, 대안 둘(약한 정적, AI) | 조문 도감에 쪽이 저절로 생긴다(`generateStaticParams`). 정책 수 5 를 박은 시험이 깨진다. 새 쪽은 브라우저로 확인한다 |
| 있던 다섯 정책의 판정 내용은 같다 | — |

**예행 결과 (판정자·에이전트 끔, 표본 7개)**

- 판정은 바뀌지 않았다. 종료 코드·판정 단위 수·발견 수·상태·키가 `7300205` 와 같다. 바뀐 것은 `run.pack_digest` 와 모든 지문
  (SARIF 의 `partialFingerprints` 도)뿐이다. 새 정책은 어느 표본에서도 판정 단위를 만들지 않았다.
- `tool.version` 은 `0.3.0.dev0`, 엔진은 semgrep 1.176.1 그대로다.
- `data/pack-meta.json`: `api_version` 이 v0.3 에서 v0.4 로, `digest` 가 새 값으로, 정책 `kr.pipa.28-8` 이 더해진다.
- `git archive` 로 꺼낸 사본은 git 저장소가 아니라서 `MANIFEST.json` 의 `commit`·`committed_on`·`dirty` 가 null 이 된다(예행에서는
  손으로 채웠다). 실제로 옮길 때는 태그의 git 사본으로 수집한다(아래 "따라가는 절차" 3).
- 단위 시험(1638개): 수집본·팩 메타데이터만 바꾸면 239개가 실패한다. 대부분(`tests/record.test.tsx` 의 203개)은 손 자료
  (`tests/fixtures` 6개, `contract/samples-v1-draft` 3개)의 팩 판이 옛것이라 기록을 만들지 않아서다. `CLI_COMMIT`·`CLI_EXCLUDE_NEWER`,
  손 자료와 `src/lib/service/synthetic.ts` 의 팩 판을 고치고, v1 초안 예시를 새 수집본에서 다시 만들면(`run.policies` 에
  `kr.pipa.28-8` 줄) 16개가 남는다.
  - 정책 수 5 를 박은 기대 15개: `tests/render.test.tsx` 9, `tests/view-model.test.ts` 5, `tests/sarif.test.tsx` 1. 팩에서 세도록 고친다.
  - `tests/runner.test.ts` 1개: `CLI_EXCLUDE_NEWER`(2026-11-10)가 오늘보다 2주 넘게 앞이어야 한다. 계약 시험은 같은 값이 커밋 날짜이기를
    바라므로 2026-11-24 00:00 UTC(한국 09:00) 전에는 둘을 함께 통과시킬 수 없다(ROADMAP 의 "2주 앞" 시험).
- 브라우저 시험은 돌리지 않았다. 정적으로 찾아본 `tests/browser/served-files.test.ts`, `tests/policy-page.ts` 에서는 기대값이 팩에서
  센다(메모 수 = 정책 수 × 2, 모든 정책의 쪽을 돈다). "다섯"·"5"는 주석과 시험 이름에만 있었다. 그래서 깨질 곳은 알려진 것이 없지만,
  돌려 보기 전에는 모른다.
- 실행기 설치: `[api]` extra 가 없다. 예행은 CLI 를 `capture` 의 `uvx --from <휠>` 으로만 설치해 `[api]` 를 청하지 않았다. 따로
  `50c70bc` 의 휠을 `policypack[api]` 로 오프라인 설치해 본 확인(`uvx --offline`)에서 uv 는 없는 extra 를 경고로 넘기고 설치했다
  (종료 코드 0). 실행기의 `git+https` 경로로는 해 보지 않았다.

**CLI 일정**(CLI `50c70bc` 의 `docs/roadmap.md`): 11주(11/10~11/16)의 끝 기준은 "웹이 에이전트 결과를 읽음"(웹은 오너 결정 전에는
`--agent` 결과를 읽지 않는다. 이를 CLI 쪽에 알리는 것은 ROADMAP 의 사람의 일), 13주(11/24~11/30)는
도구 판 태그, 14주(12/1~12/7)는 공개 저장소 몇 곳을 결합 방식으로 돌려 사례를 모음, 16주(12/15~12/21)는 웹 서비스로 실제 분석 요청
시연이다. 그 밖에 이 판에 든 것: 운영 지표 스크립트(`scripts/metrics.py`. 웹은 쓰지 않는다), 에이전트가 서비스에 닿지 못하면 두
질문 뒤 멈추기, independent 에서 답을 받지 못한 질문이 있으면 경고가 없어도 종료 코드 1(`--fail-on uncertain`, 기본. `cli.py`,
`docs/output.md`).

## 웹에 미치는 영향

2026-11-10 에 `handoff-w11` 을 보고 고쳤다. "판을 옮길 때"는 고정 판을 `7300205` 에서 옮기는 G1 이다.

| 영역 | 영향 | 지금 | 할 일 | 언제 |
|---|---|---|---|---|
| 결과 파서·스키마 | 결과 판 1 을 받는다. CLI 가 공식 스키마(`schemas/report-1.json`)를 냈지만 닫혀 있다 | **풀었다**(2026-11-03). `7300205` 의 출력을 받고, 모르는 판은 거부한다. `handoff-w11` 의 `--judge` 출력도 그대로 읽는다 | 웹 스키마를 CLI 사본으로 바꾸지 않는다(G1 의 계획: 사본을 두면 수집본을 견주는 시험에만 쓰고, 웹 스키마는 열어 둔다. 지금 사본은 없다). 판 옮길 때 `run.judge_usage`(선택)를 웹 스키마에 넣고 `tests/contract.test.ts` 의 "이 판에 없다" 시험을 바꾼다. 판이 2 로 오르면 다시 본다 | 판을 옮길 때 |
| `--agent` 결과를 연 `/view` | 지금 파서는 `run.agent` 가 든 결과를 거부하지 않고 받아 조용히 틀리게 보인다(위 절) | `dc23f2c`(2026-11-03, `7300205` 뒤 `--agent` 가 처음 든 커밋) 부터의 CLI 로 만든 `--agent` 결과를 사용자가 열면 그렇다. 서비스 실행기는 `--judge` 라 해당 없다 | 거부하거나 "에이전트 검토는 아직 읽지 못함"을 알린다(사람 결정. ROADMAP 의 "서비스의 AI 방식과 모델 id") | 결정 뒤 |
| 수집본·팩 메타데이터·실행기의 판 | 셋이 다르면 결과를 읽지 못하거나 조문별 기록을 만들지 못한다 | **맞췄다**(`7300205`). 시험이 고정한다 | 셋을 한 커밋에서 함께 옮긴다. `handoff-w11` 은 태그의 git 사본으로 수집한다(절차 3) | 판을 옮길 때 |
| `npm run local -- --cli` | 옆 폴더의 CLI(HEAD `7300205`)를 빌드해 돌린다(`scripts/local-runner.mjs` 가 `../Plitsoft-SDP` 를 고정으로 가리킨다) | 파서가 받으므로 이제 돈다(돌려 보지는 않았다. 수집본이 같은 커밋의 같은 출력이다) | 옆 폴더의 HEAD 는 CLI 쪽 사람이 정한다. 웹은 바꾸지 않는다. 고정 판을 옮기면 옆 폴더(`7300205`, 팩 `366a3dd4`)의 결과가 사이트의 팩(`7897fc0f`)과 어긋나 정책 카드가 "알 수 없음"이 되고 조문별 기록을 만들지 않는다. 옆 폴더의 HEAD 가 고정 판과 같아지거나, 로컬 실행기가 복제를 가리킬 수 있게 될 때까지(코드를 고치는 일이라 G1·오너 결정 뒤) 그렇다 | 판을 옮길 때 |
| 지문 | 팩 판이 바뀌면 모두 바뀐다(판정에 쓰이지 않는 duties 만 더해도) | 판이 다른 결과끼리 지문으로 견주지 않는다 | R3 | 판을 옮길 때 |
| 정책 수 | `handoff-w11` 의 팩은 정책 6개다(`kr.pipa.28-8`) | 정책 5개를 박은 단위 시험 15개(`render` 9, `view-model` 5, `sarif` 1). 브라우저 시험은 돌리지 않았다(정적으로 찾아본 곳은 팩에서 센다) | 팩에서 세도록 고친다. 새 도감 쪽을 좁은 화면·어두운 테마로 본다 | 판을 옮길 때 |
| 손 자료의 팩 판 | 팩 판이 다르면 기록을 만들지 않고 정책 카드가 "알 수 없음"이 된다 | `366a3dd4` 가 `tests/fixtures` 6개, `contract/samples-v1-draft` 3개, `src/lib/service/synthetic.ts` 에 있다 | 새 판으로 바꾸고, v1 초안 예시는 새 수집본에서 다시 만들어 `run.policies` 에 여섯째 줄을 더한다 | 판을 옮길 때 |
| 팩 메타데이터 내보내기 | v0.4 의 `duties` 를 버린다 | 안 깨진다. 예행에서 새 정책도 고치지 않고 옮겼다 | duties id 옮기기는 해도 된다. 의무 설명을 싣는 것은 사람이 정한다(`_duties.jsonl` 의 `quote` 는 해시로 고정한 원문이 아니라 조문으로 쓰지 않는다) | 판을 옮길 때 |
| 실행기 설치 | 없는 `[api]` 를 청한다 | `7300205` 에는 있다. `handoff-w11` 에는 없다. 그 판의 휠을 `[api]` 로 따로 설치해 본 확인에서 uv 는 경고로 넘기고 설치했다(실행기의 `git+https` 경로는 해 보지 않았다) | `[api]` 를 빼고(`runner/run.mjs`, `tests/runner.test.ts`) `docs/direction.md`, `docs/architecture.md` 의 글도 고친다 | 판을 옮길 때 |
| `CLI_EXCLUDE_NEWER` | 고정 커밋의 날짜여야 한다 | 2026-10-08 | 커밋과 함께 바꾼다. `tests/runner.test.ts` 는 그 날짜가 오늘보다 2주 넘게 앞이기를 바란다. `handoff-w11`(2026-11-10)이면 2026-11-24 00:00 UTC 전, 13주 태그(11/24~11/30)면 12/8~12/14 전에는 그 시험과 부딪친다(사람 결정) | 판을 옮길 때 |
| `JUDGE_MODEL: haiku` | `handoff-w11` 에서 `haiku` 는 `claude-haiku-5-5` 로 풀리고 결과의 `run.judge` 에 실제 id 가 실린다(R7). `7300205` 의 `haiku`(`claude-haiku-4-5-20251001`)와는 다른 모델이다. 5.5 세대에는 `temperature=0` 이 400 으로 거절돼 CLI 가 빼고 다시 보낸다(CLI 는 temperature 0 을 같은 질문에 같은 답이 나올 확률을 높이려고 둔다). API 판정자가 SDK 대신 표준 라이브러리 HTTP 로 부르고, 429·5xx 는 10~40초 쉬고 네 번까지, 시간 초과는 한 번 더 보낸다(`judge/http.py`) | 안 깨진다 | 별칭으로 둘지 전체 id 로 적을지 정한다(사람 결정). 별칭이면 CLI 판을 옮길 때마다 모델이 바뀔 수 있다. 전체 id 는 고정 판과 맞아야 한다: `7300205` 는 늘 `temperature=0` 을 보내고 400 을 다시 보내지 않으며 그만 묻기는 시간 초과만 세므로, 거기에 5.5 세대 id 를 주면 질문이 모두 실패해 판정자 없는 결과가 된다(CLI `50c70bc` 의 "5.5 세대 모델은 temperature 를 받지 않아" 실측 기록과 `7300205` 의 소스로 추론. 돌려 보지 않았다). `7300205` 에서는 `claude-haiku-4-5-20251001`(지금 `haiku` 가 가리키는 모델), 5.5 세대 id 는 `handoff-w11` 부터다. `handoff-w11` 에 `claude-haiku-4-5-20251001` 을 주면 옛 모델과 `temperature=0` 이 남는다 | 판을 옮길 때 |
| 판정자 시간 초과 | `a228856` 에서 `transport` 로 분류됐다(R24) | `7300205` 는 맞다. `handoff-w11` 에서 고쳐졌다(`timeout`, 연달아 세 번이면 그만 묻기) | 웹 스키마·타입의 `questions_skipped` 설명을 "시간 초과나 닿지 못함"으로 넓힌다 | 판을 옮길 때 |
| `--agent` 출력 | 푼 경고가 `findings`·`ai_cleared` 밖(`records`·`recheck.records`)에 있다. 팩에 없는 규칙 id. `reason` 은 자유 문장. `questions[].sent` 는 밖으로 나간 것(읽은 파일, 검색어, 검색 결과 파일, 이름 수, 거절한 비밀 파일, 가린 수) | 쓰지 않으면 영향 없다(`/view` 는 위 줄) | 푼 경고를 `records` 에서 읽어 보인다(약속: AI 가 푼 것을 숨기지 않는다). 보낸 것을 목록과 개수로 보인다. `reason` 은 해석하지 않는다. 인용 링크는 `ok: true` 인 것만. `raw`·거절된 인용의 글은 싣지도 저장하지도 않는다. 결과 부품은 재디자인 D5 에서 받을 자리를 만들어 두었다(`run.agent` 는 읽지 않는다) | G1(`--agent`) |
| 시간·크기 상한 | combined 는 dev 에서 최대 1,601초였다(CLI 저장소 밖의 평가 기록). `handoff-w11` 에 `--agent-time-limit` 이 생겼다. 상한은 모델 요청을 보내기 전마다 본다(질문을 시작할 때와 대화의 다음 차례 앞). 이미 보낸 요청은 끊지 않아 300초까지 기다리고 답이 없으면 한 번 더 보내며, 429·5xx 는 쉬는 시간만 합해 약 100초 동안 다시 보낸다. `run.agent.questions[].raw` 가 결과를 키운다 | 쓰지 않으면 영향 없다 | scan 15분, job 20분, 사이트 25분, 대기열 120분, `RESULT_MAX_KB` 4000 을 다시 보고, `--agent-time-limit` 은 scan 상한에서 이미 보낸 요청 하나가 끝나기까지의 시간(300초 × 2 와 재시도 쉼, 약 12분)을 뺀 값보다 짧게 준다 | G1(`--agent`) |
| SARIF | 정적 대안으로 풀린 단위가 없다. `handoff-w11` 에서 `agent` 자리가 더해졌다 | SARIF 로 연 결과는 "발견 없음". `agent` 는 읽지 않는다 | R11 에 덧붙임 | CLI 쪽 |

## 언제 무엇을 하나

2026-11-10 에 고친 차례다(그 전 차례는 2026-11-05 의 CLI 일정에 맞춘 것이었다). 고정 판은 **배포(B4, 12/1) 전에 한 번만** 옮긴다는
원칙은 그대로다. 판정 변화 없이 수십 개 파일과 모든 지문이 바뀌고, 배포 뒤에 옮기면 판이 다른 옛 분석이 DB 에 남기 때문이다.

**지금(11/10~)**

- 고정 판은 `7300205` 그대로다. `handoff-w11` 은 원격에 있어 고정할 수 있게 됐지만, 옮기는 것은 오너가 정한다(ROADMAP 의 "CLI 판을
  옮기는 때"). 정하기 전에는 수집본·`data/pack-meta.json`·실행기·`JUDGE_MODEL` 을 바꾸지 않는다.
- 하지 않는 것: 실행기를 `--agent` 로 바꾸기, 스키마·타입·파서에 `run.agent`·`findings[].agent` 넣기, `duty_ko` 같은 의무 해석과
  의무 지도 수치 싣기, 정확도 수치 쓰기, 판정자나 에이전트를 켠 실제 수집(사람 결정).
- 요청 전달은 끝났다(2026-11-10 답). 남은 요청은 `docs/cli-requests.md` 의 맨 위 표다. 새로 청할 것이 생기면 거기에 적는다.

**오너가 판 옮기기를 정한 뒤, 배포(12/1) 전에 한 번**

- 절차 3 으로 수집본·팩 메타데이터·`CLI_COMMIT`·`CLI_EXCLUDE_NEWER` 를 함께 옮긴다.
- 함께 하는 것: `[api]` 빼기(`runner/run.mjs`, `tests/runner.test.ts`, `docs/direction.md`, `docs/architecture.md`), `JUDGE_MODEL`(오너가
  고른 값), 손 자료(`tests/fixtures`, `contract/samples-v1-draft`, `src/lib/service/synthetic.ts`)의 팩 판, 정책 수를 가정한 시험,
  웹 스키마의 `run.judge_usage`·`questions_skipped` 설명, 새 도감 쪽의 브라우저 확인, `CLAUDE.md` 의 "고정 CLI(`7300205`)" 줄.
- `handoff-w11` 이면 `tests/runner.test.ts` 의 "2주 앞" 시험은 2026-11-24 00:00 UTC 부터 통과한다. 그 전에 옮기려면 그 시험을 바꾸는
  결정이 먼저다.

**13주(11/24~11/30) 뒤**

- 절차 1 로 `v0.4.0` 태그가 원격에 올라왔는지 본다. 올라왔으면 절차 2 로 사본에서 돌려 이 문서에 관찰 절을 적는다.
- 이미 `handoff-w11` 로 옮겼으면 `v0.4.0` 으로 다시 옮길지는 그 판이 웹에 무엇을 더하는지 보고 오너가 정한다(배포 전 한 번의 원칙과
  "2주 앞" 시험이 걸린다).

**오너가 `--agent` 읽기(G1)를 맡긴 뒤** (실행기는 그동안 `--judge` 그대로다. ROADMAP 의 "서비스의 AI 방식과 모델 id")

- 스키마·타입·파서에 `run.agent`·`findings[].agent` 를 넣고 D5 의 자리를 채운다(푼 경고 = `ai_cleared` + `records`·`recheck.records`
  의 cleared, 판정은 `status.ts` 의 말로만, 인용 링크는 `ok: true` 인 것만).
- 답을 받지 못한 질문·보내지 않은 질문(`skipped_reasons`)·묻지 않은 단위를 "다 보지 못한 것"에 넣는다. independent 의 `units: 0` 을
  "판정한 곳 없음"으로 적지 않는다.
- 실행기 env(모델·방식·재확인·`--agent-time-limit`)와 `runScan` 인자, 종료 코드 1 의 뜻, 시간·크기 상한, 저장할 필드, 약속 문구를 고친다.
- 완료 조건: 에이전트가 푼 경고가 화면에 보이고, `run.judge` = null 인 에이전트 결과에 "판정자 꺼짐"이 나오지 않고, 답을 받지 못한
  것이 "다 보지 못한 것"에 보인다.
- 마지막에 따로: 오너가 고른 저장소 2~3곳을 오너 키로 돌려 시간·비용을 본 뒤, 오너가 정하면 실행기를 `--agent`(review 나
  combined + 재확인)로 바꾼다. 읽기를 마친 것만으로 실행기를 바꾸지 않는다.

## 따라가는 절차

1. **본다.** 13주(11/24~11/30) 뒤, 그 뒤 주 1회. 오너가 CLI 쪽 소식을 알려 주면 그때도.
   - `git -C <CLI> log <고정>..<볼 커밋>` (옆 폴더의 HEAD 는 웹이 고정할 판과 다를 수 있다. 2026-11-10 의 HEAD 는 `main` = `7300205`)
   - `git -C <CLI> ls-remote origin` (가지와 태그. 원격에 없는 커밋은 고정하지 않는다)
   - `git -C <CLI> diff <고정>..<볼 커밋> -- src/policypack/report/ src/policypack/cli.py pyproject.toml policies/ schemas/ docs/output.md docs/roadmap.md`
   - 읽기만 한다. CLI 저장소에 아무것도 쓰지 않는다(checkout·fetch 도 하지 않는다).
2. **사본에서 먼저 돌린다.** 이 저장소의 `contract/` 와 `data/` 를 바꾸기 전에 저장소 밖(scratchpad)에서 한다.
   - `git -C <CLI> archive <커밋>` 으로 꺼내 `contract/fixtures` 의 표본 7개를 `--judge none` 으로 돌리고 종료 코드를 적는다.
     웹 저장소의 작업 사본(`git worktree add`)에서 `POLICYPACK_FROM=<꺼낸 사본>` 으로 `capture`·`pack-meta` 를 돌려도 된다.
   - 결과를 웹 파서(`parseReport`)로 읽어 본다. CLI 의 `schemas/report-1.json` 으로도 검사해 본다(수집본만).
   - 팩 판을 셈한다(`pack.yaml` sha256 앞 16자).
   - 판정·키·종료 코드를 지금 수집본과 견주고, 단위 시험을 돌려 실패를 까닭별로 적는다.
3. **같이 돌리고 고정 판을 맞춘다.** 판정·키·종료 코드가 설명되고 파서가 통과하면, 원격에 있는 그 커밋으로:
   - CLI 저장소의 HEAD 가 그 커밋이 아니면 읽기만 하는 복제를 만든다. 먼저 옆 폴더의 태그가 `ls-remote` 에서 본 것과 같은 커밋인지
     본다(`git -C <CLI> rev-parse <태그>^{commit}`). 같으면 `git clone --branch <태그> <CLI> <scratchpad>/<폴더>/Plitsoft-SDP`,
     태그가 옆 폴더에 없거나 다르면 옆 폴더에서 fetch 하지 말고 원격 주소(`git -C <CLI> remote get-url origin`)에서 같은 명령으로
     복제한다 (폴더 이름을 `Plitsoft-SDP` 로 두면 `MANIFEST.json` 의 `from` 이
     지금과 같다). `git archive` 사본은 git 저장소가 아니라 `MANIFEST.json` 의 커밋·날짜·`dirty` 가 비므로 쓰지 않는다.
   - `POLICYPACK_FROM=<CLI 폴더> POLICYPACK_PACK_DIR=<CLI 폴더>/policies/kr-core npm run capture && npm run pack-meta`
     (늘 함께 돌린다. 작업 사본에서 돌릴 때는 두 변수로 CLI 폴더를 가리킨다)
   - `MANIFEST.json` 의 `cli.commit` 이 그 커밋이고 `cli.dirty` 가 `false` 인지 본다. 아니면 되돌린다.
   - `git diff contract/ data/` 를 읽고 판정이 바뀐 까닭을 커밋 메시지에 적는다. v1 초안 예시(`contract/samples-v1-draft/`)와
     손으로 만든 시험용 자료(`tests/fixtures/`)의 팩 판도 맞춘다.
   - 같은 커밋에서 `analyze.yml` 의 `CLI_COMMIT`(40자)과 `CLI_EXCLUDE_NEWER`(그 커밋의 날짜)를 바꾼다. 시험이 셋을 견준다.
   - `npm run check` 를 통과시킨다.
4. **파서가 깨지거나 뜻이 바뀌면** 파서를 서둘러 고치지 않는다. 수집본을 되돌리고 ROADMAP 의 "사람 결정이 필요한 것"에
   적는다. 판 번호가 오르면(있던 키가 없어지거나 뜻이 바뀜) 계약을 다시 정하는 일이다.
5. **"해시까지 고정".** 실행기는 CLI 를 git 에서 설치하므로 CLI 의 `uv.lock` 을 쓰지 않는다. `--exclude-newer` 는 그날 뒤의
   판만 막고 받은 파일의 해시는 보지 않는다. 더 묶으려면 CLI 가 해시가 든 제약 파일을 내 주거나(R22), 실행기가 CLI 저장소를
   받아 `uv sync --frozen` 으로 설치해야 한다(ROADMAP 의 결정).
