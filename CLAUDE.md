@AGENTS.md

# Plitsoft-SDP-Web — 작업 안내

policypack CLI(가칭)가 낸 결과를 조문과 함께 보여 주는 웹이다. 아주대 2026-2 자기주도프로젝트, 플리트소프트 연계.
CLI 는 옆 폴더 `../Plitsoft-SDP` 에 따로 있고, 다른 사람(에이전트)이 개발한다.

일을 시작하기 전에 이 순서로 읽는다.

1. `docs/ROADMAP.md` — 무엇을 어떤 순서로 하는지, 지금 해도 되는 일과 사람 결정이 필요한 일
2. `docs/commitments.md` — 어기면 안 되는 약속 (문구, 저장, 공개 범위)
3. `contract/README.md` — CLI 와 이어지는 방식
4. `docs/architecture.md` — 세 개의 층과 지금 있는 것

## 절대 규칙

- **`../Plitsoft-SDP` 는 읽기만 한다.** 고치지 않는다. 그 소스(`src/policypack`)를 가져다 쓰지도 않는다.
  CLI 와는 설치된 명령의 출력(`contract/`)과 팩 메타데이터(`data/pack-meta.json`)로만 이어진다.
- **CLI 출력에 없는 정보를 꾸며 내지 않는다.** `decision_path` 같은 자유 문장을 해석해 구조를 만들지 않는다.
  필요한 것이 출력에 없으면 `docs/cli-requests.md` 에 요청으로 적고, 화면에는 "아직 알 수 없음"으로 정직하게 보인다.
- **지금은 1층이다. 서버가 없다.** `next.config.ts` 의 `output: "export"` 를 지우지 않는다. route handler,
  server action, 쿠키, 미들웨어(proxy), 데이터베이스, 로그인, 분석 도구, 외부로 나가는 요청(fetch, 외부 글꼴·스크립트)을
  넣지 않는다. 브라우저 저장소(localStorage 등)도 사람이 정할 때까지 쓰지 않는다. 연 결과는 메모리에만 둔다.
- **`tests/commitments.test.ts` 와 `tests/wording.ts` 를 고쳐서 통과시키지 않는다.** 약속을 바꾸려면 사람의 결정이 먼저다.
  이 시험은 흔한 실수를 잡는 그물일 뿐이다. 통과했다고 약속을 지킨 것은 아니다. `docs/commitments.md` 를 기준으로 판단한다.
- **사람만 하는 일을 대신하지 않는다.** 배포(Vercel 등), 계정·저장소·도메인 만들기, 원격에 올리기(push),
  라이선스 정하기, 실제 남의 저장소를 검사해 결과를 보여 주기. 필요해지면 멈추고 `docs/ROADMAP.md` 의
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
npm run dev         # 개발 서버
npm run check       # lint + typecheck + test + build. 일을 마쳤다고 하기 전에 반드시 통과시킨다
npm run test        # vitest (계약·화면 구조·약속)
npm run capture     # 합성 데모 코드를 설치된 CLI 로 다시 검사 → contract/cli-current/
npm run pack-meta   # 팩에서 data/pack-meta.json 다시 만들기
```

`capture` 와 `pack-meta` 는 `uv` 와 옆 폴더의 CLI 저장소가 있어야 돈다. 둘은 항상 같이 돌린다(팩 판이 어긋나면
`tests/contract.test.ts` 가 실패한다). 자세한 규칙은 `contract/README.md` 에 있다.

- 돌린 뒤 `git diff contract/ data/` 를 읽는다. 판정이 바뀌었으면 왜 바뀌었는지 커밋 메시지에 적는다.
- `MANIFEST.json` 의 `dirty` 가 `true` 면(CLI 저장소에 커밋되지 않은 변경) 수집본을 커밋하지 않고 되돌린다.
- 새 수집본이 계약 시험을 깨면(예: CLI 출력 모양이 바뀜) 파서를 서둘러 고치지 말고 수집본을 되돌린 뒤
  `docs/ROADMAP.md` 의 "사람 결정이 필요한 것"에 적는다. 출력 계약을 바꾸는 것은 관문 G1 의 일이다.
- `scripts/export-pack-meta.mjs` 는 팩의 필드를 그대로 옮기기만 한다. 읽는 필드를 더하는 것은 된다. Semgrep 패턴이나
  YAML 주석을 해석해 설명을 만들어 내는 것은 안 된다.

## 어디에 무엇이 있나

| 경로 | 내용 |
|---|---|
| `src/app/` | 페이지: `/`(소개), `/view`(결과 뷰어), `/demo`(고치기 전·후), `/policy`(조문 도감) |
| `src/components/result/` | 결과 화면 부품. 모든 페이지가 함께 쓴다 |
| `src/lib/report/` | 결과 JSON 타입, 파서, 상태 문구, 화면용 구조 |
| `src/lib/pack/` | 팩 메타데이터 타입과 읽기 |
| `contract/` | CLI 와의 이음매: 스키마, 실제 출력 수집본, v1 초안 예시, 합성 데모 코드 |
| `data/pack-meta.json` | 생성물. 정책·조문 원문·대안·질문 |
| `scripts/` | 수집과 팩 메타데이터 생성 |
| `tests/` | 계약 시험, 화면 구조 시험, 그려 본 화면 시험, 약속 시험. `tests/fixtures/` 는 손으로 만든 시험용 자료 |
| `docs/` | 로드맵, 약속, 구조, CLI 에 보낸 요청 |

## 일하는 방식

- `docs/ROADMAP.md` 의 "지금 할 일"에서 맨 위 항목부터 한다. 항목마다 완료 조건이 있다.
- 한 항목을 마치면 `npm run check` 를 통과시키고, 로드맵의 그 항목에 한 줄로 결과를 적는다.
- 커밋은 항목 단위로, 한국어 제목(무엇을 했는지 한 줄)으로 한다. 원격에 올리지 않는다.
- 화면을 바꿨으면 브라우저에서 실제로 열어 확인한다(좁은 화면과 어두운 테마 포함). 확인할 도구가 없으면 로드맵에
  "브라우저 확인 못 함"이라고 적는다.
- 조문 도감 주소는 `policyHref()` 로 만든다. 주소에 점을 넣지 않는다.
- 의존성은 꼭 필요할 때만 더한다. 더하면 왜 필요한지 커밋 메시지에 적는다.
- 판단이 서지 않는 것, 약속과 부딪치는 것은 추측으로 밀고 가지 말고 로드맵의 "사람 결정이 필요한 것"에 적고 다음 항목으로 간다.

## 배경 자료

- 전체 구상(아이디어 21개, 대표 웹앱 설계, 로드맵): https://claude.ai/artifact/NhoRuJeTcEfxaz5WbNBhKU (비공개. 오너 계정에서만 열린다)
- CLI 설명: `../Plitsoft-SDP/README.md`
