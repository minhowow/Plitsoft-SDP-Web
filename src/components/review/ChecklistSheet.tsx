import Link from "next/link";
import { keepParticles } from "@/components/text";
import { verificationRows, type ChecklistDoc, type ChecklistSource } from "@/lib/review/checklist";
import { SITE } from "@/lib/site";
import { PrintButton } from "./PrintButton";

/**
 * 의무 체크리스트의 인쇄용 보기(2026-11-13 오너 지시). 마크다운 파일과 같은 모양(`lib/review/checklist.ts` 의 `checklistDoc`)을
 * 종이에 맞게 늘어놓는다. 접는 곳·링크·색 칩을 두지 않는다(종이에서는 펼칠 수도 누를 수도 없다). 인쇄하면 이 종이만 나온다
 * (globals.css 의 @media print). 위의 도구 줄(돌아가기, 마크다운으로 받기, 인쇄)은 인쇄되지 않는다.
 */
export function ChecklistSheet({ doc, source, back, markdown }: { doc: ChecklistDoc; source: ChecklistSource; back: string; markdown: string }) {
  return (
    <div className="ck-page">
      <p className="ck-tools">
        <Link href={back}>결과로 돌아가기</Link>
        <a href={markdown} download>
          마크다운으로 받기
        </a>
        <PrintButton />
      </p>
      <article className="ck-sheet" aria-labelledby="ck-sheet-title">
        <h1 id="ck-sheet-title">
          의무 체크리스트 · <span translate="no">{source.repo}</span>
        </h1>
        <p className="ck-lead">
          <b>{SITE.record.lead}</b> {SITE.record.rest}
        </p>
        <ul className="ck-facts">
          <li>
            저장소 <span translate="no">{source.htmlUrl ?? source.repo}</span> · 커밋 <code translate="no">{source.commit.slice(0, 7)}</code>
          </li>
          {source.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
          <li>
            감지된 기능 {doc.overview.features}가지 · 걸릴 수 있는 의무 {doc.overview.obligations}개 · 확인할 것 {doc.overview.check}건
          </li>
          <li>인용은 도구가 그 파일에서 글자 그대로 확인한 줄만 실었습니다.</li>
        </ul>
        {doc.groups.map((group) => (
          <section key={group.key} className={`ck-group${group.todo ? " ck-todo" : ""}`} aria-labelledby={`ck-${group.key}`}>
            <h2 id={`ck-${group.key}`}>
              {group.label} <span className="ck-n">{group.entries.length}건</span>
            </h2>
            <ol className="ck-entries">
              {group.entries.map((entry) => (
                <li key={entry.duty} className="ck-entry">
                  <p className="ck-law">
                    {group.todo && <span className="ck-box" aria-hidden="true" />}
                    <b>{entry.law}</b>
                    {entry.overturned && <span className="ck-tag">반박이 바꿈</span>}
                  </p>
                  {entry.dutyText && <p className="ck-duty">{keepParticles(entry.dutyText)}</p>}
                  {entry.seen && <p>{keepParticles(entry.seen)}</p>}
                  {entry.missing && (
                    <p>
                      <span className="ck-k">없는 것</span> {entry.missing}
                    </p>
                  )}
                  {entry.cites.map((cite, i) => (
                    <p key={i} className="ck-cite">
                      <code translate="no">
                        {cite.file}
                        {cite.line !== null && `:${cite.line}`}
                      </code>{" "}
                      <code translate="no" className="ck-code">
                        {cite.text}
                      </code>
                    </p>
                  ))}
                  {entry.signals.length > 0 && (
                    <p>
                      <span className="ck-k">기능 신호</span>{" "}
                      {entry.signals.map((cite, i) => (
                        <code key={i} translate="no">
                          {i > 0 && ", "}
                          {cite.file}
                          {cite.line !== null && `:${cite.line}`}
                        </code>
                      ))}
                    </p>
                  )}
                  {entry.question && (
                    <p>
                      <span className="ck-k">질문</span> {entry.question}
                    </p>
                  )}
                  {entry.notAnswered && <p>{entry.notAnswered}</p>}
                  {entry.searches.map((s, i) => (
                    <p key={i} className="ck-search">
                      <span className="ck-k">찾아본 말</span> <code translate="no">{s.pattern}</code> ({s.path || "."}) 다시 센 줄{" "}
                      {s.found === null ? "모름" : `${s.found}줄`}
                      {s.claimed !== null && s.claimed !== s.found && ` · AI 가 적은 수 ${s.claimed}줄`}
                    </p>
                  ))}
                  {entry.rest && <p className="ck-rest">{keepParticles(entry.rest)}</p>}
                </li>
              ))}
            </ol>
          </section>
        ))}
        <section className="ck-group" aria-labelledby="ck-verify">
          <h2 id="ck-verify">검증 정보</h2>
          <dl className="ck-verify">
            {verificationRows(doc.run).map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </article>
    </div>
  );
}
