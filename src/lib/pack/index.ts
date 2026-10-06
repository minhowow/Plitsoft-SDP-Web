import raw from "@data/pack-meta.json";
import type { PackMeta, PolicyMeta } from "./types";

/** 빌드에 함께 실리는 팩 메타데이터. `npm run pack-meta` 로 다시 만든다. */
export const packMeta = raw as unknown as PackMeta;

export function findPolicy(id: string): PolicyMeta | undefined {
  return packMeta.policies.find((p) => p.id === id);
}

/**
 * 주소에 쓰는 이름. 정책 id 의 점을 빼기표로 바꾼다(kr.pipa.22-2 → kr-pipa-22-2).
 * 점이 든 경로는 Next 가 파일 이름으로 보고 끝 슬래시를 떼어, 일부 정적 호스팅에서 열리지 않는다.
 */
export function policySlug(id: string): string {
  return id.replaceAll(".", "-");
}

/** 조문 도감 주소. 화면 어디서든 이 함수로 만든다. */
export function policyHref(id: string): string {
  return `/policy/${policySlug(id)}/`;
}

/** 주소의 이름에서 정책을 찾는다. 거꾸로 바꾸지 않고 팩의 id 와 견준다. */
export function findPolicyBySlug(slug: string): PolicyMeta | undefined {
  return packMeta.policies.find((p) => policySlug(p.id) === slug);
}

/** 정책의 대표 조문(목록의 첫 항목). 관련 조문이 더 있을 수 있다. */
export function primaryLaw(policy: PolicyMeta): string {
  return policy.legal[0]?.label ?? "";
}
