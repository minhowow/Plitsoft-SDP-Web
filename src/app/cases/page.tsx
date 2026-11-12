import type { Metadata } from "next";
import Link from "next/link";
import { CaseFacts } from "@/components/cases/CaseFacts";
import { Icon } from "@/components/Icon";
import { checkCount } from "@/components/review/ReviewView";
import { casesFile, casesHref } from "@/lib/cases";
import { CASE_STORIES } from "@/lib/cases/stories";
import { REVIEW_RECHECK_LABEL, REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { parseReview, REVIEW_STATUSES, type ReviewStatus } from "@/lib/review";
import { secondsText } from "@/lib/service/steps";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: SITE.cases.title };

/** "확인할 것"의 세 갈래(표의 머리에서 한 칸으로 묶는다). */
const CHECKS: ReviewStatus[] = ["seen-in-code", "check-outside", "check-applicability"];
/** 갈래 이름에서 "확인할 것 · " 다음의 말. */
const subLabel = (status: ReviewStatus) => REVIEW_STATUS_LABEL[status].split(" · ").at(-1)!;

/**
 * 사례 목록. CLI 세션이 미리 돌린 공개 저장소의 review 2판 결과(2026-11-12 오너 지시). 빌드할 때 그린다. 저장소마다 한 줄: 이름,
 * 한 줄 요약, 감지된 기능과 확인할 것(다시 검토 중인 것은 뺀다)의 수. 줄 전체가 그 사례 쪽으로 가는 링크다(조문 도감 목록과 같은 꼴).
 * 그 아래는 성격이 다른 저장소 8곳의 갈래별 건수·시간·비용 표다. 남의 저장소라 이름·주소·코드를 싣지 않는다.
 */
export default function CasesPage() {
  const { cases, others } = casesFile;
  return (
    <>
      {/* data-page: 머리글이 지금 쪽(사례)을 표시하는 데 쓴다(CSS :has. 머리글의 HTML 은 모든 쪽에서 같다). */}
      <h1 data-page="cases">{SITE.cases.title}</h1>
      <CaseFacts cases={cases} />
      <ul className="policy-index">
        {cases.map((c) => {
          const review = parseReview(c.review);
          const features = review?.profile.features.filter((feature) => feature.removed === null).length ?? 0;
          const check = review ? checkCount(review.checklist.filter((item) => !c.recheck.includes(item.duty))) : 0;
          return (
            <li key={c.slug}>
              <Link href={casesHref(c.slug)} className="pi-row">
                <span className="pi-title">
                  {c.owner}/{c.name}
                </span>
                <span className="pi-law">{CASE_STORIES[c.slug]?.headline}</span>
                <span className="pi-n">
                  기능 {features}가지 · 확인할 것 {check}건
                </span>
                <Icon name="chevron-right" />
              </Link>
            </li>
          );
        })}
      </ul>

      <section className="cases-others" aria-labelledby="cases-others">
        <h2 className="sec-h" id="cases-others">
          성격이 다른 저장소 {others.length}곳에서의 결과
        </h2>
        <div className="box box-scroll">
          <table className="tbl others-table" aria-labelledby="cases-others">
            <thead>
              <tr>
                <th scope="col" rowSpan={2}>
                  성격
                </th>
                <th scope="colgroup" colSpan={CHECKS.length} className="others-group">
                  확인할 것
                </th>
                {REVIEW_STATUSES.filter((status) => !CHECKS.includes(status)).map((status) => (
                  <th key={status} scope="col" rowSpan={2} className="r">
                    {REVIEW_STATUS_LABEL[status]}
                  </th>
                ))}
                <th scope="col" rowSpan={2} className="r">
                  {REVIEW_RECHECK_LABEL}
                </th>
                <th scope="col" rowSpan={2} className="r">
                  시간
                </th>
                <th scope="col" rowSpan={2} className="r">
                  비용 어림
                </th>
              </tr>
              <tr>
                {CHECKS.map((status) => (
                  <th key={status} scope="col" className="r">
                    {subLabel(status)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {others.map((row) => (
                <tr key={row.kind}>
                  <th scope="row">{row.kind}</th>
                  {REVIEW_STATUSES.map((status) => (
                    <td key={status} className="r">
                      {row.counts[status]}
                    </td>
                  ))}
                  <td className="r">{row.recheck}</td>
                  <td className="r">{secondsText(row.seconds)}</td>
                  <td className="r">${row.usd.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">라이브러리는 서비스 기능이 없어 빈 체크리스트가 맞는 결과입니다.</p>
      </section>
    </>
  );
}
