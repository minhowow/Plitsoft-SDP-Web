import Link from "next/link";
import { CitedLines } from "@/components/review/FlowFigure";
import { keepParticles } from "@/components/text";
import { casesFile, casesHref } from "@/lib/cases";
import { TRACE, traceData, traceSourceLine } from "@/lib/how/figures";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { parseReview, REVIEW_STATUSES, type ReviewStatus } from "@/lib/review";
import { SANCTION } from "@/lib/review/text";

/** 체크리스트에서 보이는 의무 수. */
const SHOWN = 3;

/**
 * 첫 화면의 사례 한 건(2026-11-13 오너 지시): 처음 온 사람이 무엇을 하는 서비스인지 알게, 검색창 아래에 공개 사례 하나가 지나는 길
 * (저장소 → 기능 파악 → 의무 고르기 → 코드에서 본 것 한 줄)과 그 체크리스트의 일부를 싣는다. 자료는 구조 쪽의 따라가 보기와 같은
 * 것(`lib/how/figures.ts` 의 `traceData`)이고, 체크리스트는 그 사례의 review 결과에서 갈래별 수와 결과의 요약이 고른 맨 위 의무를
 * 옮긴다. 미리 돌린 결과라는 것과 저장소·커밋·돌린 날·모델을 함께 적는다(docs/commitments.md 의 1).
 */
export function HomeCase() {
  const { repo, item, feature } = traceData(casesFile);
  const found = casesFile.cases.find((c) => c.slug === TRACE.slug)!;
  const review = parseReview(found.review);
  const items = (review?.checklist ?? []).filter((i) => !found.recheck.includes(i.duty) && i.group !== "goods");
  const top = (review?.summary.top ?? []).flatMap((duty) => items.filter((i) => i.duty === duty && i.status === "seen-in-code"));
  const shown = (top.length > 0 ? top : items.filter((i) => i.status === "seen-in-code")).slice(0, SHOWN);
  const cite = review?.checklist.find((i) => i.duty === item.duty)?.citations.find((c) => c.ok && c.why !== "profile");
  const count = (status: ReviewStatus) => items.filter((i) => i.status === status).length;
  const code = { htmlUrl: found.htmlUrl, commit: found.commit };
  const label = `사례 ${repo.owner}/${repo.name}`;
  const source = traceSourceLine(casesFile);
  return (
    <section className="home-case" aria-labelledby="home-case-title">
      <div className="home-feed-hd">
        <h2 id="home-case-title">분석 한 건 따라가 보기</h2>
        <Link href={casesHref(TRACE.slug)} className="home-all">
          전체 결과
        </Link>
      </div>
      <ol className="hc-steps">
        <li>
          <span className="hc-k">저장소</span>
          <span className="hc-v">
            <a href={found.htmlUrl} target="_blank" rel="noopener noreferrer" translate="no">
              {repo.owner}/{repo.name}
            </a>
          </span>
        </li>
        <li>
          <span className="hc-k">기능 파악</span>
          <span className="hc-v">{feature.name}</span>
        </li>
        <li>
          <span className="hc-k">의무 고르기</span>
          <span className="hc-v">
            {item.law} {item.article}
          </span>
        </li>
        {cite && (
          <li>
            <span className="hc-k">코드에서 본 것</span>
            <div className="hc-v">
              <CitedLines citations={[cite]} code={code} />
            </div>
          </li>
        )}
      </ol>
      {review && (
        <div className="hc-check">
          <p className="hc-hd">
            {REVIEW_STATUS_LABEL["seen-in-code"]} <b>{count("seen-in-code")}건</b>
          </p>
          <ul className="hc-items">
            {shown.map((i) => (
              <li key={i.duty}>
                <span className="hc-law">
                  {i.law} {i.article}
                </span>
                {i.dutyText && !SANCTION.test(i.dutyText) && <span className="hc-duty">{keepParticles(i.dutyText)}</span>}
              </li>
            ))}
          </ul>
          <p className="hc-counts">
            {REVIEW_STATUSES.filter((status) => status !== "seen-in-code" && count(status) > 0).map((status) => (
              <span key={status}>
                {REVIEW_STATUS_LABEL[status]} <b>{count(status)}건</b>
              </span>
            ))}
          </p>
        </div>
      )}
      <p className="hc-src">
        <Link href={casesHref(TRACE.slug)}>{label}</Link>
        {source.slice(label.length)}
      </p>
    </section>
  );
}
