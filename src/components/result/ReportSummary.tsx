import { coverageSummary } from "@/lib/report/coverage";
import { examinedFacts, UNIT_GLOSS } from "@/lib/report/examined";
import { CONTRACT_LABEL, type ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { Coverage, CoverageWarning, NotSeen } from "./Coverage";
import { PolicyCard } from "./PolicyCard";

function where(file: string, line?: number | null): string {
  return line === null || line === undefined ? file : `${file}:${line}`;
}

/** AI 가 푼 경고와 적용 질문으로 빠진 판정. CLI 가 사람이 검토하라고 남긴 것이라 숨기지 않는다. */
function AiDecisions({ view }: { view: ReportView }) {
  if (view.aiCleared.length === 0 && view.aiDismissed.length === 0) return null;
  return (
    <div className="ai-decisions">
      {view.aiCleared.length > 0 && (
        <details open>
          <summary>AI 가 푼 경고 {view.aiCleared.length}건</summary>
          <p className="hint">
            AI 판정자가 &lsquo;예&rsquo;라고 답하고 코드 줄을 인용해서 경고가 풀렸습니다. 인용이 코드에 있는지만 확인된
            것입니다. 그 줄이 이 규칙의 근거가 맞는지는 사람이 봐야 합니다.
          </p>
          <ul>
            {view.aiCleared.map((cleared, i) => (
              <li key={i}>
                <code>{where(cleared.file, cleared.line)}</code> <span className="alt-id">{cleared.policy}</span>
                <ul>
                  {cleared.alternatives.map((alt, j) => (
                    <li key={j}>
                      <span className="alt-id">{alt.id}</span> {alt.cite ? <code>{alt.cite}</code> : "인용 없음"}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
      {view.aiDismissed.length > 0 && (
        <details open>
          <summary>AI 가 적용되지 않는다고 답해 빠진 판정 {view.aiDismissed.length}건</summary>
          <p className="hint">적용 여부를 묻는 질문에 AI 가 &lsquo;아니오&rsquo;라고 답했습니다. 인용 없이 빠진 판정입니다.</p>
          <ul>
            {view.aiDismissed.map((dismissed, i) => (
              <li key={i}>
                <code>{where(dismissed.file, dismissed.line)}</code> <span className="alt-id">{dismissed.policy}</span>
                {dismissed.question && <p className="ask">질문: {dismissed.question}</p>}
                {dismissed.answer && <p className="ask">답: {dismissed.answer}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * 빈 결과 화면. 발견이 0인 결과에만 보인다. 발견이 없다는 것만으로는 무엇을 봤는지 알 수 없으므로,
 * 검사한 것(파일 수, 판정 단위 수, 검사하지 않은 파일, 정책)과 이 도구가 보지 못하는 것을 함께 적는다.
 * 정책 목록은 바로 아래의 정책 카드다.
 */
function EmptyReport({ view }: { view: ReportView }) {
  return (
    <div className="empty-report">
      <section>
        <h3>검사한 것</h3>
        <dl className="examined">
          {examinedFacts(view).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className={fact.warn ? "warn" : undefined}>
                <strong>{fact.value}.</strong> <span className="fact-note">{fact.note}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="hint">{UNIT_GLOSS}</p>
      </section>
      <section>
        <h3>{SITE.notSeen.title}</h3>
        <NotSeen view={view} />
      </section>
    </div>
  );
}

/** 결과 한 건의 전체 화면. 뷰어, 데모, (나중의) 검사 결과 페이지가 모두 이 부품을 쓴다. */
export function ReportSummary({ view }: { view: ReportView }) {
  const coverage = coverageSummary(view);
  return (
    <section className="report">
      {/* 다 보지 못한 검사라는 경고는 맨 위에 둔다. 아래의 발견과 "발견 없음"을 읽기 전에 알아야 한다. */}
      <CoverageWarning summary={coverage} />

      <dl className="report-meta">
        <div>
          <dt>도구</dt>
          <dd>{view.tool}</dd>
        </div>
        <div>
          <dt>엔진</dt>
          <dd>{view.engine ?? "실행 안 함"}</dd>
        </div>
        <div>
          <dt>판정자</dt>
          <dd>{view.judge ?? "꺼짐"}</dd>
        </div>
        <div>
          <dt>팩 판</dt>
          <dd>
            <code>{view.packDigest}</code>
          </dd>
        </div>
        <div>
          <dt>출력 형식</dt>
          <dd>{CONTRACT_LABEL[view.contract]}</dd>
        </div>
      </dl>

      {view.packMatches === false && (
        <p className="notice notice-warn">
          이 결과를 만든 팩과 이 사이트에 실린 팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다.
          {/* "알 수 없음" 카드가 있을 때만 덧붙인다. v1 초안은 결과에 나온 정책만 카드로 그리므로 그런 카드가 없다. */}
          {view.policies.some((policy) => policy.status === "pack-unknown") &&
            " 발견이 없는 정책은 그 팩에 있었는지 알 수 없습니다."}
        </p>
      )}

      <Coverage view={view} summary={coverage} />

      {view.findingCount === 0 ? (
        <>
          <p className="notice">{SITE.zeroIsNotClearance}</p>
          <EmptyReport view={view} />
        </>
      ) : (
        <p className="notice">사람이 확인할 발견이 {view.findingCount}건 있습니다.</p>
      )}

      {/* 카드가 없을 수 있다(정책별 요약이 빈 v1 초안). 빈 상자가 간격만 차지하지 않게 한다. */}
      {view.policies.length > 0 && (
        <div className="policies">
          {view.policies.map((policy) => (
            <PolicyCard key={policy.id} policy={policy} />
          ))}
        </div>
      )}

      <AiDecisions view={view} />

      <p className="disclaimer">{SITE.disclaimer}</p>
    </section>
  );
}
