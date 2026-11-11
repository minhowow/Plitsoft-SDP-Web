import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseFacts } from "@/components/cases/CaseFacts";
import { CaseCites, CaseWhere, Prose } from "@/components/cases/CaseParts";
import { Icon } from "@/components/Icon";
import { StatusChip } from "@/components/result/StatusChip";
import { keepArticle } from "@/components/text";
import { caseStatus, casePolicies, casesFile, casesHref, clearedByAi, findCase, isNewByAi } from "@/lib/cases";
import { CASE_STORIES } from "@/lib/cases/stories";
import { findPolicy, policyHref, primaryLaw } from "@/lib/pack";
import { SITE } from "@/lib/site";

type Params = { params: Promise<{ slug: string }> };

// 빌드할 때 아는 사례만 쪽이 된다. 주소의 이름은 저장소 이름의 소문자다(점이 없다).
export const dynamicParams = false;

export function generateStaticParams() {
  return casesFile.cases.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const c = findCase(slug);
  return { title: c ? `${c.owner}/${c.name} · ${SITE.cases.title}` : SITE.cases.title };
}

/** 정책 id 의 제목. 팩에 없으면 결과에 실린 제목. */
function policyTitle(id: string, fallback: string): string {
  return findPolicy(id)?.title ?? fallback;
}

/**
 * 사례 하나(읽기 전용, 빌드할 때 그린다). 무슨 코드인지, 어느 조문인지, 규칙만 본 결과와 AI 가 여러 파일을 읽은 뒤의 결과가
 * 어떻게 다른지, AI 가 인용한 줄. 글은 사람이 원본 코드에서 확인해 쓴 것(`lib/cases/stories.ts`), 수와 발견·인용은 미리 돌린
 * 결과에서 옮긴 것(`data/cases.json`)이다. 인용한 줄은 미리 돌린 그 커밋의 GitHub 링크로 보낸다.
 */
export default async function CasePage({ params }: Params) {
  const { slug } = await params;
  const c = findCase(slug);
  const story = CASE_STORIES[slug];
  if (!c || !story) notFound();
  const cleared = clearedByAi(c);
  const added = c.final.filter((f) => isNewByAi(c, f));
  return (
    <div className="case-page">
      <div className="case-head">
        <p className="case-up">
          <Link href={casesHref()}>{SITE.cases.title}</Link>
        </p>
        <h1 data-page="cases">
          <a href={c.htmlUrl} target="_blank" rel="noopener noreferrer">
            {c.owner} / {c.name}
            <Icon name="external" />
            <span className="visually-hidden">(새 창)</span>
          </a>
        </h1>
        <CaseFacts cases={[c]} one={c} />
        <p className="case-lead">{story.headline}</p>
      </div>

      <section aria-labelledby="case-code">
        <h2 className="sec-h" id="case-code">
          무슨 코드
        </h2>
        <p className="case-text">
          <Prose text={story.code} />
        </p>
      </section>

      <section aria-labelledby="case-law">
        <h2 className="sec-h" id="case-law">
          어느 조문
        </h2>
        <ul className="policy-index">
          {casePolicies(c).map((id) => {
            const policy = findPolicy(id);
            const first = c.final.find((f) => f.policy === id)!;
            return (
              <li key={id}>
                <Link href={policyHref(id)} className="pi-row">
                  <span className="pi-title">{policyTitle(id, first.title)}</span>
                  <span className="pi-law">{keepArticle(policy ? primaryLaw(policy) : first.law)}</span>
                  <span className="pi-n">발견 {c.final.filter((f) => f.policy === id).length}</span>
                  <Icon name="chevron-right" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="case-diff">
        <h2 className="sec-h" id="case-diff">
          규칙만 본 결과와 AI 가 여러 파일을 읽은 뒤
        </h2>
        <div className="case-compare">
          <div className="box">
            <div className="box-hd">
              <h3>규칙만</h3>
              <span className="count">발견 {c.ruleOnly.length}</span>
            </div>
            <p className="box-in">
              <Prose text={story.ruleOnly} />
            </p>
            {c.ruleOnly.length === 0 && <p className="box-ft">{SITE.zeroIsNotClearance}</p>}
          </div>
          <div className="box">
            <div className="box-hd">
              <h3>AI 를 켠 뒤</h3>
              <span className="count">발견 {c.final.length}</span>
            </div>
            <p className="box-in">
              <Prose text={story.afterAi} />
            </p>
            <p className="box-ft">
              AI 가 푼 것 {cleared.length} · AI 가 새로 찾은 것 {added.length}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="case-found">
        <h2 className="sec-h" id="case-found">
          AI 를 켠 뒤의 발견 <span className="count">{c.final.length}</span>
        </h2>
        <ul className="box rows case-list">
          {c.final.map((f, i) => (
            <li key={i} className="case-item">
              <p className="case-item-hd">
                <StatusChip status={caseStatus(f.outcome)} />
                <span className="case-item-title">{policyTitle(f.policy, f.title)}</span>
                {isNewByAi(c, f) && <span className="tag">AI 가 새로 찾음</span>}
              </p>
              <CaseWhere data={c} file={f.file} line={f.line} />
              <CaseCites data={c} cites={f.citations} />
            </li>
          ))}
        </ul>
      </section>

      {cleared.length > 0 && (
        <section aria-labelledby="case-cleared">
          <h2 className="sec-h" id="case-cleared">
            AI 가 푼 것 <span className="count">{cleared.length}</span>
          </h2>
          <ul className="box rows case-list">
            {cleared.map((r, i) => (
              <li key={i} className="case-item">
                <p className="case-item-hd">
                  <span className="case-item-title">{policyTitle(r.policy, r.policy)}</span>
                </p>
                <CaseWhere data={c} file={r.file} line={r.line} />
                <CaseCites data={c} cites={r.review?.citations ?? []} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {(story.checked.length > 0 || story.extra.length > 0) && (
        <section aria-labelledby="case-notes">
          <h2 className="sec-h" id="case-notes">
            덧붙임
          </h2>
          <ul className="case-notes">
            {story.checked.map((note, i) => (
              <li key={`c${i}`}>
                <span className="tag">원본 코드에서 확인</span> <Prose text={note} />
              </li>
            ))}
            {story.extra.map((note, i) => (
              <li key={`e${i}`}>
                <Prose text={note} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
