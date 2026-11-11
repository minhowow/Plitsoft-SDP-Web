import raw from "@data/example-profiles.json";

/**
 * 결과 화면의 1단(프로필: 이 저장소가 하는 일)과 2단(걸리는 의무)의 자료. 2026-11-11 오너가 정한 세 단의 틀이다.
 *
 * 지금 있는 것은 손으로 만든 예시뿐이다(`data/example-profiles.json`). CLI 가 `policypack profile` 의 출력(기능, 근거, 기능마다
 * 걸리는 의무 목록)을 내기 전까지 틀을 그려 보려고 둔다. 그 출력의 형식을 짐작해 파서를 만들지 않는다. 형식이 오면 이 모양을
 * 버리고 그 형식에 맞춘다. 화면은 이 자료를 늘 "예시"라고 밝힌다. 실제 분석에는 쓰지 않는다(CLI 출력에 없는 것을 꾸며 내지 않는다).
 *
 * - `synthetic`: 합성 저장소(`owner/name`)의 예시. 합성 데모 코드(contract/fixtures/<앱>/main)를 사람이 읽고 적었다. 합성 예시
 *   이름표가 붙는 화면(합성 미리보기, 가짜 GitHub)에서만 쓴다.
 * - `cases`: 사례(/cases, 이름)의 예시. 사람이 원본 코드에서 확인해 적은 사례 글(`src/lib/cases/stories.ts` 의 출처인 cases.md)에
 *   나온 기능과 파일만 옮겼다. 사례 결과 JSON 에는 프로필이 없다.
 */

/** 감지된 기능 하나(예시). */
export interface ExampleFeature {
  /** 기능 이름. 사람이 붙인 것이다. */
  name: string;
  /** 근거 파일: 저장소 안의 경로와 줄(모르면 null). */
  evidence: { file: string; line: number | null }[];
  /** 이 기능에 걸릴 수 있는 의무: 팩의 정책 id. 법·조문·의무 이름은 팩 메타데이터에서 읽는다. */
  policies: string[];
}

/** 저장소 하나의 프로필(예시). 기능이 없으면 "서비스 기능이 감지되지 않아 걸리는 의무가 없다"가 답이다. */
export interface ExampleProfile {
  features: ExampleFeature[];
}

const examples = raw as { synthetic: Record<string, ExampleProfile>; cases: Record<string, ExampleProfile> };

export const SYNTHETIC_PROFILES: Record<string, ExampleProfile> = examples.synthetic;
export const CASE_PROFILES: Record<string, ExampleProfile> = examples.cases;
