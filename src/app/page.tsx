import Link from "next/link";
import { RepoName } from "@/components/service/parts";
import { findingCount } from "@/components/service/analysis";
import { SearchForm } from "@/components/service/SearchForm";
import { keepParticles } from "@/components/text";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import { store } from "@/lib/service";
import { analysisHref, shortCommit } from "@/lib/service/href";
import { formatKst } from "@/lib/service/steps";
import { SITE } from "@/lib/site";

/** 쓰는 길. 찾기 → 보기 → 요청 → 진행 보기. */
const HOW = [
  { title: "저장소 찾기", text: "맨 위 검색창에 GitHub 공개 저장소의 이름을 넣습니다." },
  { title: "분석 보기", text: "누군가 이미 분석을 요청했으면 그 결과를 누구나 봅니다. 분석마다 커밋과 id 가 있습니다." },
  { title: "분석 요청", text: "분석이 없거나 지금 코드로 다시 보고 싶으면 요청합니다. 로그인은 필요 없습니다." },
  { title: "진행 보기", text: "분석 중이면 요청한 사람이 아니어도 단계별 진행을 봅니다. 끝나면 같은 주소에 결과가 그려집니다." },
];

/** 무엇이 아닌지. 결과를 읽기 전에 알아야 한다. */
const NOT = [
  SITE.disclaimer,
  "점수·등급·순위를 매기지 않습니다. 사람이 볼 곳의 수만 셉니다.",
  SITE.zeroIsNotClearance,
  "검사하는 JS/TS 코드(누가 썼든)를 읽기만 하고 실행하지 않습니다. 서버 설정이나 데이터에만 있는 동의 상태는 보지 못합니다.",
];

export default async function Home() {
  const recent = await store.recentSucceeded(3);
  const counts = new Map<string, number>();
  for (const { analysis } of recent) {
    const parsed = parseReport(await store.getResult(analysis.id));
    if (parsed.ok) counts.set(analysis.id, parsed.report.findings.length);
  }

  return (
    <>
      <section className="hero">
        <p className="eyebrow">GitHub 공개 저장소 · 국내 법·정책 검토 지점</p>
        <h1>저장소의 정책 검토 지점을 조문과 함께 봅니다</h1>
        <p className="lede">{keepParticles(SITE.tagline)} 분석은 저장소마다 남고, 누구나 봅니다.</p>
        <SearchForm id="home-q" label="저장소 검색(첫 화면)" big />
        {store.synthetic && <p className="hint">지금은 합성 예시 저장소만 있습니다. 예: kids-signup, genai, example-labs</p>}
      </section>

      <section aria-labelledby="how-title">
        <h2 id="how-title">어떻게 쓰나요</h2>
        <ol className="how">
          {HOW.map((step, i) => (
            <li key={step.title}>
              <span className="how-n" aria-hidden="true">
                {i + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title">최근 분석된 저장소</h2>
        {store.synthetic && <p className="hint">{SITE.service.synthetic}</p>}
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
      </section>

      <section aria-labelledby="not-title">
        <h2 id="not-title">이 도구가 아닌 것</h2>
        <ul className="not-list">
          {NOT.map((text) => (
            <li key={text}>{keepParticles(text)}</li>
          ))}
        </ul>
      </section>

      <section className="entries" aria-label="다른 길">
        <Link href="/view/" className="entry">
          <h2>결과 파일 열기</h2>
          <p>내 컴퓨터에서 돌린 CLI 결과(JSON, SARIF)를 엽니다. 파일은 브라우저 안에서만 읽습니다.</p>
        </Link>
        <Link href="/demo/" className="entry">
          <h2>데모</h2>
          <p>합성 예시 코드의 고치기 전과 후를 코드와 함께 비교합니다.</p>
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
