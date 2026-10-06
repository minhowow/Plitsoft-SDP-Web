import type { Metadata } from "next";
import Link from "next/link";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";

export const metadata: Metadata = { title: "조문 도감" };

export default function PolicyIndexPage() {
  return (
    <>
      <h1>조문 도감</h1>
      <p className="lede">
        팩 <code>{packMeta.pack.id}</code> 에 실린 정책입니다. 정책마다 대표 조문이 하나 있고, 관련 조문이 더 있을 수
        있습니다.
      </p>
      <ul className="policy-index">
        {packMeta.policies.map((policy) => (
          <li key={policy.id}>
            <Link href={policyHref(policy.id)}>{policy.title}</Link>
            <span className="law">{primaryLaw(policy)}</span>
            {policy.ask_developer && <p>{policy.ask_developer}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
