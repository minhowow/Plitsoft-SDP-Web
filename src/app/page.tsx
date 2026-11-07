import Link from "next/link";
import { RepoName } from "@/components/service/parts";
import { findingCount } from "@/components/service/analysis";
import { SearchForm } from "@/components/service/SearchForm";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { orUnavailable } from "@/lib/service/errors";
import { analysisHref, shortCommit } from "@/lib/service/href";
import { formatKst } from "@/lib/service/steps";
import { SITE } from "@/lib/site";
import { getStore } from "@/server/store";

// 최근 분석은 요청 때 DB 에서 읽는다.
export const dynamic = "force-dynamic";

export default async function Home() {
  const store = getStore();
  const loaded = await orUnavailable(
    (async () => {
      const recent = await store.recentSucceeded(3);
      const counts = new Map<string, number>();
      const found = await store.findingCounts(recent.map(({ analysis }) => analysis.id));
      for (const [id, count] of Object.entries(found)) if (count !== null) counts.set(id, count);
      return { recent, counts };
    })(),
  );
  const { recent, counts } = loaded.ok ? loaded.value : { recent: [], counts: new Map<string, number>() };

  const anyZero = recent.some(({ analysis }) => counts.get(analysis.id) === 0);

  // 설명 구획(소개 문장, 사용법, "이 도구가 아닌 것", 다른 길 카드)은 두지 않는다(docs/redesign.md). 면책은 바닥글에 있다.
  return (
    <>
      <h1 className="visually-hidden">저장소 검색</h1>
      <SearchForm id="home-q" label="저장소 검색(첫 화면)" big />

      <section aria-labelledby="recent-title">
        <h2 id="recent-title">
          최근 분석 {store.synthetic && <span className="tag">합성 예시</span>}
        </h2>
        {!loaded.ok && <p className="notice notice-warn">{loaded.message}</p>}
        {loaded.ok && recent.length === 0 && <p className="hint">아직 끝난 분석 없음</p>}
        <ul className="recent">
          {recent.map(({ repository, analysis }) => (
            <li key={analysis.id}>
              <Link href={analysisHref(repository.owner, repository.name, analysis.id)} className="recent-card">
                <span className="recent-name">
                  <RepoName owner={repository.owner} name={repository.name} />
                </span>
                <span className="recent-facts">
                  분석 <code>{analysis.id}</code> · 커밋 <code>{shortCommit(analysis.commit)}</code>
                </span>
                <span className="recent-facts">
                  <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time> ·{" "}
                  {findingCount(counts.get(analysis.id))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {/* 발견 0건이 보이면 그 수의 뜻을 바로 아래에 둔다(docs/commitments.md 의 1). */}
        {anyZero && <p className="hint">{SITE.zeroIsNotClearance}</p>}
      </section>

      <section aria-labelledby="policies-title">
        <h2 id="policies-title">검사하는 정책</h2>
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
