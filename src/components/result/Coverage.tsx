import {
  GAPS_NOTE,
  GAPS_TITLE,
  GAPS_UNLISTED,
  SHOWN_PER_LIST,
  type CoverageSummary,
  type GapFile,
  type GapRow,
} from "@/lib/report/coverage";
import type { ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { Where } from "./Where";

/**
 * 이 도구가 보지 못하는 것(`SITE.notSeen`). 빈 결과 화면에는 펼친 채로, 발견이 있는 결과에는 커버리지 보기에 접힌
 * 채로 들어간다. 목록은 같고 첫 문단만 다르다.
 */
export function NotSeen({ view }: { view: ReportView }) {
  return (
    <>
      <p className="hint">{view.findingCount === 0 ? SITE.notSeen.lead : SITE.notSeen.leadWithFindings}</p>
      <ul className="not-seen">
        {SITE.notSeen.items.map((item) => (
          <li key={item.what}>
            <strong>{item.what}:</strong> {item.why}
            {item.cases && (
              <ul className="not-seen-cases">
                {item.cases.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {/* 대상 언어는 팩이 정한다. 다른 판의 팩으로 만든 결과에서는 위의 "JS/TS"가 맞는지 알 수 없다. */}
      {view.packMatches === false && <p className="hint">{SITE.notSeen.otherPack}</p>}
    </>
  );
}

/** 맨 위 경고. 다 보지 못했거나, 검사한 파일이 없거나, 엔진을 돌리지 않은 결과에만 있다. 결과 화면의 첫 줄에 둔다. */
export function CoverageWarning({ summary }: { summary: CoverageSummary }) {
  if (!summary.warning) return null;
  return (
    <p className="notice notice-warn coverage-warning">
      <strong>{summary.warning.lead}</strong>
      {summary.warning.detail && ` ${summary.warning.detail}`}
    </p>
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
      {row.note && <p className="hint">{row.note}</p>}
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
 * 커버리지 보기. 검사한 파일 수와 판정 단위 수, 그 아래 "다 보지 못한 것" 표. 두 수가 결과에 없으면(SARIF) "알 수
 * 없음"으로 적고, 그 줄 아래에 까닭을 한 줄 덧붙인다.
 *
 * 표는 세 목록(검사하지 않은 파일, 일부를 읽지 못한 파일, 엔진이 끝내지 못한 파일)을 늘 같은 순서로 보인다. 든
 * 것이 없는 줄은 이름과 "없음"만 보이고, 든 것이 있는 줄에만 뜻과 파일이 붙는다. 엔진 오류는 있을 때만 넷째 줄이다.
 *
 * 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다(이름과 수가 한 줄, 뜻과 파일이 그 아래). 그때 display 가 바뀌어도
 * 화면 낭독기가 표로 읽게 role 을 직접 적는다. 칸 머리는 화면에는 보이지 않고 화면 낭독기에만 읽힌다.
 *
 * 발견이 있는 결과에는 표 아래에 "이 도구가 보지 못하는 것"을 접어 둔다. 발견이 0인 결과에서는 바로 아래의 빈 결과
 * 화면이 같은 목록을 펼쳐 보이므로 여기에는 두지 않는다.
 */
export function Coverage({ view, summary }: { view: ReportView; summary: CoverageSummary }) {
  // 든 것이 하나도 없으면 줄을 촘촘히 적는다(CSS). 볼 것이 없는 표가 그 아래의 발견을 밀어내지 않게 한다.
  const none = summary.rows.every((row) => row.count === 0);
  return (
    <div className="coverage">
      <p>{summary.line}</p>
      {summary.lineNote && <p className="hint">{summary.lineNote}</p>}
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
      {view.findingCount > 0 && (
        <details className="fold">
          <summary>
            {SITE.notSeen.title} <span className="fold-note">{GAPS_UNLISTED}</span>
          </summary>
          <NotSeen view={view} />
        </details>
      )}
    </div>
  );
}
