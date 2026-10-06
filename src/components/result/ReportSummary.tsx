import type { ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { PolicyCard } from "./PolicyCard";

function FileList({ label, note, files }: { label: string; note: string; files: string[] }) {
  if (files.length === 0) return null;
  return (
    <details className="filelist">
      <summary>
        {label} {files.length}개
      </summary>
      <p className="hint">{note}</p>
      <ul>
        {files.map((file, i) => (
          <li key={`${file}:${i}`}>
            <code>{file}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

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

/** 결과 한 건의 전체 화면. 뷰어, 데모, (나중의) 검사 결과 페이지가 모두 이 부품을 쓴다. */
export function ReportSummary({ view }: { view: ReportView }) {
  const { coverage } = view;
  return (
    <section className="report">
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
          <dd>{view.contract === "v1-draft" ? "v1 초안" : "CLI 0.3"}</dd>
        </div>
      </dl>

      {view.packMatches === false && (
        <p className="notice notice-warn">
          이 결과를 만든 팩과 이 사이트에 실린 팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있고, 발견이 없는 정책은
          그 팩에 있었는지 알 수 없습니다.
        </p>
      )}

      <div className="coverage">
        <p>
          {coverage.files === null ? "파일 수 정보 없음" : `파일 ${coverage.files}개 검사`} · 판정 단위 {coverage.units}개 ·{" "}
          {coverage.complete ? "끝까지 봤습니다" : "다 보지 못했습니다"}
        </p>
        {!coverage.complete && <p className="notice notice-warn">검사를 끝까지 하지 못한 부분이 있습니다.</p>}
        <FileList label="검사하지 않은 파일" note="이 파일들은 결과에 없습니다." files={coverage.skipped} />
        <FileList
          label="일부를 읽지 못한 파일"
          note="구문 조건을 확인하지 못해 판단 보류로 남았을 수 있습니다. 결과에는 들어 있습니다."
          files={coverage.unparsed}
        />
        <FileList
          label="엔진이 끝내지 못한 파일"
          note="끝나지 않은 조건은 판단 보류로 남습니다. 결과에는 들어 있습니다."
          files={coverage.incomplete}
        />
        {coverage.engineErrors > 0 && <p className="notice notice-warn">엔진 오류 {coverage.engineErrors}건이 있습니다.</p>}
      </div>

      {view.findingCount === 0 ? (
        <p className="notice">{SITE.zeroIsNotClearance}</p>
      ) : (
        <p className="notice">사람이 확인할 발견이 {view.findingCount}건 있습니다.</p>
      )}

      <div className="policies">
        {view.policies.map((policy) => (
          <PolicyCard key={policy.id} policy={policy} />
        ))}
      </div>

      <AiDecisions view={view} />

      <p className="disclaimer">{SITE.disclaimer}</p>
    </section>
  );
}
