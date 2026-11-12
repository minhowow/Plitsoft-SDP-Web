import { Icon } from "@/components/Icon";
import type { CodeSource } from "@/components/result/PolicyCard";
import { SANCTION, Tier } from "@/components/result/Tiers";
import { keepParticles } from "@/components/text";
import { REVIEW_STATUSES, type Review, type ReviewItem, type ReviewStatus } from "@/lib/review";
import { layoutFlow } from "@/lib/review/flow";
import { REVIEW_RECHECK_LABEL, REVIEW_STATUS_LABEL } from "@/lib/report/status";
import { CitedLines, FlowFigure } from "./FlowFigure";

/**
 * review 결과(policypack review 2판)의 화면(2026-11-11 오너 지시). 위에서부터:
 *
 * 1. 이 저장소가 하는 일: 서비스 설명(AI 가 쓴 두세 문장, 결과에 실린 그대로), 플랫폼, 감지된 기능(AI 가 인용과 함께 더한 것과
 *    뺀 것을 밝힌다).
 * 2. 개인정보 흐름 그림: 받는 것 → 처리 → 저장·외부로 보냄. 마디를 누르면 인용한 줄. 외부로 나가는 화살표는 눈에 띄게.
 * 3. 의무 체크리스트: "코드에서 본 것"의 맨 위 다섯 건(결과의 요약이 고른 것)을 먼저 펼쳐 두고, 나머지 갈래는 접는다. 의무 한 건은
 *    조문, 무엇을 봤는지 한 문장, 인용한 줄, 질문 하나. "해당 없음"은 찾아본 말과 다시 센 건수를 펼치면 보인다.
 * 4. 검증 정보: 관문이 거절한 인용, 건수가 맞지 않은 검색, 반박이 뒤집은 수, 가린 비밀값, 모델, 비용 어림과 시간.
 *
 * 인용은 관문을 통과한 것(`ok`)만 보인다. 의무 한 줄에 처분의 말이 들면 그 줄은 싣지 않는다(docs/commitments.md 1장).
 *
 * `recheck` 는 사람이 답을 읽고 말이 안 된다고 짚은 의무(사례 쪽, 2026-11-12 오너 결정)다. 그 상태는 보이지 않고 갈래 수에서도
 * 빼며, 맨 아래 "다시 검토 중 N건"에 의무 이름만 접어 둔다.
 */
export function ReviewView({ review, code = null, recheck = [] }: { review: Review; code?: CodeSource | null; recheck?: readonly string[] }) {
  const held = review.checklist.filter((item) => recheck.includes(item.duty));
  const items = review.checklist.filter((item) => !recheck.includes(item.duty));
  const count = (status: ReviewStatus) => items.filter((item) => item.status === status).length;
  const check = count("seen-in-code") + count("check-outside") + count("check-applicability");
  return (
    <div className="tiers review">
      {/* 맨 위 한 문장 요약: 감지된 기능 · 걸릴 수 있는 의무 · 확인할 것(세 갈래를 합친 수). 개수만 센다. */}
      <p className="overview">
        <span>
          감지된 기능 <b>{review.profile.features.filter((feature) => feature.removed === null).length}가지</b>
        </span>{" "}
        <span>
          걸릴 수 있는 의무 <b>{review.obligations.listed}개</b>
        </span>{" "}
        <span>
          확인할 것 <b>{check}건</b>
        </span>
      </p>
      <ServiceTier review={review} code={code} />
      <Tier n={2} name="개인정보 흐름">
        {review.flow.nodes.length === 0 ? (
          <p className="tier-none">없음</p>
        ) : (
          <FlowFigure layout={layoutFlow(review.flow.nodes, review.flow.edges)} nodes={review.flow.nodes} edges={review.flow.edges} code={code} />
        )}
      </Tier>
      <Tier n={3} name="의무 체크리스트">
        <Checklist review={review} items={items} held={held} code={code} />
        <Verification review={review} />
      </Tier>
    </div>
  );
}

/** 1단: 서비스 설명, 플랫폼, 감지된 기능(AI 가 뺀 기능은 접어 둔다). */
function ServiceTier({ review, code }: { review: Review; code: CodeSource | null }) {
  const kept = review.profile.features.filter((feature) => feature.removed === null);
  const removed = review.profile.features.filter((feature) => feature.removed !== null);
  const PLATFORM: Record<string, string> = { web: "웹", mobile: "모바일 앱", server: "서버" };
  return (
    <Tier n={1} name="이 저장소가 하는 일">
      {review.profile.summary && <p className="rv-summary">{keepParticles(review.profile.summary)}</p>}
      {review.profile.platforms.length > 0 && (
        <p className="hint tier-note">플랫폼: {review.profile.platforms.map((p) => PLATFORM[p] ?? p).join(" · ")}</p>
      )}
      {kept.length > 0 && (
        <ul className="rv-features">
          {kept.map((feature) => (
            <li key={feature.id}>
              {feature.name}
              {!feature.sources.includes("signal") && feature.sources.includes("model") && <span className="tag">AI 가 더함</span>}
            </li>
          ))}
        </ul>
      )}
      {removed.length > 0 && (
        <details className="ob ob-test">
          <summary>
            AI 가 뺀 기능 <span className="ob-n">{removed.length}가지</span>
          </summary>
          <ul className="features ft-test">
            {removed.map((feature) => (
              <li key={feature.id}>
                <span className="ft-name">{feature.name}</span>
                <div>
                  <p className="rv-seen">{feature.removed!.reason}</p>
                  <CitedLines citations={feature.removed!.citations.filter((c) => c.ok)} code={code} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Tier>
  );
}

/** 글의 첫 문장(마침표·물음표 다음 빈칸까지). 나머지가 있으면 함께 돌려준다. 글을 고치지 않는다. */
function firstSentence(text: string): [string, string] {
  const match = /^(.+?[.?!])\s+(\S[\s\S]*)$/.exec(text.trim());
  return match ? [match[1], match[2]] : [text.trim(), ""];
}

/** 체크리스트의 의무 한 건. */
function Item({ item, code }: { item: ReviewItem; code: CodeSource | null }) {
  const [seen, rest] = firstSentence(item.reason);
  const cites = item.citations.filter((cite) => cite.ok);
  return (
    <li className="rv-item">
      <p className="rv-law">
        <span>
          {item.law} {item.article}
        </span>
        {item.url && (
          <a className="ob-ext" href={item.url} target="_blank" rel="noopener noreferrer">
            법제처
            <Icon name="external" />
            <span className="visually-hidden">
              (새 창, {item.law} {item.article})
            </span>
          </a>
        )}
        {item.verification === "overturned" && <span className="tag">반박이 바꿈</span>}
      </p>
      {item.dutyText && !SANCTION.test(item.dutyText) && <p className="rv-duty">{keepParticles(item.dutyText)}</p>}
      {seen && <p className="rv-seen">{keepParticles(seen)}</p>}
      <CitedLines citations={cites} code={code} />
      {item.question && (
        <p className="ask-line">
          <span className="lbl">질문</span> {item.question}
        </p>
      )}
      {item.notAnswered && <p className="hint">{item.notAnswered}</p>}
      {item.searches.length > 0 && (
        <details className="f-more">
          <summary>찾아본 말 {item.searches.length}개</summary>
          <ul className="rv-searches">
            {item.searches.map((search, i) => (
              <li key={i}>
                <code translate="no">{search.pattern}</code> <span className="hint">({search.path || "."})</span> 다시 센 줄{" "}
                {search.found === null ? "모름" : `${search.found}줄`}
                {search.claimed !== null && search.claimed !== search.found && (
                  <span className="hint"> · AI 가 적은 수 {search.claimed}줄</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {rest && (
        <details className="f-more">
          <summary>자세히</summary>
          <p className="rv-rest">{keepParticles(rest)}</p>
        </details>
      )}
    </li>
  );
}

/** 다시 검토 중인 의무 한 건: 조문과 의무 한 줄만(상태·까닭·인용은 싣지 않는다). */
function HeldItem({ item }: { item: ReviewItem }) {
  return (
    <li className="rv-item">
      <p className="rv-law">
        <span>
          {item.law} {item.article}
        </span>
        {item.url && (
          <a className="ob-ext" href={item.url} target="_blank" rel="noopener noreferrer">
            법제처
            <Icon name="external" />
            <span className="visually-hidden">
              (새 창, {item.law} {item.article})
            </span>
          </a>
        )}
      </p>
      {item.dutyText && !SANCTION.test(item.dutyText) && <p className="rv-duty">{keepParticles(item.dutyText)}</p>}
    </li>
  );
}

/** 의무 체크리스트: 코드에서 본 것의 맨 위 다섯 건을 먼저, 나머지 갈래는 접는다. 차례는 결과에 실린 그대로(이미 갈래 순)다. */
function Checklist({ review, items, held, code }: { review: Review; items: ReviewItem[]; held: ReviewItem[]; code: CodeSource | null }) {
  const by = (status: ReviewStatus) => items.filter((item) => item.status === status);
  const seen = by("seen-in-code");
  const top = review.summary.top.flatMap((duty) => seen.filter((item) => item.duty === duty));
  const others = seen.filter((item) => !top.includes(item));
  const lead = top.length > 0 ? top : seen.slice(0, 5);
  const restSeen = top.length > 0 ? others : seen.slice(5);
  return (
    <div className="rv-check">
      <section className="ck ck-check">
        <h3 className="ck-hd ck-hd-check">
          {REVIEW_STATUS_LABEL["seen-in-code"]} <span className="ck-n">{seen.length}건</span>
        </h3>
        {lead.length > 0 ? (
          <ol className="rv-items">
            {lead.map((item) => (
              <Item key={item.duty} item={item} code={code} />
            ))}
          </ol>
        ) : (
          <p className="tier-none rv-none">없음</p>
        )}
        {restSeen.length > 0 && (
          <details className="more">
            <summary>나머지 {restSeen.length}건</summary>
            <ol className="rv-items">
              {restSeen.map((item) => (
                <Item key={item.duty} item={item} code={code} />
              ))}
            </ol>
          </details>
        )}
      </section>
      {REVIEW_STATUSES.filter((status) => status !== "seen-in-code").map((status) => {
        const items = by(status);
        if (items.length === 0) return null;
        return (
          <details key={status} className={`rv-group rv-${status}`}>
            <summary>
              {REVIEW_STATUS_LABEL[status]} <span className="ck-n">{items.length}건</span>
            </summary>
            <ol className="rv-items">
              {items.map((item) => (
                <Item key={item.duty} item={item} code={code} />
              ))}
            </ol>
          </details>
        );
      })}
      {held.length > 0 && (
        <details className="rv-group rv-recheck">
          <summary>
            {REVIEW_RECHECK_LABEL} <span className="ck-n">{held.length}건</span>
          </summary>
          <p className="hint">CLI 를 고친 다음 판에서 다시 돌립니다.</p>
          <ol className="rv-items">
            {held.map((item) => (
              <HeldItem key={item.duty} item={item} />
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

/** 검증 정보: 결과에 실린 수 그대로. */
function Verification({ review }: { review: Review }) {
  const { run } = review;
  const sum = (record: Record<string, number>) => Object.values(record).reduce((a, b) => a + b, 0);
  const overturned = run.verificationCounts.overturned ?? 0;
  const upheld = run.verificationCounts.upheld ?? 0;
  const refusedOverturn = run.verificationCounts["overturn-ungrounded"] ?? 0;
  const notAsked = sum(run.notAsked);
  return (
    <section className="box info rv-verify" aria-labelledby="rv-verify-title">
      <div className="box-hd">
        <h3 id="rv-verify-title">검증 정보</h3>
      </div>
      <dl className="report-meta">
        <div>
          <dt>인용</dt>
          <dd>
            {run.citations}개 · 검사기가 거절 {run.citationsRejected}개
          </dd>
        </div>
        <div>
          <dt>부재 검색</dt>
          <dd>
            {run.searches}개 · 건수가 맞지 않음 {run.searchesRejected}개
          </dd>
        </div>
        <div>
          <dt>반박</dt>
          <dd>
            유지 {upheld} · 뒤집음 {overturned}
            {refusedOverturn > 0 && ` · 근거 없는 뒤집기 거절 ${refusedOverturn}`}
          </dd>
        </div>
        <div>
          <dt>가린 비밀값</dt>
          <dd>{sum(run.masked)}개</dd>
        </div>
        {notAsked > 0 && (
          <div>
            <dt>묻지 않은 의무</dt>
            <dd>{notAsked}개</dd>
          </div>
        )}
        <div>
          <dt>모델</dt>
          <dd>
            조사 <code translate="no">{run.models.investigate}</code> · 반박 <code translate="no">{run.models.verify}</code>
          </dd>
        </div>
        <div>
          <dt>비용 어림</dt>
          <dd>
            ${run.usdEstimate.toFixed(2)}
            {run.limits && ` (상한 $${run.limits.usd})`}
          </dd>
        </div>
        <div>
          <dt>시간</dt>
          <dd>
            {Math.round(run.seconds)}초{run.limits && ` (상한 ${Math.round(run.limits.seconds)}초)`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
