# Plitsoft-SDP-Web

policypack CLI(가칭)의 결과를 조문과 함께 보여 주는 웹. 아주대학교 2026-2 자기주도프로젝트 · 플리트소프트 연계. (개발 중)

CLI 는 JS/TS 코드(누가 썼든)에서 국내 법·정책상 검토가 필요한 지점을 찾는다. 이 저장소는 그 결과를 사람이 읽기 좋게
보여 준다. CLI 저장소는 옆 폴더 `../Plitsoft-SDP` 에 따로 있다.

출력은 "검토 필요 + 근거 조문 + 확인 질문"이다. 법률 자문이 아니다.

## 지금 있는 것

서버가 없는 정적 사이트다(1층).

| 주소 | 내용 |
|---|---|
| `/view/` | CLI 결과 JSON 을 브라우저 안에서 열어 본다. 파일을 어디로도 보내지 않는다 |
| `/demo/` | 합성 예시 코드의 고치기 전·후 비교 |
| `/policy/` | 조문 도감. 정책마다 근거 조문 원문, 적법한 대안, 개발자에게 할 질문 |

## 써 보기

```bash
npm ci
npm run dev      # http://localhost:3000
npm run check    # lint + typecheck + test + build
```

Node.js 22.12 이상의 22, 24, 또는 26 이상이 필요하다(시험 도구 vitest 의 요구). `npm run build` 는 `out/` 에 정적 파일을 만든다.

CLI 출력을 다시 수집하려면 `uv` 와 옆 폴더의 CLI 저장소가 있어야 한다. 자세한 것은 [contract/README.md](contract/README.md).

```bash
npm run capture && npm run pack-meta && npm test
```

## 문서

- [docs/ROADMAP.md](docs/ROADMAP.md) — 할 일과 관문
- [docs/commitments.md](docs/commitments.md) — 지켜야 할 약속
- [docs/architecture.md](docs/architecture.md) — 구조
- [docs/cli-requests.md](docs/cli-requests.md) — CLI 에 보내는 요청
- [contract/README.md](contract/README.md) — CLI 와 이어지는 방식
- [CLAUDE.md](CLAUDE.md) — 에이전트 작업 안내

## 라이선스

아직 정하지 않았다. 공개 전에 정한다. 조문 원문은 법령이라 누구나 쓸 수 있다(저작권법 제7조).
