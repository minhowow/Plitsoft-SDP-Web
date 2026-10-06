import Link from "next/link";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { SITE } from "@/lib/site";

export default function Home() {
  return (
    <>
      <section className="hero">
        <h1>코드에서 국내 법 검토 지점을 조문과 함께 봅니다</h1>
        <p className="lede">
          {SITE.cli} CLI 가 JS/TS 코드(누가 썼든)를 검사한 결과를, 조문 원문·확인되지 않은 적법한 대안·개발자에게 할 질문과
          함께 보여 주는 화면입니다.
        </p>
      </section>

      <section className="entries" aria-label="들어가는 길">
        <Link href="/view/" className="entry">
          <h2>결과 보기</h2>
          <p>내 컴퓨터에서 돌린 CLI 결과 JSON 을 엽니다. 파일은 브라우저 안에서만 읽습니다.</p>
        </Link>
        <Link href="/demo/" className="entry">
          <h2>데모</h2>
          <p>합성 예시 코드의 고치기 전과 후를 비교합니다.</p>
        </Link>
        <Link href="/policy/" className="entry">
          <h2>조문 도감</h2>
          <p>정책마다 근거 조문, 적법한 대안, 개발자에게 할 질문을 봅니다.</p>
        </Link>
      </section>

      <section>
        <h2>지금 실린 정책</h2>
        <ul className="policy-index">
          {packMeta.policies.map((policy) => (
            <li key={policy.id}>
              <Link href={policyHref(policy.id)}>{policy.title}</Link>
              <span className="law">{primaryLaw(policy)}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
