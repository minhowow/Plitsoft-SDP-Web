import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { findPolicyBySlug, packMeta, policySlug, primaryLaw } from "@/lib/pack";
import type { Alternative } from "@/lib/pack/types";
import { SITE } from "@/lib/site";

type Params = { params: Promise<{ id: string }> };

// 정적 내보내기에서는 빌드 때 아는 정책만 페이지가 된다.
// 주소의 [id] 자리에는 정책 id 의 점을 빼기표로 바꾼 이름이 온다(policySlug).
export const dynamicParams = false;

export function generateStaticParams() {
  return packMeta.policies.map((policy) => ({ id: policySlug(policy.id) }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const policy = findPolicyBySlug(id);
  return { title: policy ? policy.title : "조문 도감" };
}

function kindLabel(alt: Alternative): string {
  if (alt.kind === "ai") return "AI 질문 (코드 인용 필요)";
  return alt.strength === "weak" ? "정적 · 약한 근거 (혼자서는 풀지 못함)" : "정적 · 강한 근거";
}

export default async function PolicyPage({ params }: Params) {
  const { id } = await params;
  const policy = findPolicyBySlug(id);
  if (!policy) notFound();

  return (
    <article className="policy-page">
      <p className="law">{primaryLaw(policy)}</p>
      <h1>{policy.title}</h1>
      {policy.ask_developer && <p className="lede">{policy.ask_developer}</p>}

      <section>
        <h2>근거 조문</h2>
        {policy.legal.map((ref) => (
          <div key={ref.label} className="legal">
            <h3>{ref.label}</h3>
            <p className="legal-meta">
              {ref.effective_from && <span>시행 {ref.effective_from}</span>}
              {ref.text_retrieved && <span>원문 확인 {ref.text_retrieved}</span>}
              {ref.text_sha256_matches === true && <span>팩에 기록된 해시와 일치</span>}
              {ref.text_sha256_matches === false && <span className="warn">팩에 기록된 해시와 다름</span>}
              {ref.url && (
                <a href={ref.url} rel="noopener noreferrer" target="_blank">
                  법제처 원문
                </a>
              )}
            </p>
            {ref.text ? <pre className="statute">{ref.text}</pre> : <p>조문 원문이 팩에 없습니다.</p>}
          </div>
        ))}
        {policy.review_by && <p className="legal-meta">이 정책의 재검토 기한: {policy.review_by}</p>}
      </section>

      {policy.rules.map((rule) => (
        <section key={rule.id}>
          <h2>
            규칙 <code>{rule.id}</code>
          </h2>
          <p>
            아래 대안 가운데 하나라도 코드에서 확인되면 이 규칙은 검토 필요로 올라가지 않습니다.{" "}
            {rule.scope === "anchor" ? "함수 단위로 판정합니다." : "파일 단위로 판정합니다."}
          </p>
          {rule.applies_question && <p>적용 여부를 AI 에게 물을 때의 질문: {rule.applies_question}</p>}
          <ul className="alt-list">
            {rule.alternatives.map((alt) => (
              <li key={alt.id}>
                <p>
                  <span className="alt-id">{alt.id}</span> <span className="alt-kind">{kindLabel(alt)}</span>
                </p>
                {alt.question && <p>AI 에게 묻는 질문: {alt.question}</p>}
                {alt.message && <p>확인되지 않으면: {alt.message}</p>}
                {alt.ask_developer && <p className="ask">개발자에게 할 질문: {alt.ask_developer}</p>}
                {alt.remediation && <p className="fix">고치려면: {alt.remediation}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* 팩의 rationale(작성자 메모)은 싣지 않는다. 조문이 아닌 글에 처분·액수 같은 법 관련 주장이 들어 있을 수 있다.
          실을지는 사람이 정한다(docs/ROADMAP.md "사람 결정이 필요한 것"). */}

      <p className="disclaimer">{SITE.disclaimer}</p>
    </article>
  );
}
