# CLI 따라가기

웹은 CLI(`../Plitsoft-SDP`)의 출력만 계약으로 받는다(`contract/README.md`). CLI 는 13주(11/24~11/30) 도구 판 태그까지
바뀐다(2026-11-05 에 본 일정. 아래 "`2eebd3a` → `a228856`"). 이 문서는
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

## 웹에 미치는 영향

| 영역 | 영향 | 지금 | 할 일 | 언제 |
|---|---|---|---|---|
| 결과 파서·스키마 | 결과 판 1 을 받는다 | **풀었다**(2026-11-03). `7300205` 의 출력을 받고, 모르는 판은 거부한다 | 판이 2 로 오르면 다시 본다 | 판을 옮길 때 |
| 수집본·팩 메타데이터·실행기의 판 | 셋이 다르면 결과를 읽지 못하거나 조문별 기록을 만들지 못한다 | **맞췄다**(`7300205`). 시험이 고정한다 | 셋을 한 커밋에서 함께 옮긴다 | 판을 옮길 때 |
| `npm run local -- --cli` | 옆 폴더의 CLI(HEAD `7300205`)를 빌드해 돌린다 | 파서가 받으므로 이제 돈다(돌려 보지는 않았다. 수집본이 같은 커밋의 같은 출력이다) | — | — |
| 지문 | 팩 판이 바뀌면 모두 바뀐다(판정에 쓰이지 않는 duties 만 더해도) | 판이 다른 결과끼리 지문으로 견주지 않는다 | R3 | 판을 옮길 때 |
| 팩 메타데이터 내보내기 | v0.4 의 `duties` 를 버린다 | 안 깨진다 | duties id 옮기기는 해도 된다. 의무 설명을 싣는 것은 사람이 정한다(`_duties.jsonl` 의 `quote` 는 해시로 고정한 원문이 아니라 조문으로 쓰지 않는다) | 판을 옮길 때 |
| 실행기 설치 | 없는 `[api]` 를 청한다 | `7300205` 에는 있다 | `[api]` 를 빼고 `docs/direction.md`, `docs/architecture.md` 의 글도 고친다 | 판을 옮길 때 |
| `CLI_EXCLUDE_NEWER` | 고정 커밋의 날짜여야 한다 | 2026-10-08 | 커밋과 함께 바꾼다. `tests/runner.test.ts` 는 그 날짜가 오늘보다 2주 넘게 앞이기를 바란다. 11/16 커밋이면 11/30 전, 11/30 태그면 12/14 전에는 그 시험과 부딪친다(사람 결정) | 판을 옮길 때 |
| `JUDGE_MODEL: haiku` | 판을 옮기면 4.5 에서 5.5 로 조용히 바뀐다. `--agent` 는 전체 id 가 필요하다 | 안 깨진다 | 전체 모델 id 로 적는다(사람 결정) | 판을 옮길 때 |
| 판정자 시간 초과 | `a228856` 에서 `transport` 로 분류된다(R24) | `7300205` 는 맞다 | R24 가 고쳐지지 않은 판으로 옮기면 화면의 까닭이 "부르지 못함"이 된다는 것을 알고 옮긴다 | 판을 옮길 때 |
| `--agent` 출력 | 푼 경고가 `findings`·`ai_cleared` 밖에 있다. 팩에 없는 규칙 id. `reason` 은 자유 문장. `run.agent.questions[].sent.read` 는 밖으로 보낸 파일 목록 | 쓰지 않으면 영향 없다 | 푼 경고를 `records` 에서 읽어 보인다(약속: AI 가 푼 것을 숨기지 않는다). 보낸 파일 목록을 보인다. `reason` 은 해석하지 않는다. 결과 부품은 재디자인 D5 에서 받을 자리만 먼저 만든다(`run.agent` 는 읽지 않는다) | G1(`--agent`), 계약이 원격에 온 뒤 |
| 시간·크기 상한 | combined 는 dev 에서 최대 1,601초였다(CLI 저장소 밖의 평가 기록). `run.agent.questions[].raw` 가 결과를 키운다 | 쓰지 않으면 영향 없다 | scan 15분, job 20분, 사이트 25분, 대기열 120분, `RESULT_MAX_KB` 4000 을 다시 본다 | G1(`--agent`) |
| SARIF | 정적 대안으로 풀린 단위가 없다 | SARIF 로 연 결과는 "발견 없음" | R11 에 덧붙임 | CLI 쪽 |

## 언제 무엇을 하나

2026-11-05 에 바뀐 CLI 일정(위 절)에 맞춘 차례다. 고정 판은 **배포(B4, 12/1) 전에 한 번만** 옮긴다. 판정 변화 없이 22개
파일과 모든 지문이 바뀌고, 11주에 여섯째 정책이 오면 또 바뀌기 때문이다. 배포 전에 옮기면 판이 다른 옛 분석이 DB 에 남지 않는다.

**지금(11/5~11/16)**

- 고정 판은 `7300205` 그대로다. 원격에 있는 커밋이 그것뿐이다. `a228856` 은 고정하지 않는다.
- 화면 재디자인(D1~D7, `docs/redesign.md`)은 CLI 판과 상관없이 한다. D5(결과 부품)는 11/16 계약을 기다리지 않고, 에이전트
  결과를 받을 자리만 만든다: "AI 가 돌았나"를 한 함수에서 보기, 검사 정보의 AI 칸을 여러 줄로, 인용 부품이 여러 줄(파일·줄·글)을
  받기, 팩에 없는 규칙 id 는 도감 링크 없이 id 만, "AI 가 푼 경고" 상자가 목록을 받기, 정책 수를 코드에 박지 않기.
- 하지 않는 것: 실행기를 `--agent` 로 바꾸기, 스키마·타입·파서에 `run.agent`·`findings[].agent` 넣기, `duty_ko` 같은 의무 해석과
  의무 지도 수치 싣기, 정확도 수치 쓰기, 판정자나 에이전트를 켠 실제 수집(사람 결정).
- `docs/cli-requests.md` 의 R2·R7·R10·R20·R21·R23 덧붙임과 R24~R26 을 11/10(11주 시작) 전에 CLI 쪽에 전한다(사람의 일). 그래야
  계약 인계에 함께 들어간다.

**11/16 직후, 그 뒤 주 1회**

- 아래 절차 1~2 로 원격부터 본다. 원격에 커밋이 있으면 사본에서 표본 7개를 `--judge none` 으로 돌려 `parseReport` 로 읽는다.
- 넘겨받은 `run.agent` 모양과 R2·R20·R23 의 답을 이 문서에 관찰 절로 적는다. 고정 판은 그대로 둔다.
- 오너가 서비스의 AI 방식(ROADMAP "사람 결정이 필요한 것")을 이때 정하도록 다시 알린다.

**원격에 커밋·태그가 생긴 뒤, 배포(12/1) 전에 한 번**

- 절차 3 으로 수집본·팩 메타데이터·`CLI_COMMIT`·`CLI_EXCLUDE_NEWER` 를 함께 옮긴다(언제 옮길지는 사람 결정).
- 함께 하는 것: `[api]` 빼기(`runner/run.mjs`, `tests/runner.test.ts`, `docs/direction.md`, `docs/architecture.md`), `JUDGE_MODEL` 을
  전체 id 로, 손 자료(`tests/fixtures`, `contract/samples-v1-draft`, `src/lib/service/synthetic.ts`)의 팩 판, 여섯째 정책이 있으면
  정책 수를 가정한 시험과 v1 초안 예시.

**서비스의 AI 방식이 `--agent` 이고 그 계약이 원격에 있을 때 (G1)**

- 스키마·타입·파서에 `run.agent`·`findings[].agent` 를 넣고 D5 의 자리를 채운다(푼 경고 = `records`·`recheck.records`, 판정은
  `status.ts` 의 말로만).
- 실행기 env(모델·방식·재확인)와 `runScan` 인자, 시간·크기 상한, 약속 문구를 고친다.
- 완료 조건: 에이전트가 푼 경고가 화면에 보이고, `run.judge` = null 인 에이전트 결과에 "판정자 꺼짐"이 나오지 않는다.

## 따라가는 절차

1. **본다.** 11/16 직후, 그 뒤 주 1회.
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
