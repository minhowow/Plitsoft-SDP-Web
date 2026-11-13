import { EVAL_LIMITS, evalFile, type EvalRow } from "@/lib/cases/eval";
import { REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { REVIEW_STATUSES, type ReviewStatus } from "@/lib/review";
import { secondsText } from "@/lib/service/steps";

/** "확인할 것"의 세 갈래(표의 머리에서 한 칸으로 묶는다). */
const CHECKS: ReviewStatus[] = ["seen-in-code", "check-outside", "check-applicability"];
/** 갈래 이름에서 "확인할 것 · " 다음의 말. */
const subLabel = (status: ReviewStatus) => REVIEW_STATUS_LABEL[status].split(" · ").at(-1)!;
const n = (v: number) => v.toLocaleString("en-US");

/**
 * 공개 저장소 41곳의 review 평가(2026-11-13 오너 지시, 데이터는 `lib/cases/eval.ts`). 큰 숫자 한 줄, 성격별 표(갈래별 건수, 코드에서
 * 본 것이 있는 곳, 정적 검사만으로 경고가 있는 곳, 인용과 거절, 시간, 비용), 알려진 한계. 남의 저장소라 이름·주소·코드를 싣지 않는다.
 * 같은 숫자의 포스터 그림은 docs/figures/review-results-41 이다.
 */
export function EvalSection() {
  const { total, categories } = evalFile;
  const seen = subLabel("seen-in-code");
  return (
    <section className="cases-others cases-eval" aria-labelledby="cases-eval">
      <h2 className="sec-h" id="cases-eval">
        공개 저장소 {total.repos}곳에서 돌려 본 결과
      </h2>
      <p className="pi-meta">
        <span>
          <time dateTime={evalFile.ranOn}>{evalFile.ranOn}</time>
        </span>{" "}
        <span>
          조사 <code translate="no">{evalFile.model}</code>
        </span>{" "}
        <span>반박 없음</span>{" "}
        <span>
          판정 규칙 CLI <code translate="no">{evalFile.rules}</code>
        </span>
      </p>
      <p className="overview">
        <span>
          {seen}이 있는 곳{" "}
          <b>
            {total.withSeenInCode}/{total.repos}곳
          </b>{" "}
          <span className="hint">정적 검사만으로는 {evalFile.static.withFindings}곳</span>
        </span>
        <span>
          빈 체크리스트 <b>{total.emptyChecklists}곳</b> <span className="hint">기능 없음</span>
        </span>
        <span>
          도구가 거절한 인용{" "}
          <b>
            {n(total.citationsRejected)}/{n(total.citations)}건
          </b>
        </span>
        <span>
          비용 어림 <b>${total.usd.toFixed(2)}</b>
        </span>
      </p>
      <div className="box box-scroll">
        <table className="tbl others-table" aria-labelledby="cases-eval">
          <thead>
            <tr>
              <th scope="col" rowSpan={2}>
                성격
              </th>
              <th scope="col" rowSpan={2} className="r">
                곳
              </th>
              <th scope="col" rowSpan={2} className="r">
                {seen}이 있는 곳
              </th>
              <th scope="col" rowSpan={2} className="r">
                정적 검사만으로 경고가 있는 곳
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
                인용(거절)
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
            {categories.map((row) => (
              <Row key={row.kind} name={row.kind} row={row} />
            ))}
          </tbody>
          <tfoot>
            <Row name="합계" row={total} />
          </tfoot>
        </table>
      </div>
      <details className="fold eval-limits">
        <summary>알려진 한계 {EVAL_LIMITS.length}가지</summary>
        <ul>
          {EVAL_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Row({ name, row }: { name: string; row: EvalRow }) {
  return (
    <tr>
      <th scope="row">{name}</th>
      <td className="r">{row.repos}</td>
      <td className="r">{row.withSeenInCode}</td>
      <td className="r">{row.staticWithFindings}</td>
      {REVIEW_STATUSES.map((status) => (
        <td key={status} className="r">
          {n(row.counts[status])}
        </td>
      ))}
      <td className="r">
        {n(row.citations)} ({row.citationsRejected})
      </td>
      <td className="r">{secondsText(row.seconds)}</td>
      <td className="r">${row.usd.toFixed(2)}</td>
    </tr>
  );
}
