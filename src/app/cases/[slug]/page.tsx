import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CaseFacts } from "@/components/cases/CaseFacts";
import { CaseCites, CaseWhere, Prose } from "@/components/cases/CaseParts";
import { CheckHead } from "@/components/result/PolicyCard";
import { ObligationTier, ProfileTier, Tier } from "@/components/result/Tiers";
import { Icon } from "@/components/Icon";
import { StatusChip } from "@/components/result/StatusChip";
import { keepArticle } from "@/components/text";
import { caseStatus, casePolicies, casesFile, casesHref, clearedByAi, findCase, isNewByAi } from "@/lib/cases";
import { CASE_STORIES } from "@/lib/cases/stories";
import { findPolicy, policyHref, primaryLaw } from "@/lib/pack";
import { CASE_PROFILES } from "@/lib/profile";
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

/** 정책 id 를 요소 id 에 쓸 수 있는 꼴로(점을 뺀다). */
const slugOf = (id: string) => id.replace(/\./g, "-");

/** 정책 id 의 제목. 팩에 없으면 결과에 실린 제목. */
function policyTitle(id: string, fallback: string): string {
  return findPolicy(id)?.title ?? fallback;
}

/**
 * 사례 하나(읽기 전용, 빌드할 때 그린다). 분석 쪽과 같은 세 단(2026-11-11 오너 지시)이다: 1 프로필(무슨 코드와 감지된 기능,
 * 손으로 만든 예시), 2 걸리는 의무(예시), 3 검토 결과(규칙만 본 결과와 AI 가 여러 파일을 읽은 뒤의 차이, 의무마다의 체크리스트와
 * AI 가 인용한 줄). 글은 사람이 원본 코드에서 확인해 쓴 것(`lib/cases/stories.ts`), 수와 발견·인용은 미리 돌린
 * 결과에서 옮긴 것(`data/cases.json`)이다. 인용한 줄은 미리 돌린 그 커밋의 GitHub 링크로 보낸다.
 */
export default async function CasePage({ params }: Params) {
  const { slug } = await params;
  const c = findCase(slug);
  const story = CASE_STORIES[slug];
  if (!c || !story) notFound();
  const cleared = clearedByAi(c);
  const added = c.final.filter((f) => isNewByAi(c, f));
  const profile = CASE_PROFILES[slug] ?? null;
  const code = { htmlUrl: c.htmlUrl, commit: c.commit };
  // 체크리스트의 의무: AI 를 켠 뒤의 발견과 AI 가 푼 것에 나온 정책(발견이 있는 정책 차례, 그다음 푼 것만 있는 정책).
  const policyIds = [...new Set([...casePolicies(c), ...cleared.map((r) => r.policy)])];
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

      <div className="tiers">
        <ProfileTier
          profile={profile}
          code={code}
          lead={
            <p className="case-text">
              <Prose text={story.code} />
            </p>
          }
        />
        <ObligationTier profile={profile} />
        <Tier n={3} name="검토 결과">
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
          <div className="policies">
            {policyIds.map((id) => {
              const policy = findPolicy(id);
              const found = c.final.filter((f) => f.policy === id);
              const kept = cleared.filter((r) => r.policy === id);
              const checks = found.filter((f) => caseStatus(f.outcome) !== "uncertain");
              const unknowns = found.filter((f) => caseStatus(f.outcome) === "uncertain");
              const title = policyTitle(id, found[0]?.title ?? id);
              const row = (f: (typeof found)[number], i: number) => (
                <li key={i} className="case-item">
                  <p className="case-item-hd">
                    <StatusChip status={caseStatus(f.outcome)} />
                    {isNewByAi(c, f) && <span className="tag">AI 가 새로 찾음</span>}
                  </p>
                  <CaseWhere data={c} file={f.file} line={f.line} />
                  <CaseCites data={c} cites={f.citations} />
                </li>
              );
              return (
                <article key={id} className="box policy" aria-labelledby={`case-p-${slugOf(id)}`}>
                  <header className="pbox-hd">
                    <Link href={policyHref(id)} className="law">
                      {keepArticle(policy ? primaryLaw(policy) : (found[0]?.law ?? ""))}
                    </Link>
                    <div className="tl">
                      <h3 className="t" id={`case-p-${slugOf(id)}`}>
                        {title}
                      </h3>
                    </div>
                  </header>
                  {policy && checks.length > 0 && (
                    <dl className="qa pq">
                      <dt>질문</dt>
                      <dd className="q">{policy.ask_developer}</dd>
                    </dl>
                  )}
                  <div className="rows">
                    {kept.length > 0 && (
                      <section className="ck ck-kept">
                        <CheckHead kind="kept" count={kept.length} />
                        <ul className="case-list">
                          {kept.map((r, i) => (
                            <li key={i} className="case-item">
                              <CaseWhere data={c} file={r.file} line={r.line} />
                              <CaseCites data={c} cites={r.review?.citations ?? []} />
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {checks.length > 0 && (
                      <section className="ck ck-check">
                        <CheckHead kind="check" count={checks.length} />
                        <ul className="case-list">{checks.map(row)}</ul>
                      </section>
                    )}
                    {unknowns.length > 0 && (
                      <section className="ck ck-unknown">
                        <CheckHead kind="unknown" count={unknowns.length} />
                        <ul className="case-list">{unknowns.map(row)}</ul>
                      </section>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </Tier>
      </div>

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
