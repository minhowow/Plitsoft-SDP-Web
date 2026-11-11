import {
  GAPS_NOTE,
  GAPS_TITLE,
  SHOWN_PER_LIST,
  type CoverageSummary,
  type GapFile,
  type GapRow,
} from "@/lib/report/coverage";
import { keepParticles } from "@/components/text";
import type { ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { Where } from "./Where";

/**
 * 검사에 들지 않는 파일과 정보(`SITE.notSeen`). 발견이 0인 결과 화면에 펼친 채로 들어간다. 발견이 있는 결과에서는 쪽 아래
 * 검사 정보의 링크가 조문 도감으로 잇는다(docs/redesign.md 3장). 목록은 같고 첫 문단만 발견 수에 따라 다르다.
 */
export function NotSeen({ view }: { view: ReportView }) {
  return (
    <>
      <p className="hint">{view.findingCount === 0 ? SITE.notSeen.lead : SITE.notSeen.leadWithFindings}</p>
      <NotSeenList />
      {/* 대상 언어는 팩이 정한다. 다른 판의 팩으로 만든 결과에서는 위의 "JS/TS"가 맞는지 알 수 없다. */}
      {view.packMatches === false && <p className="hint">{SITE.notSeen.otherPack}</p>}
    </>
  );
}

/**
 * 검사에 들지 않는 파일과 정보의 항목 목록(`SITE.notSeen.items` 그대로). 결과 화면(위 `NotSeen`)과 조문 도감 목록의 `#scope` 가
 * 함께 쓴다.
 */
export function NotSeenList() {
  // 항목마다 한 줄: 무엇(왼쪽) | 왜(오른쪽, 까닭이 여럿이면 한 줄씩). 좁은 화면에서는 위아래로 쌓는다(CSS, 목업 notseen 의 def 줄).
  // 쌍점은 화면 낭독기와 글 복사에만 남긴다.
  return (
    <ul className="not-seen">
      {SITE.notSeen.items.map((item) => (
        <li key={item.what}>
          <strong>
            {item.what}
            <span className="visually-hidden">:</span>
          </strong>{" "}
          <div className="ns-why">
            {item.why}
            {item.cases && (
              <ul className="not-seen-cases">
                {item.cases.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FileItem({ item }: { item: GapFile }) {
  return (
    <li>
      <Where file={item.file} line={null} />
      {/* 검사한 파일(일부를 읽지 못했거나 엔진이 끝내지 못한 파일)은 결과에 들어 있다. 몇 건이 나왔는지 옆에 적는다. */}
      {item.findings !== null && (
        <>
          {" "}
          <span className="gap-found">발견 {item.findings}건</span>
        </>
      )}
    </li>
  );
}

/**
 * 목록의 파일. 앞의 몇 곳을 먼저 보이고 나머지는 접는다. 순서는 결과에 실린 그대로다.
 *
 * 발견이 나온 파일이 접힌 곳에 있으면 접힌 이름 옆에 그 수를 적는다. 먼저 보이는 곳이 모두 "발견 0건"일 때 펼치기
 * 전에는 걸린 발견이 없는 것처럼 읽히기 때문이다. 순서를 바꿔 앞으로 끌어오지는 않는다. 규칙 묶음이 접힌 곳의
 * 상태를 머리에 적는 것과 같은 원칙이다.
 */
function GapFiles({ files }: { files: GapFile[] }) {
  if (files.length === 0) return null;
  const folded = files.slice(SHOWN_PER_LIST);
  const foldedWithFindings = folded.filter((item) => (item.findings ?? 0) > 0).length;
  return (
    <>
      <ul className="gap-files">
        {files.slice(0, SHOWN_PER_LIST).map((item, i) => (
          <FileItem key={`${item.file}:${i}`} item={item} />
        ))}
      </ul>
      {folded.length > 0 && (
        <details className="fold">
          <summary>
            나머지 {folded.length}개
            {foldedWithFindings > 0 && (
              <>
                {" "}
                <span className="fold-note">이 가운데 발견이 나온 파일 {foldedWithFindings}개</span>
              </>
            )}
          </summary>
          <ul className="gap-files">
            {folded.map((item, i) => (
              <FileItem key={`${item.file}:${i}`} item={item} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function GapDetail({ row }: { row: GapRow }) {
  return (
    <>
      {row.meaning && <p>{row.meaning}</p>}
      {row.note && <p className="hint">{keepParticles(row.note)}</p>}
      <GapFiles files={row.files} />
      {row.texts.length > 0 && (
        <details className="fold">
          {/* 엔진의 문장 그대로가 아니다. CLI 가 오류 종류를 앞에 붙이고 앞 200자까지만 결과에 싣는다. */}
          <summary>결과에 실린 오류 문장 {row.texts.length}개</summary>
          <p className="hint">결과에 실린 문장 그대로입니다.</p>
          <ul className="gap-texts">
            {row.texts.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/**
 * 다 보지 못했다는 경고(2026-11-11 오너 지시). 다 보지 못했거나, 검사한 파일이 없거나, 엔진을 돌리지 않은 결과에만 있다. 결과
 * 화면의 요약 바로 아래에 접어 둔다. 접힌 머리에도 굵은 첫 문장과 목록에 든 것의 수가 늘 보이고, 펼치면 "다 보지 못한 것" 표다.
 *
 * 표는 세 목록(검사하지 않은 파일, 일부를 읽지 못한 파일, 엔진이 끝내지 못한 파일)을 늘 같은 순서로 보인다. 든 것이 없는 줄은
 * 이름과 "없음"만 보이고, 든 것이 있는 줄에만 뜻과 파일이 붙는다. 엔진 오류는 있을 때만 넷째 줄이다. 경고가 없는 결과에는 표도
 * 없다(쪽 아래 검사 정보가 "결과에 실린 ‘다 보지 못한 파일’ 없음"이라고 적는다).
 *
 * 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다(이름과 수가 한 줄, 뜻과 파일이 그 아래). 그때 display 가 바뀌어도 화면 낭독기가 표로
 * 읽게 role 을 직접 적는다. 칸 머리는 화면에는 보이지 않고 화면 낭독기에만 읽힌다.
 */
export function CoverageWarning({ summary }: { summary: CoverageSummary }) {
  if (!summary.warning) return null;
  const rest = summary.warning.counts ?? summary.warning.detail;
  return (
    <details className="warn coverage-warning">
      <summary className="warn-hd">
        <strong>{summary.warning.lead}</strong>
        {rest && ` ${rest}`}
      </summary>
      <GapTable summary={summary} />
    </details>
  );
}

/** "다 보지 못한 것" 표. 맨 위 경고 안에 둔다. */
export function GapTable({ summary }: { summary: CoverageSummary }) {
  // 든 것이 하나도 없으면 줄을 촘촘히 적는다(CSS). 볼 것이 없는 표가 그 아래의 발견을 밀어내지 않게 한다.
  const none = summary.rows.every((row) => row.count === 0);
  return (
    <div className="coverage">
      <table className={none ? "gaps gaps-none" : "gaps"} role="table">
        <caption>
          {GAPS_TITLE} <span className="caption-note">{GAPS_NOTE}</span>
        </caption>
        <thead className="visually-hidden" role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              목록
            </th>
            <th scope="col" role="columnheader">
              수
            </th>
            <th scope="col" role="columnheader">
              뜻과 파일
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {summary.rows.map((row) => (
            <tr key={row.kind} className={row.count > 0 ? "gap gap-on" : "gap"} role="row">
              <th scope="row" role="rowheader">
                {row.label}
              </th>
              <td className="gap-count" role="cell">
                {row.countText}
              </td>
              <td className="gap-detail" role="cell">
                <GapDetail row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
