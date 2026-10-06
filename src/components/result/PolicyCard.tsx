import Link from "next/link";
import { policyHref } from "@/lib/pack";
import { reasonLabel } from "@/lib/report/reasons";
import { STATUS_HINT } from "@/lib/report/status";
import type { LocationView, PolicyView } from "@/lib/report/view-model";
import { StatusChip } from "./StatusChip";

function where(file: string, line: number | null): string {
  return line === null ? file : `${file}:${line}`;
}

function AiPending({ location }: { location: LocationView }) {
  const { finding } = location;
  if (finding.ai_pending.length === 0) return null;
  const conditions = finding.ai_pending.join(", ");
  // 판정자가 꺼져 있었을 때만 켜 보라고 권한다. 켰는데 답을 쓰지 못한 경우에는 아래 이유가 설명한다.
  if (finding.untested_reasons.includes("no-judge")) {
    return (
      <p className="pending">
        AI 에게 묻지 않은 조건: {conditions}. 판정자가 꺼져 있었습니다. 로컬에서 판정자를 켜고 다시 검사하면 풀릴 수
        있습니다. 판정자를 켜면 판정 대상 코드가 외부 API 로 나갑니다.
      </p>
    );
  }
  return (
    <p className="pending">
      판정에 넣지 못한 AI 조건: {conditions}. 판정자가 답하지 못했거나 답을 쓸 수 없었습니다.
    </p>
  );
}

function Location({ location }: { location: LocationView }) {
  const { finding } = location;
  return (
    <li className="location">
      <div className="location-head">
        <span>
          <code>{where(location.file, location.line)}</code> <span className="alt-id">규칙 {location.rule}</span>
        </span>
        <StatusChip status={location.status} />
      </div>
      {finding.scope === "file" && location.line !== null && (
        <p className="hint">파일 전체를 보고 내린 판정입니다. 줄 번호는 이 조문이 닿는다고 본 첫 줄입니다.</p>
      )}

      {finding.unsatisfied_alternatives.length > 0 && (
        <ul className="alternatives" aria-label="확인되지 않은 적법한 대안">
          {finding.unsatisfied_alternatives.map((alt, i) => (
            <li key={`${alt.id}:${i}`}>
              <span className="alt-id">{alt.id}</span>
              {alt.message && <p>{alt.message}</p>}
              {alt.ask_developer && <p className="ask">질문: {alt.ask_developer}</p>}
              {alt.remediation && <p className="fix">고치려면: {alt.remediation}</p>}
            </li>
          ))}
        </ul>
      )}

      <AiPending location={location} />

      {finding.untested_reasons.length > 0 && (
        <ul className="reasons">
          {finding.untested_reasons.map((reason, i) => (
            <li key={`${reason}:${i}`}>{reasonLabel(reason)}</li>
          ))}
        </ul>
      )}

      <details className="path">
        <summary>판정 경로</summary>
        <ol>
          {finding.decision_path.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </details>
    </li>
  );
}

/** 정책 하나. 같은 정책의 발견은 한 장에 묶어 보여 준다. */
export function PolicyCard({ policy }: { policy: PolicyView }) {
  const question = policy.locations[0]?.finding.ask_developer;
  const quiet = policy.locations.length === 0 && policy.evidence.length === 0;
  return (
    <article className={`policy policy-${policy.status}`}>
      <header className="policy-head">
        <div>
          <p className="law">{policy.law}</p>
          <h3>
            {policy.inPack ? (
              // 프리페치를 끈다. 연 파일의 내용에 따라 달라지는 요청이 나가지 않게 한다.
              <Link href={policyHref(policy.id)} prefetch={false}>
                {policy.title}
              </Link>
            ) : (
              policy.title
            )}
          </h3>
        </div>
        <div className="policy-state">
          <StatusChip status={policy.status} />
          {policy.locations.length > 0 && <span className="count">발견 {policy.locations.length}건</span>}
        </div>
      </header>

      {quiet &&
        (policy.aiCleared > 0 ? (
          <p className="hint">
            AI 판정자의 답으로 풀린 경고가 {policy.aiCleared}건 있습니다. 아래 &lsquo;AI 가 푼 경고&rsquo;에서 인용한 줄을
            확인하세요.
          </p>
        ) : (
          <p className="hint">{STATUS_HINT[policy.status]}</p>
        ))}

      {question && <p className="question">개발자에게 할 질문: {question}</p>}

      {policy.evidence.length > 0 && (
        <ul className="evidence" aria-label="충족 근거 위치">
          {policy.evidence.map((e, i) => (
            <li key={`${e.file}:${e.line}:${e.alternative}:${i}`}>
              <code>{where(e.file, e.line)}</code> 에서 대안 <span className="alt-id">{e.alternative}</span> 확인
            </li>
          ))}
        </ul>
      )}

      {policy.locations.length > 0 && (
        <ul className="locations">
          {policy.locations.map((location, i) => (
            <Location key={`${location.fingerprint}:${i}`} location={location} />
          ))}
        </ul>
      )}
    </article>
  );
}
