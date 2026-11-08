import Link from "next/link";
import type { ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { policyCardId, policyHref } from "@/lib/pack/href";
import { coverageSummary } from "@/lib/report/coverage";
import { examinedFacts, UNIT_GLOSS } from "@/lib/report/examined";
import { AI_CLEARED, AI_DISMISSED } from "@/lib/report/record";
import { STATUS_LABEL, STATUS_ORDER, type Status } from "@/lib/report/status";
import { aiReviewRan, CONTRACT_LABEL, type PolicyView, type ReportView, type ReviewItem } from "@/lib/report/view-model";
import { SITE } from "@/lib/site";
import { Citation } from "./Citation";
import { CoverageWarning, NotSeen } from "./Coverage";
import { isBoxed, PolicyCard, type CodeSource } from "./PolicyCard";
import { RuleId } from "./RuleId";
import { Where } from "./Where";

/**
 * 결과 한 건의 화면. 분석 쪽(`/r/…/a/[id]`), 결과 파일 열기(`/view`), 데모가 모두 이 부품을 같은 차례로 쓴다(docs/redesign.md
 * 3장). 위에서부터:
 *
 * 1. 다 보지 못한 검사라는 경고와 그 목록(있을 때만). 아래의 발견과 "발견 없음"을 읽기 전에 알아야 한다.
 * 2. 팩 판이 다르다는 알림(그럴 때만).
 * 3. 요약 한 줄: 숫자인 사실만(사람이 볼 곳, 검사한 파일, AI 검토가 돌았으면 AI 가 푼 경고).
 * 4. 판정자를 켜 보라는 권고와 외부 API 고지(`recommend` 일 때, 판정자가 꺼진 결과에만. 쪽마다 한 번).
 * 5. 본문(정책 상자, AI 가 푼 경고, 적용 질문으로 빠진 판정)과 곁칸(`정책 N`). 데모는 곁칸을 그리지 않는다(`policyList`).
 *    발견이 0이면 본문 맨 위에 0의 뜻(굵게)과 검사한 것을 두고, 맨 아래에 검사에 들지 않는 파일과 정보를 펼쳐 둔다.
 * 6. 검사 정보(쪽 폭 전체): 도구, 팩 판, 엔진, AI 줄, 판정 단위, 출력 형식, 다 보지 못한 파일이 없다는 것, 진행 기록(분석 쪽).
 */

/** 근거 조문 하나: 팩 메타데이터의 대표 조문 이름과 원문(`legal[].text`) 그대로. 분석 쪽만 서버에서 넘긴다. */
export interface Statute {
  label: string;
  text: string;
}

/** 판정자를 켜 보라는 권고(쪽마다 한 번). 외부 API 로 나간다는 사실을 함께 적는다(docs/commitments.md 의 "CLI 가 이미 약속한 것"). */
export const JUDGE_ADVICE =
  "판정자가 꺼져 있었습니다. 로컬에서 판정자를 켜고 다시 검사하면 AI 에게 묻는 조건도 판정에 넣을 수 있습니다. 판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.";

/** AI 가 푼 경고 상자의 사람 확인 문장. */
export const CLEARED_NOTE =
  "AI 판정자가 ‘예’라고 답하고 코드 줄을 인용해서 경고가 풀렸습니다. 인용이 코드에 있는지만 확인된 것입니다. 그 줄이 이 규칙의 근거가 맞는지는 사람이 봐야 합니다.";

/** 적용 질문으로 빠진 판정 상자의 문장. */
export const DISMISSED_NOTE = "적용 여부를 묻는 질문에 AI 가 ‘아니오’라고 답했습니다. 인용 없이 빠진 판정입니다.";

/** AI 의 답으로 풀리거나 빠진 판정 하나: 위치와 정책, 규칙·대안 id, 인용한 줄(또는 묻는 말과 답). */
function ReviewRow({ item }: { item: ReviewItem }) {
  return (
    <li className="ai-row">
      <p className="ai-at">
        <Where file={item.file} line={item.line} />{" "}
        <code className="ai-policy" translate="no">
          {item.policy}
        </code>
      </p>
      <p className="ids">
        <span>
          규칙 <RuleId policy={item.policy} rule={item.rule} inPack={item.ruleInPack} />
        </span>
      </p>
      {/* 대안의 id 는 인용마다 그 앞에 적는다(어느 인용이 어느 대안을 받치는지). 인용이 없는 대안은 아래 "인용 없음"에 적는다. */}
      <Citation quotes={item.quotes} />
      {item.uncited.length > 0 && (
        <p className="hint">
          인용 없음:{" "}
          {item.uncited.map((id, i) => (
            <span key={`${id}:${i}`}>
              {i > 0 && ", "}
              <code translate="no">{id}</code>
            </span>
          ))}
        </p>
      )}
      {item.question && <p className="ask">질문: {item.question}</p>}
      {item.answer && <p className="ask">답: {item.answer}</p>}
    </li>
  );
}

/**
 * AI 가 푼 경고와 적용 질문으로 빠진 판정. CLI 가 사람이 검토하라고 남긴 것이라 숨기지 않고 펼쳐 둔다. 어떤 기록에서 왔는지
 * 모르는 줄의 목록(`ReviewItem`)을 받는다.
 */
export function AiDecisions({ cleared, dismissed }: { cleared: ReviewItem[]; dismissed: ReviewItem[] }) {
  if (cleared.length === 0 && dismissed.length === 0) return null;
  return (
    <div className="ai-decisions">
      {cleared.length > 0 && (
        <details className="box ai-box" open>
          <summary>AI 가 푼 경고 {cleared.length}건</summary>
          <p className="ai-note">{CLEARED_NOTE}</p>
          <ul className="ai-rows">
            {cleared.map((item, i) => (
              <ReviewRow key={i} item={item} />
            ))}
          </ul>
        </details>
      )}
      {dismissed.length > 0 && (
        <details className="box ai-box" open>
          <summary>AI 가 적용되지 않는다고 답해 빠진 판정 {dismissed.length}건</summary>
          <p className="ai-note">{DISMISSED_NOTE}</p>
          <ul className="ai-rows">
            {dismissed.map((item, i) => (
              <ReviewRow key={i} item={item} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * 검사한 것. 발견이 0인 결과에만 0의 뜻 바로 아래에 둔다. 발견이 없다는 것만으로는 무엇을 봤는지 알 수 없으므로, 결과에 실린
 * 수(파일, 판정 단위, 검사하지 않은 파일, 정책)와 그 수가 무엇이고 무엇이 아닌지를 적는다.
 */
export function EmptyReport({ view, policyList }: { view: ReportView; policyList?: string }) {
  return (
    <div className="empty-report">
      <section className="box">
        <div className="box-hd">
          <h2>검사한 것</h2>
        </div>
        <dl className="examined">
          {examinedFacts(view, policyList).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className={fact.warn ? "warn" : undefined}>
                <strong>{fact.value}.</strong> <span className="fact-note">{keepParticles(fact.note)}</span>
              </dd>
            </div>
          ))}
        </dl>
        <p className="box-ft">{keepParticles(UNIT_GLOSS)}</p>
      </section>
    </div>
  );
}

/** 검사에 들지 않는 파일과 정보. 발견이 0인 결과의 본문 맨 아래에 펼친 채로 둔다. */
function NotSeenBox({ view }: { view: ReportView }) {
  return (
    <section className="box not-seen-box" aria-labelledby="not-seen-title">
      <div className="box-hd">
        <h2 id="not-seen-title">{SITE.notSeen.title}</h2>
      </div>
      <NotSeen view={view} />
    </section>
  );
}

/**
 * 요약 한 줄: 숫자인 사실만. 점수·등급·비율이 아니다. AI 검토가 돌았으면 AI 가 푼 경고와 적용 질문으로 빠진 판정의 수를 함께
 * 적는다(docs/redesign.md 4장 "AI 가 푼 것"). 빠진 판정이 결과에 실려 있지 않으면 그 수는 "알 수 없음"이다(저장소 쪽 최신 분석과 같다).
 */
function SummaryLine({ view }: { view: ReportView }) {
  const files = view.coverage.files;
  return (
    <p className="sumline">
      <span>
        <span className="lbl">사람이 볼 곳</span> <b>{view.findingCount}건</b>
      </span>{" "}
      <span>
        <span className="lbl">검사한 파일</span> <b>{files === null ? STATUS_LABEL["pack-unknown"] : `${files}개`}</b>
      </span>
      {aiReviewRan(view) && (
        <>
          {" "}
          <span>
            <span className="lbl">{AI_CLEARED}</span> <b>{view.cleared.length}건</b>
          </span>{" "}
          <span>
            <span className="lbl">{AI_DISMISSED}</span>{" "}
            <b>{view.aiDismissedKnown ? `${view.dismissed.length}건` : STATUS_LABEL["pack-unknown"]}</b>
          </span>
        </>
      )}
    </p>
  );
}

/** 곁칸의 묶음 차례. 발견이 없는 정책의 상태다. */
const QUIET_ORDER: Status[] = STATUS_ORDER.filter((status) => !["needs-review", "needs-review-ai-pending", "uncertain"].includes(status));

/** 정책 이름. 조문 도감에 있는 정책이면 그 쪽으로 잇는다. */
function PolicyName({ policy }: { policy: PolicyView }) {
  return policy.inPack ? (
    <Link href={policyHref(policy.id)} prefetch={false}>
      {policy.title}
    </Link>
  ) : (
    <>{policy.title}</>
  );
}

/**
 * 곁칸 `정책 N`. N 은 이 결과의 정책 수다(데이터에서 센다).
 *
 * - 상자로 그린 정책(발견이나 충족 근거 위치가 있다): 상태 점, 상자로 가는 제목, 발견 수.
 * - AI 가 푼 경고만 있는 정책: `발견 없음, AI 가 푼 경고 N건`. 아래 `발견 없음` 묶음에 넣지 않는다.
 * - 나머지: 상태별 묶음(`발견 없음 N`). 그 아래에 0의 뜻 한 줄.
 * - 맨 아래에 `상태의 뜻`(조문 도감).
 */
function SidePolicies({ view }: { view: ReportView }) {
  const boxed = view.policies.filter(isBoxed);
  const clearedOnly = view.policies.filter((policy) => !isBoxed(policy) && policy.aiCleared > 0);
  const quiet = view.policies.filter((policy) => !isBoxed(policy) && policy.aiCleared === 0);
  const groups = QUIET_ORDER.map((status) => ({ status, list: quiet.filter((policy) => policy.status === status) })).filter(
    (group) => group.list.length > 0,
  );
  return (
    // 좁은 화면(한 단)에서는 머리를 눌러 접을 수 있다. 두 단에서는 늘 펼친 채로 보인다(CSS, 목업 side-pol). 이름은 머리(summary)의
    // h2 가 준다.
    <details className="box side-pol" open>
      <summary className="box-hd">
        <h2 id="side-title">
          정책 <span className="count">{view.policies.length}</span>
        </h2>
      </summary>
      {(boxed.length > 0 || clearedOnly.length > 0) && (
        <ul className="side-found">
          {boxed.map((policy) => (
            <li key={policy.id} className="p">
              <span className={`dot dot-${policy.status}`} aria-hidden="true" />
              <a href={`#${policyCardId(policy.id)}`}>{policy.title}</a>
              <span className="visually-hidden">{STATUS_LABEL[policy.status]}</span>
              {policy.locations.length > 0 && <span className="n">{policy.locations.length}건</span>}
            </li>
          ))}
          {clearedOnly.map((policy) => (
            <li key={policy.id} className="p">
              <span className={`dot dot-${policy.status}`} aria-hidden="true" />
              <span className="p-t">
                <PolicyName policy={policy} />
                <span className="ai">
                  {STATUS_LABEL[policy.status]}, AI 가 푼 경고 {policy.aiCleared}건
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {/* 0의 뜻은 `발견 없음` 같은 0의 상태가 곁칸에 하나라도 보이면 둔다(AI 가 푼 경고만 있는 정책의 `발견 없음` 도 그렇다). */}
      {(groups.length > 0 || clearedOnly.length > 0) && (
        <div className="side-quiet">
          {groups.map(({ status, list }) => (
            <div key={status} className="side-group">
              <p className="lbl">
                {STATUS_LABEL[status]} {list.length}
              </p>
              <ul>
                {list.map((policy) => (
                  <li key={policy.id}>
                    <PolicyName policy={policy} />
                    {policy.units !== null && <span className="u">판정 단위 {policy.units}개</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <p className="z">{SITE.zeroIsNotClearance}</p>
        </div>
      )}
      <p className="box-ft">
        <Link href="/policy/#status" prefetch={false}>
          상태의 뜻
        </Link>
      </p>
    </details>
  );
}

/**
 * 검사 정보(쪽 아래, 폭 전체). 결과에 실린 값 그대로다. AI 줄은 화면 구조가 만든 이름표·값의 목록(`aiRows`)을 줄마다 그린다.
 * `progress` 는 분석 쪽이 넘기는 진행 기록(접어 둔다). 발견이 있는 결과에는 검사에 들지 않는 파일과 정보로 가는 링크를 둔다
 * (발견이 0이면 본문에 펼쳐 둔다).
 */
function ScanInfo({ view, gaps, progress }: { view: ReportView; gaps: boolean; progress?: ReactNode }) {
  return (
    <section className="box info" aria-labelledby="info-title">
      <div className="box-hd">
        <h2 id="info-title">검사 정보</h2>
      </div>
      <div className="rows">
        <dl className="report-meta">
          <div>
            <dt>도구</dt>
            <dd>{view.tool}</dd>
          </div>
          <div>
            <dt>팩 판</dt>
            <dd>
              <code translate="no">{view.packDigest}</code>
            </dd>
          </div>
          <div>
            <dt>엔진</dt>
            <dd>{view.engine ?? "실행 안 함"}</dd>
          </div>
          {view.aiRows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
          <div>
            <dt>판정 단위</dt>
            <dd>{view.coverage.units === null ? STATUS_LABEL["pack-unknown"] : `${view.coverage.units}개`}</dd>
          </div>
          <div>
            <dt>출력 형식</dt>
            <dd>{CONTRACT_LABEL[view.contract]}</dd>
          </div>
          {/* 든 것이 있으면 맨 위 경고가 목록을 보인다. 없을 때만 없다고 적는다(끝까지 봤다고는 적지 않는다). */}
          {!gaps && (
            <div>
              <dt>결과에 실린 ‘다 보지 못한 파일’</dt>
              <dd>없음</dd>
            </div>
          )}
        </dl>
        {progress}
        {view.findingCount > 0 && (
          <p className="info-link">
            <Link href="/policy/#scope" prefetch={false}>
              {SITE.notSeen.title}
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * 결과 한 건의 전체 화면. `code` 는 GitHub 의 커밋 고정 링크(분석 쪽), `statutes` 는 정책 id → 근거 조문 원문(분석 쪽, 서버가
 * 팩 메타데이터에서 고른다), `recommend` 는 판정자를 켜 보라고 권할지(`/view`. 분석 서비스는 권하지 않는다), `progress` 는 검사
 * 정보 안의 진행 기록(분석 쪽).
 *
 * `policyList` 를 주면 곁칸 `정책 N` 을 그리지 않는다. 그 화면에서 정책 목록과 0의 뜻을 지닌 곳의 이름이다(데모의
 * `‘고치기 전과 고친 뒤’ 표`. docs/redesign.md 3장 "데모", D7). 발견이 0인 결과의 `검사한 것` 이 그 이름으로 가리킨다.
 */
export function ReportSummary({
  view,
  code = null,
  statutes = {},
  recommend = false,
  progress,
  policyList,
}: {
  view: ReportView;
  code?: CodeSource | null;
  statutes?: Record<string, Statute | undefined>;
  recommend?: boolean;
  progress?: ReactNode;
  policyList?: string;
}) {
  const coverage = coverageSummary(view);
  const gaps = coverage.rows.some((row) => row.count > 0);
  const boxed = view.policies.filter(isBoxed);
  const zero = view.findingCount === 0;
  return (
    <section className="report">
      <CoverageWarning summary={coverage} />

      {view.packMatches === false && (
        <p className="notice notice-warn">
          이 결과를 만든 팩과 이 사이트에 실린 팩의 판이 다릅니다. 정책 설명이 결과와 맞지 않을 수 있습니다.
          {/* "알 수 없음" 정책이 있을 때만 덧붙인다. v1 초안은 결과에 나온 정책만 그리므로 그런 정책이 없다. */}
          {view.policies.some((policy) => policy.status === "pack-unknown") &&
            " 발견이 없는 정책은 그 팩에 있었는지 알 수 없습니다."}
        </p>
      )}

      <SummaryLine view={view} />
      {coverage.lineNote && <p className="hint sum-note">{coverage.lineNote}</p>}
      {recommend && !aiReviewRan(view) && <p className="judge-advice">{JUDGE_ADVICE}</p>}

      <div className="cols">
        <div className="report-main">
          {zero && (
            <>
              <p className="zero-line">{SITE.zeroIsNotClearance}</p>
              <EmptyReport view={view} policyList={policyList} />
            </>
          )}
          {/* 상자가 없을 수 있다(발견도 충족 근거도 없는 결과). 빈 상자가 간격만 차지하지 않게 한다. */}
          {boxed.length > 0 && (
            <div className="policies">
              {boxed.map((policy) => {
                const statute = policy.locations.length > 0 ? statutes[policy.id] : undefined;
                return (
                  <PolicyCard
                    key={policy.id}
                    policy={policy}
                    code={code}
                    statute={
                      statute && (
                        // 조문 이름이 상자 머리의 조문 링크와 같으면 접힌 줄에 되풀이하지 않는다(docs/redesign.md 2.2 "한 사실은 한 번").
                        // 원문이 실린 조문이 머리의 조문과 다를 때만 그 이름을 적는다.
                        <details className="lg">
                          <summary>
                            근거 조문 원문
                            {statute.label !== policy.law && (
                              <>
                                {" "}
                                <span className="lg-name">{statute.label}</span>
                              </>
                            )}
                          </summary>
                          <div className="legal-text">{statute.text}</div>
                        </details>
                      )
                    }
                  />
                );
              })}
            </div>
          )}
          <AiDecisions cleared={view.cleared} dismissed={view.dismissed} />
          {zero && <NotSeenBox view={view} />}
        </div>
        {policyList === undefined && (
          <aside className="report-side">
            <SidePolicies view={view} />
          </aside>
        )}
      </div>

      <ScanInfo view={view} gaps={gaps} progress={progress} />
    </section>
  );
}
