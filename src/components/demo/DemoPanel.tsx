"use client";

import Link from "next/link";
import { Fragment, useRef, type MouseEvent, type RefObject } from "react";
import { JUDGE_ADVICE } from "@/components/result/ReportSummary";
import { ReportWithRecord, type ReportSwitch } from "@/components/result/ReportWithRecord";
import { StatusChip } from "@/components/result/StatusChip";
import type { DemoApp, DemoFile, DemoVariant } from "@/lib/demo/apps";
import { compareTable } from "@/lib/demo/compare";
import { lineMarks } from "@/lib/demo/marks";
import { policyCardId } from "@/lib/pack/href";
import type { PackIndex } from "@/lib/pack/types";
import { STATUS_LABEL } from "@/lib/report/status";
import { aiReviewRan } from "@/lib/report/view-model";
import { moveTo } from "@/lib/scroll";
import { SITE } from "@/lib/site";

/**
 * 코드 상자. 합성 코드를 줄 번호와 함께 보인다. 머리에 경로와, 이 판의 코드가 무엇을 하는지(데모 앱의 설명) 적는다.
 *
 * 칠하는 줄은 결과의 발견에 실린 줄 번호뿐이다. 그 줄은 문제의 줄이 아니라 조문이 닿는다고 본 첫 줄이므로, 칠한 줄
 * 바로 아래에 `발견 N건이 가리키는 줄(파일 전체 판정)` 처럼 판정이 본 범위를 적는다. 다른 줄을 골라 칠하지 않는다.
 *
 * 다른 판과 견주어 다른 줄에는 줄 번호 앞에 표시(+, −)만 붙인다. 칠하지 않는다. 두 파일의 글자 차이일 뿐이고,
 * 그 줄 때문에 판정이 달라졌다는 뜻이 아니다.
 */
function CodeBox({ file, variant }: { file: DemoFile; variant: DemoVariant }) {
  const marks = new Map(lineMarks(variant.view, file.path).map((mark) => [mark.line, mark]));
  const differs = file.lines.some((line) => line.differs);
  return (
    <figure className="box codeblock">
      <figcaption className="box-hd">
        <code translate="no">{file.path}</code>
        <span className="end">{variant.note}</span>
      </figcaption>
      <pre translate="no">
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
                  발견 {mark.findings}건이 가리키는 줄({mark.scopes.join(", ")})
                </span>
              )}
            </Fragment>
          );
        })}
      </pre>
      {differs && (
        <p className="code-legend box-ft">
          <span className="code-sign">{variant.sign}</span> {variant.signMeans}
        </p>
      )}
    </figure>
  );
}

/**
 * 표의 정책 이름을 눌렀을 때 아래 결과의 그 정책 상자로 옮겨 간다. 해시 링크를 브라우저에 맡기지 않고 직접 옮긴다
 * (까닭은 `lib/scroll.ts` 의 `moveTo`). 스크립트가 붙기 전이나 꺼진 브라우저에서는 해시 링크 그대로 듣는다.
 *
 * 아래에서 조문별 검사 기록을 보고 있으면 정책 상자는 가려져 있다. 결과 화면으로 돌아간 뒤에 옮겨 간다(`report`).
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

/** 표의 이름. 발견이 0인 판의 `검사한 것` 이 정책 목록을 지닌 곳으로 이 이름을 부른다. */
const COMPARE_TITLE = "고치기 전과 고친 뒤";

/**
 * 고치기 전과 고친 뒤의 결과를 정책별로 나란히 놓은 표. 칸마다 상태 칩과 발견 수(AI 가 푼 경고가 있으면 그 수)다. 표 아래에
 * 0의 뜻을 늘 적고(발견 없음인 칸이 있다), 머리 오른쪽에 `상태의 뜻`(조문 도감)을 둔다. 상태 풀이 문장은 두지 않는다.
 *
 * 데모의 결과에는 곁칸 `정책 N` 이 없다(D7, 목업 demo). 이 상자가 정책 목록을 지닌다: 발견이나 AI 가 푼 경고가 있는 정책은
 * 표의 줄이고, 두 판 모두 같은 0의 상태(발견 없음 등)인 정책은 표 아래에 상태마다 한 덩어리로 이름만 적는다(`compareTable`.
 * 곁칸의 묶음과 같다. 줄마다 적으면 표가 1280×800 의 첫 화면을 다 차지해 첫 발견이 밀려났다. D7 검토).
 *
 * 고친 뒤에도 남은 발견을 숨기지 않고, 풀렸다고도 여전히 문제라고도 적지 않는다. 결과에 실린 상태를 그대로 옮긴다. 정책
 * 이름은 아래 결과(지금 보는 판)의 그 정책 상자로 가는 링크다(상자가 있는 정책만). `report` 는 아래 결과의 틀이다. 거기서 검사
 * 기록을 보고 있을 때 정책 이름을 누르면 결과 화면으로 돌아가게 한다.
 */
function Compare({ app, current, report }: { app: DemoApp; current: DemoVariant; report: RefObject<ReportSwitch | null> }) {
  const { rows, quiet } = compareTable(app.variants.map((variant) => variant.view));
  // 두 판 모두 결과에 정책이 하나도 없으면 견줄 것이 없다.
  if (rows.length === 0 && quiet.length === 0) return null;
  const every = app.variants.length === 2 ? "두 판 모두" : "모든 판";
  /** 지금 보고 있는 판의 칸. 위의 코드와 아래의 결과가 이 칸의 것이다. */
  const here = (variant: DemoVariant) => (variant.key === current.key ? "compare-current" : undefined);
  // 아래 결과에 상자가 있는 정책만 링크로 만든다(발견이나 충족 근거가 있는 정책).
  const cards = new Set(
    current.view.policies.filter((policy) => policy.locations.length > 0 || policy.evidence.length > 0).map((policy) => policy.id),
  );
  return (
    <section className="box demo-compare" aria-labelledby="compare-title">
      <div className="box-hd">
        <h2 id="compare-title">{COMPARE_TITLE}</h2>
        <Link href="/policy/#status" prefetch={false} className="end">
          상태의 뜻
        </Link>
      </div>
      {/* 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다. display 가 바뀌어도 화면 낭독기가 표로 읽게 role 을 직접 적는다. */}
      {rows.length > 0 && (
        <table className="compare" role="table" aria-labelledby="compare-title">
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
                    <StatusChip status={cell.status} />
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
      )}
      {quiet.map((group) => (
        <div key={group.status} className="compare-quiet">
          <p className="lbl">
            {every} {STATUS_LABEL[group.status]} {group.policies.length}
          </p>
          <ul>
            {group.policies.map((policy) => (
              <li key={policy.id}>{policy.title}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="box-ft">{SITE.zeroIsNotClearance}</p>
    </section>
  );
}

/**
 * 데모 앱 하나의 한 판(docs/redesign.md 3장 "데모"). 1100px 이상에서는 둘로 나눈다: 왼쪽은 코드 상자, 오른쪽은 고치기 전·후
 * 표, 판정자 권고 한 줄(외부 API 고지와 함께. 판정자 없이 만든 결과일 때만), 이 판의 결과(CLI 출력 그대로). 좁으면 한 단이다.
 * 결과에는 곁칸이 없다(표가 정책 목록과 0의 뜻을 지닌다). 다 보지 못한 파일의 약속 자리인 검사 정보는 남는다.
 *
 * 이 판의 결과는 조문별 검사 기록으로도 본다(`ReportWithRecord`). 기록만 인쇄되므로 기록에도 합성 예시라고 적는다.
 */
export function DemoPanel({ app, variant, pack }: { app: DemoApp; variant: DemoVariant; pack: PackIndex }) {
  const name = `${app.label} · ${variant.label}`;
  // 아래 결과의 틀. 표의 정책 이름을 눌렀을 때 결과 화면이 보이게 하는 데 쓴다.
  const report = useRef<ReportSwitch>(null);
  return (
    <div className="demo-grid">
      <div className="demo-code">
        {variant.files.map((file) => (
          <CodeBox key={file.path} file={file} variant={variant} />
        ))}
      </div>
      <div className="demo-side">
        <Compare app={app} current={variant} report={report} />
        {!aiReviewRan(variant.view) && <p className="judge-advice">{JUDGE_ADVICE}</p>}
        <ReportWithRecord
          ref={report}
          view={variant.view}
          pack={pack}
          source={{ name, synthetic: true }}
          heading={<h2 className="demo-title">{name}</h2>}
          policyList={`‘${COMPARE_TITLE}’ 표`}
        />
      </div>
    </div>
  );
}
