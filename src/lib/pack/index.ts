import raw from "@data/pack-meta.json";
import { policySlug } from "./href";
import type { PackIndex, PackMeta, PolicyMeta } from "./types";

export { policyCardId, policyHref, policySlug } from "./href";

/**
 * 팩 메타데이터 전체. `npm run pack-meta` 로 다시 만든다.
 *
 * 빌드할 때(서버 부품, 시험)만 불러온다. 브라우저에서 도는 부품("use client"와 그것이 불러오는 파일)에서는 이 파일을
 * 불러오지 않는다. 불러오면 팩 메타데이터가 통째로 JS 묶음에 실려 나가고, 화면에 싣지 않기로 한 팩 작성자 메모까지
 * 배포물에 들어간다(`tests/bundle.test.ts`). 브라우저에는 `packIndex` 를 props 로 넘긴다. 주소는 `./href` 에서 만든다.
 */
export const packMeta = raw as unknown as PackMeta;

/**
 * 결과 화면이 팩에서 쓰는 것만 고른 것. 브라우저로 가는 팩 정보는 이것뿐이다.
 *
 * 조문은 이름만 넘긴다. 대표 조문(첫 조문)만은 조문별 검사 기록에 적는 값(시행일, 원문 해시, 그 해시가 원문 파일과
 * 맞는지)을 함께 넘긴다. 조문 원문과 팩 작성자 메모는 넘기지 않는다. 넘기는 것을 바꾸면 `tests/bundle.test.ts` 의 목록도
 * 함께 고친다.
 */
export const packIndex: PackIndex = {
  pack: { digest: packMeta.pack.digest },
  policies: packMeta.policies.map((policy) => ({
    id: policy.id,
    title: policy.title,
    legal: policy.legal.map((ref, i) =>
      i === 0
        ? {
            label: ref.label,
            effective_from: ref.effective_from,
            text_sha256: ref.text_sha256,
            text_sha256_matches: ref.text_sha256_matches,
          }
        : { label: ref.label },
    ),
  })),
};

export function findPolicy(id: string): PolicyMeta | undefined {
  return packMeta.policies.find((p) => p.id === id);
}

/** 주소의 이름에서 정책을 찾는다. 거꾸로 바꾸지 않고 팩의 id 와 견준다. */
export function findPolicyBySlug(slug: string): PolicyMeta | undefined {
  return packMeta.policies.find((p) => policySlug(p.id) === slug);
}

/** 정책의 대표 조문(목록의 첫 항목). 관련 조문이 더 있을 수 있다. */
export function primaryLaw(policy: PolicyMeta): string {
  return policy.legal[0]?.label ?? "";
}
