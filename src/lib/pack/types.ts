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
 * 결과 화면이 팩에서 쓰는 것: 팩 판, 그리고 정책마다 id·제목·조문 이름. `PackMeta` 는 이 모양을 그대로 품고 있다.
 * 브라우저에서 도는 부품에는 이것만 넘긴다(`src/lib/pack/index.ts` 의 `packIndex`).
 */
export interface PackIndex {
  pack: { digest: string };
  policies: { id: string; title: string; legal: { label: string }[] }[];
}

export interface PackMeta {
  schema_version: string;
  generated_by: string;
  pack: { id: string | null; title: string | null; api_version: string | null; digest: string };
  policies: PolicyMeta[];
}
