import Link from "next/link";
import { Icon } from "@/components/Icon";
import { keepArticle } from "@/components/text";
import { policyCardId } from "@/lib/pack/href";
import { scopeLabel } from "@/lib/report/scope";
import { AI_CLEARED, AI_DISMISSED } from "@/lib/report/record";
import { STATUS_LABEL } from "@/lib/report/status";
import type { LocationView, PolicyView, ReportView } from "@/lib/report/view-model";
import { analysisHref, shortCommit } from "@/lib/service/href";
import { duration, finishedAt, formatKst } from "@/lib/service/steps";
import type { Analysis, Repository } from "@/lib/service/types";
import { SITE } from "@/lib/site";
import { AnalysisBadge, findingCount } from "./parts";

/** 최신 분석 상자에 보이는 발견 줄의 수. 나머지는 "결과 보기"의 분석 쪽에 있다. */
export const LATEST_FINDINGS = 5;

/**
 * 저장소 쪽의 "최신 분석" 상자(docs/redesign.md 3장 "저장소", 목업 repo). 가장 나중에 끝난 분석 하나를, 이미 저장된 CLI 결과를
 * 결과 화면과 같은 파서·화면 구조(`view`)로 읽어 요약한다. 새로 꾸미는 정보는 없다.
 *
 * - 머리 줄: 배지, 분석 id, 커밋, 요청 시각(KST), 걸린 시간(단계의 시각에서만), 사람이 볼 곳 N건, 결과 보기. 판정자를 켠
 *   분석이면 AI 가 푼 경고 수(`run.ai_cleared`)와 적용 질문으로 빠진 판정 수(`run.ai_dismissed`. 목록이 없으면 알 수 없음)를
 *   더한다.
 * - 본문: 발견이 있는 정책마다 제목·대표 조문·상태 칩, 그 아래 발견 줄(첫 미확인 대안의 메시지 그대로, `경로:줄`, 판정 범위).
 *   발견 줄은 모두 합해 `LATEST_FINDINGS` 개까지다. 발견이 0이면 0의 뜻을 둔다.
 * - 결과를 읽지 못했으면(`view` 가 null) 발견 수를 모른다고 적고 0 이라고 하지 않는다.
 */
export function LatestAnalysis({ repository, analysis, view }: { repository: Repository; analysis: Analysis; view: ReportView | null }) {
  const href = analysisHref(repository.owner, repository.name, analysis.id);
  const started = analysis.steps[0]?.startedAt ?? null;
  const ended = finishedAt(analysis);
  const policies = view ? view.policies.filter((policy) => policy.locations.length > 0) : [];
  // 정책 차례로 발견 줄을 나눠 준다(모두 합해 LATEST_FINDINGS 개까지).
  const before = policies.map((_, i) => policies.slice(0, i).reduce((sum, policy) => sum + policy.locations.length, 0));
  return (
    <section className="box latest" aria-labelledby="latest-title">
      <div className="box-hd latest-hd">
        <h2 id="latest-title">최신 분석</h2>
        <AnalysisBadge status={analysis.status} />
        <span className="latest-facts">
          <code translate="no">{analysis.id}</code>
          <span className="nw">
            <Icon name="commit" />
            <span className="visually-hidden">커밋 </span>
            <code translate="no">{shortCommit(analysis.commit)}</code>
          </span>
          <span className="nw">
            <time dateTime={analysis.requestedAt}>{formatKst(analysis.requestedAt)}</time> KST
          </span>
          {started && ended && (
            <span className="nw">
              걸린 시간 <span className="v">{duration(started, ended)}</span>
            </span>
          )}
          {view ? (
            <span className="nw">
              사람이 볼 곳 <span className="v">{view.findingCount}건</span>
            </span>
          ) : (
            <span className="nw">{findingCount(null)}</span>
          )}
          {view?.judge && (
            <>
              <span className="nw">
                {AI_CLEARED} <span className="v">{view.aiCleared.length}건</span>
              </span>
              {/* 적용 질문으로 빠진 판정도 숨기지 않는다(docs/commitments.md). 결과에 그 목록이 없으면 수를 모른다고 적는다. */}
              <span className="nw">
                {AI_DISMISSED}{" "}
                <span className="v">{view.aiDismissedKnown ? `${view.aiDismissed.length}건` : STATUS_LABEL["pack-unknown"]}</span>
              </span>
            </>
          )}
        </span>
        <Link href={href} className="box-end">
          결과 보기
        </Link>
      </div>
      {!view ? (
        <p className="box-in notice notice-warn">이 분석의 결과를 읽지 못했습니다.</p>
      ) : view.findingCount === 0 ? (
        <p className="box-in zero-note">{SITE.zeroIsNotClearance}</p>
      ) : (
        <ul className="latest-rows">
          {policies.map((policy, i) => {
            const shown = policy.locations.slice(0, Math.max(0, LATEST_FINDINGS - before[i]));
            return (
              <li key={policy.id} className="latest-policy">
                <PolicyLine policy={policy} />
                {shown.length > 0 && (
                  <ul>
                    {shown.map((location) => (
                      <li key={`${location.rule}:${location.fingerprint}`}>
                        <FindingLine location={location} href={`${href}#${policyCardId(policy.id)}`} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** 정책 줄: 제목, 대표 조문, 상태 칩. 칩에는 title 을 달지 않는다(뜻은 조문 도감과 분석 쪽에 있다). */
function PolicyLine({ policy }: { policy: PolicyView }) {
  return (
    <div className="latest-pol">
      <span className="latest-pol-t">
        {policy.title}
        {policy.law && <span className="latest-law">{keepArticle(policy.law)}</span>}
      </span>
      <span className={`chip chip-${policy.status}`}>{STATUS_LABEL[policy.status]}</span>
    </div>
  );
}

/**
 * 발견 줄: 첫 미확인 대안의 메시지(CLI 가 낸 그대로. 값이 '모름'이면 앞에 이름표), 없으면 규칙 id. 둘째 줄은 `경로:줄` 과
 * 판정 범위(`scopeLabel` 글 그대로). 줄 전체가 분석 쪽의 그 정책으로 가는 링크다.
 */
function FindingLine({ location, href }: { location: LocationView; href: string }) {
  const first = location.finding.unsatisfied_alternatives[0];
  const where = location.line === null ? location.file : `${location.file}:${location.line}`;
  return (
    <Link href={href} className="latest-fd">
      <span className="latest-msg">
        {first?.value === "unknown" && <span className="unk">모름</span>}
        {first?.message ?? <code translate="no">{location.rule}</code>}
      </span>
      <span className="latest-loc">
        <code translate="no">{where}</code>
        <span>{scopeLabel(location.scope)}</span>
      </span>
      <Icon name="chevron-right" />
    </Link>
  );
}
