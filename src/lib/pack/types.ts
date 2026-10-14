/** data/pack-meta.json 의 타입. scripts/export-pack-meta.mjs 가 만든다. */

export interface LegalRef {
  statute: string | null;
  article: string | null;
  clause: string | null;
  /** 화면에 쓰는 이름. CLI 의 findings[].law 와 같은 모양. */
  label: string;
  url: string | null;
  law_id: string | null;
  effective_from: string | null;
  text_retrieved: string | null;
  text_sha256: string | null;
  text_sha256_matches: boolean | null;
  /** 조문 원문. 법령은 저작권법 제7조에 따라 자유롭게 실을 수 있다. */
  text: string | null;
}

export interface Alternative {
  id: string | null;
  kind: "static" | "ai";
  strength: string | null;
  question: string | null;
  evidence: string | null;
  message: string | null;
  ask_developer: string | null;
  remediation: string | null;
}

export interface Rule {
  id: string | null;
  scope: string;
  applies_question: string | null;
  applies_when: (string | null)[];
  alternatives: Alternative[];
}

export interface PolicyMeta {
  id: string;
  category: string | null;
  title: string;
  ask_developer: string | null;
  legal: LegalRef[];
  review_by: string | null;
  rationale: { motivation: string | null; implementation: string | null };
  rules: Rule[];
}

/**
 * 조문 도감이 그리는 정책. 팩 작성자 메모(`rationale`)는 화면에 싣지 않으므로 타입에서 뺀다(`docs/commitments.md` 의 1).
 * 조문 도감의 부품(`src/components/policy/`)은 이 타입으로 받아서, 메모를 읽으려 하면 타입 검사에서 걸린다.
 */
export type PolicyDoc = Omit<PolicyMeta, "rationale">;

/**
 * 브라우저로 넘기는 조문 하나. 이름은 모든 조문에 있다. 나머지 셋은 대표 조문(정책의 첫 조문)에만 싣는다. 조문별 검사
 * 기록이 정책마다 대표 조문의 시행일과 원문 해시를 적기 때문이다(`src/lib/report/record.ts`). 조문 원문(`text`)은 싣지
 * 않는다.
 */
export interface IndexedLegal {
  label: string;
  effective_from?: string | null;
  /** 팩에 적힌 원문 해시(SHA-256). 팩 안의 원문 파일을 두고 적은 값이다. */
  text_sha256?: string | null;
  /** 그 해시가 팩 안의 원문 파일과 맞는지. 팩 메타데이터를 만들 때 견준 값이다. 견주지 못했으면 null. */
  text_sha256_matches?: boolean | null;
}

/**
 * 결과 화면이 팩에서 쓰는 것: 팩 판, 그리고 정책마다 id·제목·조문 이름과 대표 조문의 시행일·원문 해시. `PackMeta` 는 이
 * 모양을 그대로 품고 있다. 브라우저에서 도는 부품에는 이것만 넘긴다(`src/lib/pack/index.ts` 의 `packIndex`).
 */
export interface PackIndex {
  pack: { digest: string };
  policies: { id: string; title: string; legal: IndexedLegal[] }[];
}

export interface PackMeta {
  schema_version: string;
  generated_by: string;
  pack: { id: string | null; title: string | null; api_version: string | null; digest: string };
  policies: PolicyMeta[];
}
