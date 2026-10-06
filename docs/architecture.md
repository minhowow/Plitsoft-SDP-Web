# 구조

## 세 개의 층

| 층 | 언제 | 무엇 | 서버 | 지금 상태 |
|---|---|---|---|---|
| 1층 | 지금 | 결과 뷰어, 조문 도감, 합성 데모 | 없음 (정적 사이트) | 뼈대 있음 |
| 2층 | 관문 G2 뒤 | 공개 GitHub 저장소 주소를 넣으면 검사 (초대제) | Vercel 함수 + 일회용 격리 환경 | 설계만 |
| 3층 | 학기 뒤 | 비공개 저장소: 사용자 Actions 가 결과만 올림, 팀 화면 | 결과 수신 API + DB | 구상만 |

관문과 순서는 `ROADMAP.md`, 층마다의 약속은 `commitments.md` 에 있다.

## 1층의 데이터 흐름

```
../Plitsoft-SDP (CLI 저장소, 읽기만)
      │  휠을 빌드해 격리 환경에서 실행       │  pack.yaml + _legal/ 을 읽음
      ▼                                       ▼
scripts/capture-cli-output.mjs         scripts/export-pack-meta.mjs   (임시: CLI 가 직접 내보낼 때까지)
      │                                       │
      ▼                                       ▼
contract/cli-current/*.json            data/pack-meta.json
      │                                       │
      └──────────────┬────────────────────────┘
                     ▼
        src/lib/report/parse.ts        결과 JSON 확인 (브라우저에서도 돈다)
        src/lib/report/view-model.ts   정책별로 묶고 상태를 정함
                     ▼
        src/components/result/         결과 화면 부품
                     ▼
        /view  /demo  /policy          빌드하면 out/ 에 정적 파일
```

- `/view`: 사용자가 고른 JSON 파일을 브라우저에서 읽어 같은 부품으로 그린다. 서버로 보내지 않는다.
- `/demo`: 빌드할 때 `contract/fixtures` 의 합성 코드와 `contract/cli-current` 의 결과를 읽는다.
- `/policy/<이름>`: `data/pack-meta.json` 의 정책마다 한 쪽. 빌드할 때 만들어진다. 주소의 이름은 정책 id 의 점을
  빼기표로 바꾼 것이다(`kr.pipa.22-2` → `kr-pipa-22-2`, `src/lib/pack/index.ts` 의 `policySlug`). 점이 든 경로는 Next 가
  링크에서 끝 슬래시를 떼어 일부 정적 호스팅에서 열리지 않는다.

## 결과 JSON 을 읽는 두 가지 계약

| 계약 | 알아보는 법 | 무엇이 다른가 |
|---|---|---|
| `cli-0.3` | `schema_version` 이 없다 | CLI 가 지금 내는 것. 발견(검토 필요·판단 보류)만 있다 |
| `v1-draft` | `schema_version: "report/1-draft"` | 웹의 요청안. 정책별 요약과 충족 근거 위치가 있다 |

`cli-0.3` 결과에서는 발견이 없는 정책이 "충족 근거 발견"인지 "적용 신호 없음"인지 정책별로 알 수 없다(전체 판정 단위
수 `run.units` 만 안다). 그래서 "발견 없음"으로 보이고 그 이유를 화면에 적는다. `v1-draft` 는 CLI 가 아직 내지 않으므로
`contract/samples-v1-draft/` 의 예시로만 본다. 판 번호가 없는 결과에 `run.policies` 가 있어도 쓰지 않는다.

## 발견 하나의 단위

- 발견 하나 = 정책 × 규칙 × 파일. 함수 단위 규칙(`scope: anchor`)이면 정책 × 규칙 × 함수다. kr-core 의 규칙은 지금
  모두 파일 단위다.
- 같은 파일·같은 줄에 규칙이 다른 발견이 둘 있을 수 있다(예: `night-push.main` 의 제50조 제4항은 시작 표기와 수신거부
  두 규칙이 같은 줄에 나온다). 서로 다른 의무이므로 하나로 접지 않고 규칙 이름과 함께 보인다.
- 파일 단위 규칙에서 `line` 은 적용 조건이 처음 맞은 줄이다. 판정 대상은 파일 전체다. 그 줄이 문제의 줄이라는 뜻이 아니다.
- `unsatisfied_alternatives` 에는 거짓으로 판정된 대안만 실린다. 판정에 넣지 않은 AI 대안과, 참이지만 약해서 풀지
  못한 대안은 목록에 없고 `decision_path` 의 문장에만 나온다.

## 판정자를 켠 결과

| 필드 | 뜻 | 화면 |
|---|---|---|
| `run.judge` | 판정자 id. 꺼져 있으면 null | 머리의 "판정자" |
| `findings[].ai_pending` | AI 에게 물어야 했는데 판정에 넣을 답이 없는 조건. 판정자가 꺼졌거나, 답하지 못했거나, 답을 쓸 수 없었다 | "검토 필요 · AI 확인 전". 꺼져 있었을 때만 켜 보라고 권한다 |
| `run.ai_cleared` | AI 의 '예'와 코드 인용으로 풀린 경고. 발견 목록에는 없다 | "AI 가 푼 경고". 인용한 줄을 보인다 |
| `run.ai_dismissed` | 적용 질문에 AI 가 '아니오'라고 답해 빠진 판정 | "AI 가 적용되지 않는다고 답해 빠진 판정" |

실제 판정자를 부른 수집본은 없다. 화면은 `tests/fixtures/judge-on.*.json`(손으로 만든 자료)으로 시험한다.

## 다 보지 못한 것

| 필드 | 뜻 | 결과에 |
|---|---|---|
| `run.skipped` | 검사하지 않은 파일(크기 상한, 생성물, UTF-8 아님 등) | 없다 |
| `run.unparsed` | 일부를 파싱하지 못한 파일. 구문 조건이 '모름'이 되어 판단 보류로 남았을 수 있다 | 있다 |
| `run.incomplete` | 엔진이 조건을 끝내지 못한 파일. 끝나지 않은 조건은 판단 보류로 남는다 | 있다 |
| `run.engine_errors` | 어느 파일인지 모르는 엔진 오류 | — |
| `run.coverage_complete` | 위 가운데 하나라도 있으면 거짓 | 경고 |

## SARIF 에 있는 것과 없는 것

`--output-format sarif` 에는 발견·지문·판정 경로·대안(`results[].properties`)과 판정자·팩 판·AI 가 푼 것
(`invocations[0].properties`)이 있다. 판정 단위 수와 검사한 파일 수는 없다. 줄이 없는 발견은 1행으로 나온다.
SARIF 입력을 받을 때는 없는 것을 "알 수 없음"으로 보인다(`docs/cli-requests.md` 의 R11).

## 상태가 정해지는 규칙 (`src/lib/report/status.ts`, `view-model.ts`)

| 조건 | 상태 |
|---|---|
| 발견의 outcome 이 `needs-review-uncertain` | 판단 보류(모름) |
| outcome 이 `needs-review` 이고 `ai_pending` 이 비어 있지 않음 | 검토 필요 · AI 확인 전 |
| outcome 이 `needs-review` 이고 `ai_pending` 이 비어 있음 | 미충족 신호(검토 필요) |
| 발견이 없고, v1 요약에서 `compliant > 0` | 충족 근거 발견 |
| 발견이 없고, v1 요약이 있음 (그 밖) | 적용 신호 없음 |
| 발견이 없고, 요약도 없고, 결과의 팩 판이 사이트의 팩과 다름 | 알 수 없음 |
| 발견이 없고, 요약도 없음 (`cli-0.3`, 팩 판이 같음) | 발견 없음 (AI 가 푼 경고가 있으면 그 사실을 대신 적는다) |

정책의 상태는 그 정책의 위치들 가운데 가장 먼저 봐야 할 것이다.

## 2층 설계 요약 (아직 만들지 않는다)

확장 구상에서 정한 방향이다. 만들기 전에 사실을 다시 확인한다.

1. 허용목록에 있는 GitHub 계정만 로그인한다(신원만, 권한 요청 없음).
2. 서버가 기본 브랜치의 커밋을 고정한다.
3. 일회용 격리 환경(Vercel Sandbox, 서울 리전, 영속 저장 끔)을 만든다.
4. 그 안에서 저장소 압축 파일을 받고 JS/TS 파일만 푼다. 경로 조작·심볼릭 링크·크기 상한을 막는다.
5. 받은 뒤 네트워크를 모두 끊는다.
6. `policypack scan --output-format json`(판정자 없음)을 돌린다.
7. 코드가 들어 있지 않은 필드만 골라 저장한다.
8. 환경을 파기하고 파기 시각을 남긴다.

검사를 Vercel 함수 안에서 직접 돌리지 않는 이유는 남의 코드를 격리할 수 없기 때문이다. 가장 가까운 선례는
Vercel Labs 의 deepsec(GitHub App + Sandbox)이다. 이 층을 시작하려면 `output: "export"` 를 걷어 내야 하고,
그것은 관문 G2 와 사람의 결정이 있어야 한다.
