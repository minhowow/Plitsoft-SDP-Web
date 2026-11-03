import Link from "next/link";
import { Coverage, CoverageWarning } from "@/components/result/Coverage";
import { PolicyCard, type CodeSource } from "@/components/result/PolicyCard";
import { AiDecisions, EmptyReport } from "@/components/result/ReportSummary";
import { StatusChip } from "@/components/result/StatusChip";
import { STATUS_LEGEND, type Status } from "@/lib/report/status";
import { policyCardId, policyHref } from "@/lib/pack/href";
import { coverageSummary } from "@/lib/report/coverage";
import type { PolicyView, ReportView } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";

/**
 * 끝난 분석의 대시보드. 결과 화면의 부품(정책 카드, 커버리지, AI 가 푼 것, 빈 결과 화면)과 문구를 그대로 쓰고, 배치만 새로 짠다.
 *
 * 위에서부터: 한눈에 보는 수(사람이 볼 곳, 검사한 파일 등. 점수·등급·비율이 아니다) → 다 보지 못한 검사라는 경고(있을 때만)
 * → 정책별 요약(정책마다 상태와 발견 수. 넓은 화면에서는 옆 칸) → 정책 카드(발견 줄, 확인 질문, 접어 둔 근거 조문 원문)
 * → 발견이 없는 정책의 표(같은 설명을 카드마다 되풀이하지 않는다) → AI 가 푼 것
 * → 다 보지 못한 것 → 면책. 발견이 0이면 0의 뜻과 "검사한 것·보지 못하는 것"을 정책 카드 앞에 둔다(결과 화면과 같다).
 */
/** 근거 조문 하나: 팩 메타데이터의 대표 조문 이름과 원문(`legal[].text`) 그대로. */
export interface Statute {
  label: string;
  text: string;
}

/** 발견이 있는 정책 카드 안에 접어 두는 근거 조문 원문. 글자를 고치지 않고 옮긴다. */
function StatuteFold({ statute }: { statute: Statute }) {
  return (
    <details className="fold dash-statute">
      <summary>근거 조문 원문 · {statute.label}</summary>
      <pre className="statute">{statute.text}</pre>
    </details>
  );
}

/**
 * 따로 카드로 그릴 것이 없는 정책: 발견도, 충족 근거 위치도, AI 가 푼 경고도 없다. 이런 정책은 카드마다 같은 상태 설명을
 * 되풀이하게 되므로 표 한 장에 모으고, 상태의 설명은 상태마다 한 번만 적는다.
 */
function isQuiet(policy: PolicyView): boolean {
  return policy.locations.length === 0 && policy.evidence.length === 0 && policy.aiCleared === 0;
}

function QuietPolicies({ policies }: { policies: PolicyView[] }) {
  const statuses = [...new Set(policies.map((policy) => policy.status))] as Status[];
  return (
    <section className="quiet" aria-labelledby="quiet-title">
      <h3 id="quiet-title">발견이 없는 정책 {policies.length}개</h3>
      <ul className="quiet-list">
        {policies.map((policy) => (
          <li key={policy.id} id={policyCardId(policy.id)} className="quiet-row">
            <span className="quiet-title">
              {policy.inPack ? (
                <Link href={policyHref(policy.id)} prefetch={false}>
                  {policy.title}
                </Link>
              ) : (
                policy.title
              )}
            </span>
            <span className="quiet-law">{policy.law}</span>
            <StatusChip status={policy.status} />
            {policy.units !== null && <span className="count">판정 단위 {policy.units}개</span>}
          </li>
        ))}
      </ul>
      {statuses.map((status) => (
        <p key={status} className="hint quiet-hint">
          <StatusChip status={status} /> {STATUS_LEGEND[status]}
        </p>
      ))}
    </section>
  );
}

export function AnalysisDashboard({
  view,
  code,
  statutes = {},
}: {
  view: ReportView;
  code: CodeSource | null;
  /** 정책 id → 대표 근거 조문. 서버가 팩 메타데이터에서 고른다(분석 쪽). 없으면 조문을 싣지 않는다. */
  statutes?: Record<string, Statute | undefined>;
}) {
  const coverage = coverageSummary(view);
  const withFindings = view.policies.filter((policy) => policy.locations.length > 0).length;
  const gaps = coverage.rows.some((row) => row.count > 0);
  const aiTotal = view.aiCleared.length + view.aiDismissed.length;
  const loud = view.policies.filter((policy) => !isQuiet(policy));
  const quiet = view.policies.filter(isQuiet);
  return (
    <section className="dash" aria-label="분석 결과">
      <dl className="tiles" aria-label="한눈에 보는 수">
        <div className={view.findingCount > 0 ? "tile tile-on" : "tile"}>
          <dt>사람이 볼 곳</dt>
          <dd>
            <strong>{view.findingCount}</strong>건
          </dd>
        </div>
        <div className="tile">
          <dt>발견이 있는 정책</dt>
          <dd>
            <strong>{withFindings}</strong>개
          </dd>
        </div>
        <div className="tile">
          <dt>검사한 파일</dt>
          <dd>{view.coverage.files === null ? "알 수 없음" : <><strong>{view.coverage.files}</strong>개</>}</dd>
        </div>
        <div className="tile">
          <dt>판정 단위</dt>
          <dd>{view.coverage.units === null ? "알 수 없음" : <><strong>{view.coverage.units}</strong>개</>}</dd>
        </div>
        <div className="tile">
          <dt>AI 가 푼 것</dt>
          <dd>{view.judge === null ? "판정자 꺼짐" : <><strong>{aiTotal}</strong>건</>}</dd>
        </div>
        <div className={gaps ? "tile tile-warn" : "tile"}>
          <dt>다 보지 못한 것</dt>
          <dd>{gaps ? "있음 · 아래 표" : "목록 비어 있음"}</dd>
        </div>
      </dl>

      <CoverageWarning summary={coverage} />
      {view.packMatches === false && (
        <p className="notice notice-warn">
          이 결과를 만든 팩과 이 사이트에 실린 팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다.
        </p>
      )}

      {view.findingCount === 0 ? (
        <p className="notice">{SITE.zeroIsNotClearance}</p>
      ) : (
        <p className="notice">사람이 확인할 발견이 {view.findingCount}건 있습니다. 검토가 필요한 지점이고, 판단은 사람이 합니다.</p>
      )}

      <div className="dash-grid">
        <aside className="dash-side" aria-labelledby="overview-title">
          <h2 id="overview-title">정책별 요약</h2>
          <ol className="ov-list">
            {view.policies.map((policy) => (
              <li key={policy.id} className="ov-item">
                <a href={`#${policyCardId(policy.id)}`} className="ov-title">
                  {policy.title}
                </a>
                <span className="ov-law">
                  {policy.inPack ? (
                    <Link href={policyHref(policy.id)} prefetch={false}>
                      {policy.law}
                    </Link>
                  ) : (
                    policy.law
                  )}
                </span>
                <span className="ov-state">
                  <StatusChip status={policy.status} />
                  {policy.locations.length > 0 && <span className="count">발견 {policy.locations.length}건</span>}
                </span>
              </li>
            ))}
          </ol>
          <p className="hint">조문 이름을 누르면 조문 도감에서 원문을 봅니다.</p>
        </aside>

        <div className="dash-main">
          {view.findingCount === 0 && <EmptyReport view={view} />}
          <h2 className="dash-h">정책</h2>
          <div className="policies">
            {loud.map((policy) => {
              const statute = policy.locations.length > 0 ? statutes[policy.id] : undefined;
              return (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  code={code}
                  service
                  statute={statute && <StatuteFold statute={statute} />}
                />
              );
            })}
          </div>
          {quiet.length > 0 && <QuietPolicies policies={quiet} />}

          <h2 className="dash-h">AI 가 푼 것</h2>
          {view.judge === null ? (
            <p className="hint">이 결과는 판정자 없이 만들어져 AI 가 푼 경고도, AI 의 답으로 빠진 판정도 없습니다.</p>
          ) : aiTotal === 0 ? (
            <p className="hint">AI 가 푼 경고와 AI 의 답으로 빠진 판정이 결과에 없습니다.</p>
          ) : (
            <AiDecisions view={view} />
          )}

          <h2 className="dash-h">검사 범위</h2>
          <Coverage view={view} summary={coverage} />
        </div>
      </div>

      <p className="disclaimer">{SITE.disclaimer}</p>
    </section>
  );
}
