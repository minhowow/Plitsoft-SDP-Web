import type { Metadata } from "next";
import Link from "next/link";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { PACK_DIGEST_NOTE } from "@/lib/pack/guide";
import type { PolicyDoc } from "@/lib/pack/types";

export const metadata: Metadata = { title: "조문 도감" };

/** 목록에서 정책마다 적는 한 줄. 정책 쪽의 맨 위에 있는 것과 같은 값이다. 팩에 없는 값은 적지 않는다. */
function counts(policy: PolicyDoc): string {
  return [
    `근거 조문 ${policy.legal.length}개`,
    `규칙 ${policy.rules.length}개`,
    policy.review_by && `재검토 기한 ${policy.review_by}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export default function PolicyIndexPage() {
  const { pack, policies } = packMeta;
  return (
    <>
      <h1>조문 도감</h1>
      <p className="lede">
        팩 <code>{pack.id}</code> 에 실린 정책 {policies.length}개입니다. 제목 아래에 적은 것은 대표 조문이고, 관련 조문과
        규칙은 정책 페이지에 있습니다.
      </p>
      {/* 이 도감이 어느 판의 팩으로 만들어졌는지. 결과 화면의 '팩 판'과 견줄 수 있다. */}
      <p className="hint">
        이 도감을 만든 팩 판은 <code>{pack.digest}</code> 입니다. {PACK_DIGEST_NOTE}
      </p>
      <ul className="policy-index">
        {policies.map((policy) => (
          <li key={policy.id}>
            <Link href={policyHref(policy.id)}>{policy.title}</Link>
            <span className="law">{primaryLaw(policy)}</span>
            {policy.ask_developer && <p>{policy.ask_developer}</p>}
            <span className="policy-counts">{counts(policy)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
