"use client";

import { Fragment, useRef, type MouseEvent, type RefObject } from "react";
import { ReportWithRecord, type ReportSwitch } from "@/components/result/ReportWithRecord";
import { StatusChip } from "@/components/result/StatusChip";
import type { DemoApp, DemoFile, DemoVariant } from "@/lib/demo/apps";
import { compareByPolicy, type CompareCell } from "@/lib/demo/compare";
import { lineMarks } from "@/lib/demo/marks";
import { policyCardId } from "@/lib/pack/href";
import type { PackIndex } from "@/lib/pack/types";
import { STATUS_LEGEND, STATUS_ORDER } from "@/lib/report/status";
import { moveTo } from "@/lib/scroll";
import { SITE } from "@/lib/site";

/**
 * 코드 상자. 합성 코드를 줄 번호와 함께 보인다.
 *
 * 칠하는 줄은 결과의 발견에 실린 줄 번호뿐이다. 그 줄은 문제의 줄이 아니라 조문이 닿는다고 본 첫 줄이므로, 칠한 줄
 * 바로 아래에 판정이 본 범위("파일 전체를 보고 내린 판정입니다 …")를 적는다. 다른 줄을 골라 칠하지 않는다.
 *
 * 다른 판과 견주어 다른 줄에는 줄 번호 앞에 표시(+, −)만 붙인다. 칠하지 않는다. 두 파일의 글자 차이일 뿐이고,
 * 그 줄 때문에 판정이 달라졌다는 뜻이 아니다.
 */
function CodeBox({ file, variant }: { file: DemoFile; variant: DemoVariant }) {
  const marks = new Map(lineMarks(variant.view, file.path).map((mark) => [mark.line, mark]));
  const differs = file.lines.some((line) => line.differs);
  return (
    <figure className="codeblock">
      <figcaption>
        <code>{file.path}</code> · 합성 예시
      </figcaption>
      <pre>
        {file.lines.map((line, i) => {
          const mark = marks.get(i + 1);
          return (
            <Fragment key={i}>
              {/*
                줄 번호와 표시는 CSS 가 그린다. 여기에는 그 줄의 글과 줄바꿈만 둔다. 끌어 골라 복사한 글이 파일의 글과
                같다(빈 줄도 빈 줄로 복사된다). 줄 끝의 줄바꿈은 화면에 빈 줄을 더하지 않는다.
              */}
              <span
                className={mark ? "codeline codeline-marked" : "codeline"}
                data-line={i + 1}
                data-sign={line.differs ? variant.sign : undefined}
              >
                {`${line.text}\n`}
              </span>
              {mark && (
                <span className="codenote">
                  발견 {mark.findings}건에 실린 줄 번호입니다. {mark.notes.join(" ")}
                </span>
              )}
            </Fragment>
          );
        })}
      </pre>
      {differs && (
        <p className="code-legend">
          <span className="code-sign">{variant.sign}</span> {variant.signMeans}
        </p>
      )}
    </figure>
  );
}

/**
 * 표의 정책 이름을 눌렀을 때 아래 결과의 그 정책 카드로 옮겨 간다. 해시 링크를 브라우저에 맡기지 않고 직접 옮긴다
 * (까닭은 `lib/scroll.ts` 의 `moveTo`). 스크립트가 붙기 전이나 꺼진 브라우저에서는 해시 링크 그대로 듣는다.
 *
 * 아래에서 조문별 검사 기록을 보고 있으면 정책 카드는 가려져 있다. 결과 화면으로 돌아간 뒤에 옮겨 간다(`report`).
 * 그러지 않으면 눌러도 아무 일도 일어나지 않는다.
 */
function toCard(event: MouseEvent<HTMLAnchorElement>, id: string, report: RefObject<ReportSwitch | null>) {
  // 새 탭으로 열기처럼 다른 키를 함께 누른 것은 브라우저에 맡긴다.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  // 그 밖에는 브라우저가 옮겨 가지 않게 한다(옮겨 가면 방문 기록에 항목이 더해진다).
  event.preventDefault();
  report.current?.showResult();
  const card = document.getElementById(id);
  if (card) moveTo(card);
}

/**
 * 발견이 없는데 AI 가 푼 경고가 있는 칸. 정책 카드는 그런 정책에 상태의 뜻("발견 없음"은 충족인지 미적용인지 구분할
 * 수 없다) 대신 AI 가 푼 경고가 있다는 사실을 적는다. 표의 풀이도 그렇게 한다.
 */
const clearedOnly = (cell: CompareCell) => cell.findings === 0 && cell.aiCleared > 0;

/**
 * 고치기 전과 고친 뒤의 결과를 정책별로 나란히 놓은 표와, 표에 나온 상태의 뜻.
 *
 * 고친 뒤에도 남은 발견을 숨기지 않고, 풀렸다고도 여전히 문제라고도 적지 않는다. 결과에 실린 상태를 그대로 옮기고,
 * 왜 그 상태인지는 상태의 뜻(`STATUS_LEGEND`)으로 적는다. 상태의 뜻은 여러 까닭을 함께 적으므로(약한 근거만 있거나
 * 파일을 끝까지 읽지 못했거나), 이 발견이 어느 까닭인지는 CLI 가 판정 경로에 남긴 문장을 가리킨다. 그 문장을
 * 해석해 여기에 옮겨 적지 않는다.
 *
 * 표는 두 판을 함께 보이지만 아래의 결과는 지금 보는 판의 것뿐이다. 그래서 가리키는 말에 어느 판의 결과인지를 적고,
 * 다른 판의 결과는 그 판을 골라야 나온다고 따로 적는다. 정책 이름은 아래 결과의 그 정책 카드로 가는 링크다.
 * `report` 는 아래 결과의 틀이다. 거기서 검사 기록을 보고 있을 때 정책 이름을 누르면 결과 화면으로 돌아가게 한다.
 */
function Compare({ app, current, report }: { app: DemoApp; current: DemoVariant; report: RefObject<ReportSwitch | null> }) {
  const rows = compareByPolicy(app.variants.map((variant) => variant.view));
  // 두 판 모두 발견도 AI 가 푼 경고도 없으면 견줄 줄이 없다.
  if (rows.length === 0) return null;
  const cells = rows.flatMap((row) => row.cells);
  const statuses = STATUS_ORDER.filter((status) => cells.some((cell) => cell.status === status && !clearedOnly(cell)));
  const cleared = cells.some((cell) => cell.aiCleared > 0);
  /** 지금 보고 있는 판의 칸. 위의 코드와 아래의 결과가 이 칸의 것이다. */
  const here = (variant: DemoVariant) => (variant.key === current.key ? "compare-current" : undefined);
  // 아래 결과에 카드가 있는 정책만 링크로 만든다(팩의 판이 다른 결과에는 카드가 없는 정책이 있을 수 있다).
  const cards = new Set(current.view.policies.map((policy) => policy.id));
  const linked = rows.some((row) => cards.has(row.id));
  // 아래 결과에 판정 경로가 하나라도 실려 있을 때만 가리킨다.
  const hasPath = current.view.policies.some((policy) =>
    policy.locations.some((location) => location.finding.decision_path.length > 0),
  );
  // 표에는 나오는데 아래 결과에는 없는 것: 다른 판의 발견과 AI 가 푼 경고. 그 판을 골라야 나온다.
  const elsewhere = app.variants.filter(
    (variant, i) => variant.key !== current.key && rows.some((row) => row.cells[i].findings > 0 || row.cells[i].aiCleared > 0),
  );
  // 발견이 0인 다른 판이 표에 있으면(고친 뒤에 발견이 사라진 앱의 고치기 전) 0의 뜻을 표 곁에 적는다. 그 판을 열어야만
  // 보이면 안 된다. 발견이 0인 판을 보고 있을 때는 바로 아래의 결과가 같은 말을 적으므로 두 번 적지 않는다.
  const zeroElsewhere = current.view.findingCount > 0 && app.variants.some((variant) => variant.view.findingCount === 0);
  return (
    <div className="demo-compare">
      {/* 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다. display 가 바뀌어도 화면 낭독기가 표로 읽게 role 을 직접 적는다. */}
      <table className="compare" role="table">
        <caption>고치기 전과 고친 뒤의 결과</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              정책
            </th>
            {app.variants.map((variant) => (
              <th key={variant.key} scope="col" role="columnheader" className={here(variant)}>
                {variant.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <tr key={row.id} role="row">
              <th scope="row" role="rowheader">
                {cards.has(row.id) ? (
                  <a
                    href={`#${encodeURIComponent(policyCardId(row.id))}`}
                    onClick={(event) => toCard(event, policyCardId(row.id), report)}
                  >
                    {row.title}
                  </a>
                ) : (
                  row.title
                )}
              </th>
              {row.cells.map((cell, i) => (
                <td key={app.variants[i].key} role="cell" className={here(app.variants[i])} data-label={app.variants[i].label}>
                  <StatusChip status={cell.status} hint={STATUS_LEGEND[cell.status]} />
                  {cell.findings > 0 && (
                    <>
                      {" "}
                      <span className="count">발견 {cell.findings}건</span>
                    </>
                  )}
                  {cell.aiCleared > 0 && (
                    <>
                      {" "}
                      <span className="count">AI 가 푼 경고 {cell.aiCleared}건</span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="status-notes">
        {statuses.map((status) => (
          <li key={status}>
            <StatusChip status={status} hint={STATUS_LEGEND[status]} /> {STATUS_LEGEND[status]}
          </li>
        ))}
        {cleared && (
          <li>
            AI 가 푼 경고는 AI 판정자의 답으로 풀린 경고이고, 발견에는 들어 있지 않습니다. 인용한 줄은 그 결과의 &lsquo;AI 가 푼
            경고&rsquo;에서 확인하세요.
          </li>
        )}
      </ul>
      {zeroElsewhere && <p className="hint">{SITE.zeroIsNotClearance}</p>}
      {linked && (
        <p className="hint">
          표의 정책 이름을 누르면 아래 결과({current.label})의 그 정책으로 갑니다.
          {hasPath && " 발견마다의 까닭은 그 안의 ‘판정 경로’에 CLI 가 남긴 문장으로 나옵니다."}
        </p>
      )}
      {elsewhere.map((variant) => (
        <p key={variant.key} className="hint">
          {variant.label}의 결과는 위의 &lsquo;{variant.label}&rsquo; 단추를 누르면 나옵니다.
        </p>
      ))}
    </div>
  );
}

/**
 * 데모 앱 하나의 한 판: 이름, 코드가 무엇을 하는지, 코드, 두 판의 결과, 이 판의 결과(CLI 출력 그대로).
 * 모든 판에 합성 예시라고 밝힌다(설명의 첫 문장과 코드 상자의 이름표).
 *
 * 이 판의 결과는 조문별 검사 기록으로도 본다(`ReportWithRecord`). 기록만 인쇄되므로 기록에도 합성 예시라고 적는다.
 * 기록에 적는 이름은 위의 제목과 같다.
 */
export function DemoPanel({ app, variant, pack }: { app: DemoApp; variant: DemoVariant; pack: PackIndex }) {
  const name = `${app.label} · ${variant.label}`;
  // 아래 결과의 틀. 표의 정책 이름을 눌렀을 때 결과 화면이 보이게 하는 데 쓴다.
  const report = useRef<ReportSwitch>(null);
  return (
    <>
      <h2 className="demo-title">{name}</h2>
      <p className="demo-note">합성 예시입니다. {variant.note}</p>
      {variant.files.map((file) => (
        <CodeBox key={file.path} file={file} variant={variant} />
      ))}
      <Compare app={app} current={variant} report={report} />
      <ReportWithRecord ref={report} view={variant.view} pack={pack} source={{ name, synthetic: true }} />
    </>
  );
}
