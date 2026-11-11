import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { keepArticle } from "@/components/text";
import { policyCardId, policyHref } from "@/lib/pack/href";
import { reasonLabel } from "@/lib/report/reasons";
import { scopeLabel, scopeNote } from "@/lib/report/scope";
import { STATUS_LABEL } from "@/lib/report/status";
import { fileLink, shortCommit } from "@/lib/service/href";
import type { UnsatisfiedAlternative } from "@/lib/report/types";
import type { LocationView, PolicyView, RuleGroupView } from "@/lib/report/view-model";
import { RuleId } from "./RuleId";
import { StatusChip } from "./StatusChip";
import { Where } from "./Where";

/**
 * 정책 상자(docs/redesign.md 3장 "분석"). 발견이나 충족 근거 위치가 있는 정책만 상자로 그린다(나머지는 곁칸의 상태별 묶음).
 *
 * 머리: 조문(12px, 조문 도감 링크), 제목(16/600), 칩 하나. 그다음 정책의 질문(16px), 발견 줄. 맨 아래에 근거 조문 원문을 접어
 * 둔다(분석 쪽만. 서버가 팩 메타데이터에서 넘긴다).
 *
 * 발견 하나는 한 묶음이다(2026-11-11 오너 지시): 무엇이 보이지 않는지 한 문장(첫 미확인 대안의 메시지, CLI 가 낸 글 그대로),
 * `경로:줄`(분석 쪽은 GitHub 커밋 고정 링크)과 판정이 본 범위, 확인 질문 하나(첫 미확인 대안의 질문). 나머지 대안과 질문, 고치는
 * 법, 규칙·대안 id, 판정 경로(CLI 원문)는 그 아래 `자세히` 를 펼쳐야 보인다. 칩은 정책과 상태가 다를 때만 단다(같으면 화면
 * 낭독기에만 상태를 읽힌다). 규칙 이름도 화면 낭독기용으로 줄에 남는다.
 *
 * 같은 규칙이 여러 곳이면 묶음 머리에 메시지와 질문, `N곳` 을 두고(줄마다 되풀이하지 않는다), 대표 3곳 다음은 접는다. 접힌 곳에만
 * 있는 상태는 머리에 개수로 적는다.
 */

/**
 * 파일·줄을 GitHub 의 커밋 고정 링크로 보낼 때 쓰는 것(분석 서비스의 쪽만 준다). 저장소 주소(GitHub 이 돌려준 html_url)와
 * 검사한 커밋. 없으면 링크를 걸지 않는다(`/view` 에서 연 파일, 데모, 합성 저장소).
 */
export interface CodeSource {
  htmlUrl: string;
  commit: string;
}

/**
 * 대안 값이 '모름'일 때의 문장. 확인되지 않은 대안의 메시지가 "없다"로 읽히지 않게 한다. 펼친 안쪽에서 대안들 뒤에 한 번 적는다
 * (docs/redesign.md 3장 "펼친 안쪽"의 차례). 어느 대안인지는 메시지 앞의 `모름` 이름표가 가리킨다.
 */
export const UNKNOWN_ALTERNATIVE = "‘모름’ 이름표가 붙은 대안은 값이 ‘모름’입니다. 확인하지 못했을 뿐이고, 없다고 판정된 것은 아닙니다.";

/** 발견 줄의 첫 줄에 적는 대안: 결과에 실린 첫 미확인 대안. */
const firstAlternative = (location: LocationView): UnsatisfiedAlternative | undefined =>
  location.finding.unsatisfied_alternatives[0];

/** 발견 줄의 첫 줄(메시지). 값이 '모름'이면 앞에 이름표를 단다. 메시지가 없으면 규칙 id 를 적는다(지어내지 않는다). */
function Message({ location }: { location: LocationView }) {
  const first = firstAlternative(location);
  return (
    <span className="msg">
      {first?.value === "unknown" && <span className="unk">모름</span>}
      {first?.message ?? (
        <code className="rule-id" translate="no">
          {location.rule}
        </code>
      )}
    </span>
  );
}

/** AI 에게 묻지 않은 조건, 또는 판정에 넣지 못한 AI 조건. 늘 보인다(발견을 펼친 안쪽). */
function AiPending({ location }: { location: LocationView }) {
  const { finding } = location;
  if (finding.ai_pending.length === 0) return null;
  const conditions = (
    <code translate="no">{finding.ai_pending.join(", ")}</code>
  );
  // 판정자가 꺼져 있었으면 그 사실만 적는다. 켜 보라는 권고는 쪽마다 한 번만 한다(`/view`·데모. docs/redesign.md 2.3).
  if (finding.untested_reasons.includes("no-judge")) {
    return (
      <p className="pending">
        AI 에게 묻지 않은 조건: {conditions}. 판정자 없이 만든 결과입니다.
      </p>
    );
  }
  return (
    <p className="pending">
      판정에 넣지 못한 AI 조건: {conditions}. 판정자가 답하지 못했거나 답을 쓸 수 없었습니다.
    </p>
  );
}

/** 발견 줄의 확인 질문: 첫 미확인 대안의 질문(CLI 가 낸 글 그대로). 없으면 null. */
const questionOf = (location: LocationView): string | null => firstAlternative(location)?.ask_developer ?? null;

/** 발견 줄의 메시지 글(묶음 머리와 견줄 때 쓴다). */
const messageOf = (location: LocationView) => firstAlternative(location)?.message ?? null;

/**
 * 확인되지 않은 대안 하나(`자세히` 안). 첫 대안의 메시지와 질문은 발견 줄(또는 묶음 머리)이 이미 적었으므로 되풀이하지 않는다.
 * 질문은 늘 적고(없으면 없다고), 고치는 법은 실려 있을 때만 적는다.
 */
function Alternative({ alt, first }: { alt: UnsatisfiedAlternative; first: boolean }) {
  const unknown = alt.value === "unknown";
  const ask = !first || alt.ask_developer === null;
  if (!ask && !alt.remediation && alt.value === "false") return null;
  return (
    <li className="alt">
      {/* CLI 는 참이 아닌 대안을 싣는다(거짓 또는 모름). 모름이면 발견 줄의 첫 줄처럼 메시지 앞에 `모름` 이름표를 단다. */}
      {!first && (alt.message || unknown) && (
        <p className="alt-message">
          {unknown && <span className="unk">모름</span>}
          {alt.message}
        </p>
      )}
      {!unknown && alt.value !== "false" && <p className="hint">이 대안의 값: {alt.value}</p>}
      {(ask || alt.remediation) && (
        <dl className="qa">
          {ask && (
            <>
              <dt>질문</dt>
              <dd>{alt.ask_developer ?? <span className="none">이 대안에는 질문이 실려 있지 않습니다.</span>}</dd>
            </>
          )}
          {alt.remediation && (
            <>
              <dt>고치는 법</dt>
              <dd>{alt.remediation}</dd>
            </>
          )}
        </dl>
      )}
    </li>
  );
}

/**
 * 발견 하나의 `자세히`: 판정이 본 범위 → 대안(고치는 법, 나머지 대안의 메시지·질문) → '모름' 문장(있을 때) → AI 에게 묻지 않은
 * 조건과 판정을 끝까지 하지 못한 이유 → 규칙·대안 id(12px) → 접힌 판정 경로(CLI 원문).
 */
function FindingBody({ location }: { location: LocationView }) {
  const { finding } = location;
  const alternatives = finding.unsatisfied_alternatives;
  // 판정자가 꺼져 있었다는 이유는 AI 조건 줄이 이미 말한다. 같은 말을 두 번 적지 않는다.
  const reasons = finding.untested_reasons.filter((reason) => !(reason === "no-judge" && finding.ai_pending.length > 0));
  return (
    <div className="finding-body">
      <p className="hint">
        {scopeNote(
          location.scope,
          location.line === null ? "none" : location.lineUnsure ? "unsure" : "known",
          finding.decision_path.length > 0,
        )}
      </p>
      {alternatives.length > 0 ? (
        <>
          <ul className="alternatives">
            {alternatives.map((alt, i) => (
              <Alternative key={`${alt.id}:${i}`} alt={alt} first={i === 0} />
            ))}
          </ul>
          {/* 고치는 법과 나머지 대안 다음에 '모름' 문장을 한 번 적는다(값이 모름인 대안이 있을 때만). */}
          {alternatives.some((alt) => alt.value === "unknown") && <p className="unk-note">{UNKNOWN_ALTERNATIVE}</p>}
        </>
      ) : (
        // 목록이 비어도 대안이 모두 확인됐다는 뜻이 아니다. CLI 는 참이 아니라고 판정한 대안만 싣는다.
        <p className="hint">
          결과에 실린 대안이 없습니다. 판정에 넣지 않은 AI 조건과 약한 근거만 있어 풀지 못한 대안은 판정 경로에 있습니다.
        </p>
      )}
      {(finding.ai_pending.length > 0 || reasons.length > 0) && (
        <div className="why">
          <AiPending location={location} />
          {reasons.length > 0 && (
            <ul className="reasons">
              {reasons.map((reason, i) => (
                <li key={`${reason}:${i}`}>{reasonLabel(reason)}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="ids">
        <span>
          규칙 <RuleId policy={finding.policy} rule={location.rule} inPack={location.ruleInPack} />
        </span>
        {alternatives.length > 0 && (
          <span>
            대안{" "}
            {alternatives.map((alt, i) => (
              <span key={`${alt.id}:${i}`}>
                {i > 0 && " "}
                <code className="alt-id" translate="no">
                  {alt.id}
                </code>
              </span>
            ))}
          </span>
        )}
      </p>
      {finding.decision_path.length > 0 ? (
        <details className="path-fold">
          <summary>판정 경로(CLI 원문)</summary>
          <ol className="path" translate="no">
            {finding.decision_path.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        </details>
      ) : (
        <p className="hint">결과에 판정 경로가 실려 있지 않습니다.</p>
      )}
    </div>
  );
}

/** 확인 질문 한 줄. 이름표(12px)와 질문(CLI 가 낸 글 그대로). */
function Ask({ text }: { text: string }) {
  return (
    <span className="ask-line">
      <span className="lbl">질문</span> {text}
    </span>
  );
}

/**
 * 발견 하나. 단위는 정책 × 규칙 × 파일(함수 단위 규칙이면 함수)이다. 메시지, 위치(분석 쪽은 GitHub 의 커밋 고정 링크)와 판정이
 * 본 범위, 질문이 늘 보이고, 나머지는 `자세히` 안에 있다. 줄 번호는 문제의 줄이 아니라 판정이 본 범위 안의 한 줄이므로, 줄 번호가
 * 보이는 곳에는 범위가 늘 함께 보인다. `message`·`question` 이 거짓이면 그 줄을 적지 않는다(묶음 머리가 같은 글을 이미 적었다).
 */
function FindingItem({
  location,
  code,
  policy,
  message,
  question,
}: {
  location: LocationView;
  code: CodeSource | null;
  policy: PolicyView;
  message: boolean;
  question: boolean;
}) {
  const link = code && fileLink(code.htmlUrl, code.commit, location.file, location.line);
  const where = <Where file={location.file} line={location.line} />;
  const ask = question ? questionOf(location) : null;
  return (
    <li className="finding">
      <div className="finding-head">
        {message && <Message location={location} />}
        <span className="loc">
          {link && code ? (
            <a className="gh" href={link} target="_blank" rel="noopener noreferrer">
              {where}
              <Icon name="external" />
              <span className="visually-hidden">(GitHub, 새 창, 커밋 {shortCommit(code.commit)} 에 고정)</span>
            </a>
          ) : (
            where
          )}{" "}
          <span className="finding-scope">{scopeLabel(location.scope)}</span>
        </span>{" "}
        {location.status === policy.status ? (
          <span className="visually-hidden">{STATUS_LABEL[location.status]}</span>
        ) : (
          <StatusChip status={location.status} />
        )}{" "}
        {/* 같은 파일·같은 줄에 규칙이 다른 발견이 있으면 줄의 글이 같아질 수 있다. 화면 낭독기로 줄만 옮겨 다녀도 구분되게
            줄마다 규칙 이름을 보이지 않게 붙여 둔다. */}
        <span className="visually-hidden">규칙 {location.rule}</span>
        {ask && <Ask text={ask} />}
      </div>
      <details className="f-more">
        <summary>자세히</summary>
        <FindingBody location={location} />
      </details>
    </li>
  );
}

/**
 * 같은 규칙의 발견 묶음. 한 곳뿐이면 줄 하나다. 여러 곳이면 머리에 메시지와 질문, `N곳` 을 두고, 대표 위치를 먼저 보이고, 그보다
 * 많이 반복될 때만 나머지를 접는다. 접는 것은 이 묶음 안에서만 한다. 규칙이 다른 발견은 서로 다른 의무라서 접어 가리지 않는다.
 * 규칙 id 는 줄마다 `자세히` 안에 있다.
 */
function RuleGroup({ group, code, policy }: { group: RuleGroupView; code: CodeSource | null; policy: PolicyView }) {
  const total = group.shown.length + group.folded.length;
  const lead = group.shown[0];
  const headMessage = total > 1 && lead ? messageOf(lead) : null;
  const headQuestion = total > 1 && lead ? questionOf(lead) : null;
  // 묶음 머리가 적은 글과 같으면 줄에서 되풀이하지 않는다.
  const item = (location: LocationView, i: number) => (
    <FindingItem
      key={`${location.fingerprint}:${i}`}
      location={location}
      code={code}
      policy={policy}
      message={headMessage === null || messageOf(location) !== headMessage}
      question={headQuestion === null || questionOf(location) !== headQuestion}
    />
  );
  return (
    <section className="rule-group">
      {total > 1 && lead && (
        <div className="rule-head">
          <h3>
            <Message location={lead} /> <span className="rule-n">{total}곳</span>
          </h3>
          {headQuestion && <Ask text={headQuestion} />}
          {/* 접힌 곳에만 있는 상태가 가려지지 않게, 상태가 섞여 있으면 개수를 머리에 적는다. */}
          {group.folded.length > 0 &&
            group.counts.length > 1 &&
            group.counts.map(({ status, count }) => (
              <span key={status} className="rule-count">
                <StatusChip status={status} /> {count}곳
              </span>
            ))}
        </div>
      )}
      <ul className="findings">{group.shown.map(item)}</ul>
      {group.folded.length > 0 && (
        <details className="more">
          <summary>같은 규칙의 나머지 {group.folded.length}곳</summary>
          <ul className="findings">{group.folded.map(item)}</ul>
        </details>
      )}
    </section>
  );
}

/** 상자로 그리는 정책인지: 발견이나 충족 근거 위치가 있다. 나머지는 곁칸의 묶음에만 나온다. */
export const isBoxed = (policy: PolicyView) => policy.locations.length > 0 || policy.evidence.length > 0;

/**
 * 정책 하나의 상자. `statute` 는 상자 맨 아래에 접어 두는 근거 조문 원문(분석 쪽이 서버에서 팩 메타데이터의 글을 넘긴다).
 */
export function PolicyCard({
  policy,
  code = null,
  statute,
}: {
  policy: PolicyView;
  code?: CodeSource | null;
  statute?: ReactNode;
}) {
  const question = policy.locations[0]?.finding.ask_developer;
  const titleId = `${policyCardId(policy.id)}-title`;
  return (
    // id 는 같은 쪽 안에서 이 상자로 옮겨 올 때 쓴다(곁칸, 데모의 표). 한 쪽에 그리는 결과는 하나뿐이다.
    <article className={`box policy policy-${policy.status}`} id={policyCardId(policy.id)} aria-labelledby={titleId}>
      <header className="pbox-hd">
        {policy.law &&
          (policy.inPack ? (
            // 프리페치를 끈다. 연 파일의 내용에 따라 달라지는 요청이 나가지 않게 한다.
            <Link href={policyHref(policy.id)} prefetch={false} className="law">
              {keepArticle(policy.law)}
            </Link>
          ) : (
            <p className="law">{keepArticle(policy.law)}</p>
          ))}
        <div className="tl">
          <h2 className="t" id={titleId}>
            {policy.title}
          </h2>
          <StatusChip status={policy.status} />
        </div>
      </header>

      {question && (
        <dl className="qa pq">
          <dt>질문</dt>
          <dd className="q">{question}</dd>
        </dl>
      )}

      {/* 정책별 수는 결과에 정책별 요약이 있을 때(v1 초안)만 안다. 전체 수에서 짐작해 적지 않는다. */}
      {policy.units !== null && <p className="hint pbox-units">이 정책의 판정 단위는 {policy.units}개입니다.</p>}

      <div className="rows">
        {policy.evidence.length > 0 && (
          <ul className="evidence" aria-label="충족 근거 위치">
            {policy.evidence.map((e, i) => (
              // 대안 id(팩 안의 이름)는 적지 않는다(2026-11-11 오너 지시: 내부 이름은 화면에 드러내지 않는다).
              <li key={`${e.file}:${e.line}:${e.alternative}:${i}`}>
                <Where file={e.file} line={e.line} /> 에서 충족 근거 확인
              </li>
            ))}
          </ul>
        )}

        {policy.rules.map((group) => (
          <RuleGroup key={group.rule} group={group} code={code} policy={policy} />
        ))}

        {statute}
      </div>
    </article>
  );
}
