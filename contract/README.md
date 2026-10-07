# contract — CLI 와 웹의 이음매

웹은 CLI 의 소스를 가져다 쓰지 않는다. 설치된 `policypack` 명령이 낸 **출력**과 팩의 **데이터**만 본다.
이 폴더가 그 경계다.

```
contract/
├── fixtures/            합성 데모 코드. 검사 대상이다 (이 프로젝트의 코드가 아니다)
│   └── <앱>/<판>/src/…  판은 main(고치기 전), fixed(고친 뒤)
├── cli-current/         지금 CLI 가 실제로 낸 출력. `npm run capture` 가 통째로 다시 만든다
│   ├── MANIFEST.json    CLI 판·커밋·팩 판·수집한 날
│   ├── <앱>.<판>.json   policypack scan src/ --output-format json
│   └── kids-signup.main.sarif
├── schema/
│   ├── report.cli-0.3.schema.json     지금 JSON 출력의 모양 (관찰해서 적은 것)
│   ├── sarif.cli-0.3.schema.json      지금 SARIF 출력 가운데 웹이 읽는 것 (관찰해서 적은 것)
│   └── report.v1-draft.schema.json    웹이 요청하는 다음 모양 (CLI 가 아직 내지 않는다)
└── samples-v1-draft/    v1 초안 예시. 실제 출력에 손으로 필드를 덧붙였다
```

## 규칙

- `cli-current/` 는 손으로 고치지 않는다. 스크립트가 만든 그대로 둔다. 실행 시간(`static_seconds`, `ai_seconds`)만
  0 으로 맞춘다. 다시 수집했을 때 결과 파일의 차이가 판정 변화만 남게 하기 위해서다(`MANIFEST.json` 의 날짜는 달라진다).
- `fixtures/` 의 코드는 팩이 잘 잡도록 비틀지 않는다. 그럴듯한 서비스 코드의 모양으로 둔다.
- 스키마, 타입(`src/lib/report/types.ts`), 파서(`src/lib/report/parse.ts`)는 함께 고친다.
  `tests/contract.test.ts` 가 셋이 어긋나지 않는지 본다.
- SARIF 도 같다. 스키마(`schema/sarif.cli-0.3.schema.json`)와 타입·파서(`src/lib/report/sarif.ts`)를 함께 고친다. 웹은
  SARIF 를 결과 JSON 의 모양으로 옮겨 읽는다. SARIF 에 없는 것(판정 단위 수, 검사한 파일 수 등)은 채우지 않는다.
  SARIF 수집본(`cli-current/*.sarif`)은 같은 이름의 JSON 수집본과 같은 검사에서 나온 것이고, `tests/sarif.test.tsx` 가
  둘을 견준다. SARIF 수집본을 `src` 에서 불러오지 않는다(그 안에 팩 작성자 메모가 실려 있다).
- `npm run capture` 와 `npm run pack-meta` 는 같은 출처로 함께 돌린다. 결과의 `run.pack_digest` 와
  `data/pack-meta.json` 의 `pack.digest` 가 같아야 한다.
- `samples-v1-draft/` 는 수집본에서 손으로 만든 것이라 다시 수집해도 따라오지 않는다. 팩 판이 바뀌면 시험이 알려 준다.
  그때는 수집본에 `schema_version` 과 `run.policies` 를 덧붙여 예시를 다시 만든다.
- `MANIFEST.json` 의 `dirty` 가 `true` 면 CLI 저장소에 커밋되지 않은 변경이 있던 것이다. 그 수집본은 커밋하지 않는다.

## 다시 수집하기

```bash
npm run capture && npm run pack-meta && npm test
```

- `uv` 가 있어야 한다. 기본으로 옆 폴더 `../Plitsoft-SDP` 를 쓴다.
- 수집 스크립트가 하는 일: 출처 폴더에서 휠을 새로 빌드한다 → 표본을 임시 폴더(git 저장소 밖)로 복사한다 → 격리된
  환경에서 `policypack scan` 을 돌린다 → 전부 성공하면 `cli-current/` 를 바꾼다. 도중에 실패하면 기존 수집본은 그대로다.
  CLI 저장소에는 아무것도 쓰지 않는다.
- 다른 출처를 쓰려면 `POLICYPACK_FROM` 을 준다(폴더 경로, 또는 PyPI 공개 뒤 `"policypack==<판>"`).
  `pack-meta` 는 `POLICYPACK_FROM` 이 폴더면 그 아래 `policies/kr-core` 를 읽는다. 팩 폴더를 따로 가리키려면
  `POLICYPACK_PACK_DIR` 을 준다. PyPI 판으로 수집하면 팩 폴더를 가리킬 방법이 없다. CLI 가 팩 메타데이터를 직접
  내보낼 때(R5)까지의 한계다.
- 수집한 뒤 `git diff contract/ data/` 를 읽는다. 판정이 바뀌었으면 화면 구조 시험(`tests/view-model.test.ts`)의
  기대값도 그에 맞게 고치고, 왜 바뀌었는지 커밋 메시지에 적는다.
- 새 수집본이 계약 시험을 깨면(CLI 출력 모양이 바뀜) 수집본을 되돌리고 `docs/ROADMAP.md` 의 "사람 결정이 필요한 것"에 적는다.

## v1 로 넘어갈 때 (관문 G1)

CLI 가 판 번호가 붙은 결과와 공식 스키마를 내면:

1. `schema/report.v1-draft.schema.json` 을 CLI 의 스키마 사본으로 바꾸고 이름에서 `draft` 를 뗀다.
2. `src/lib/report/parse.ts` 의 `V1_DRAFT` 값과 타입을 맞춘다.
3. `samples-v1-draft/` 를 지운다. 수집본이 그 자리를 대신한다.
4. `docs/cli-requests.md` 의 해당 요청 상태를 고친다.
