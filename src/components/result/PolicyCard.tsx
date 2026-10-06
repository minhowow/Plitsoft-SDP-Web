import Link from "next/link";
import { Fragment } from "react";
import { policyHref } from "@/lib/pack";
import { reasonLabel } from "@/lib/report/reasons";
import { scopeLabel, scopeNote } from "@/lib/report/scope";
import { STATUS_HINT } from "@/lib/report/status";
import type { UnsatisfiedAlternative } from "@/lib/report/types";
import type { LocationView, PolicyView, RuleGroupView } from "@/lib/report/view-model";
import { FindingSummary } from "./FindingSummary";
import { StatusChip } from "./StatusChip";

/** 줄 번호와 한 덩어리로 묶는 이름 끝(확장자 + ":줄")의 가장 긴 길이. 덩어리는 줄을 바꾸지 못하므로 짧아야 한다. */
const TAIL_MAX = 16;

/**
 * 파일 경로와 줄. 글자는 더하지 않으므로 복사한 글은 경로 그대로다.
 *
 * 경로는 좁은 화면에서 거의 언제나 줄이 바뀐다. "/" 뒤에서 바뀌게 줄바꿈 자리(wbr)를 넣는다. 파일 이름 하나가
 * 한 줄보다 길면 이름 한가운데서도 바뀐다(가로로 넘치게 두지 않는다). 그때 줄 번호만 다음 줄에 홀로 남지 않게
 * 확장자와 ":줄"은 한 덩어리로 묶는다.
 *
 * 줄바꿈 자리는 화면 낭독기에 알리지 않는다(aria-hidden). 알리면 경로가 "src/ auth/ …"처럼 빈칸이 낀 이름으로 읽힌다.
 */
function Where({ file, line }: { file: string; line: number | null }) {
  const folders = file.split("/");
  const last = folders.pop() ?? "";
  let name = last;
  let tail = "";
  if (line !== null) {
    const dot = last.lastIndexOf(".");
    const extension = dot > 0 ? last.slice(dot) : "";
    tail = `${extension}:${line}`.length <= TAIL_MAX ? `${extension}:${line}` : `:${line}`;
    name = last.slice(0, last.length + `:${line}`.length - tail.length);
  }
  return (
    <code>
      {folders.map((folder, i) => (
        <Fragment key={i}>
          {folder}/<wbr aria-hidden="true" />
        </Fragment>
      ))}
      {name}
      {tail && <span className="where-tail">{tail}</span>}
    </code>
  );
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

/** 확인되지 않은 대안 하나. 무엇이 확인되지 않았는지 → 질문 → 고치는 법 순서로 읽힌다. */
function Alternative({ alt }: { alt: UnsatisfiedAlternative }) {
  return (
    <li className="alt">
      <p className="alt-id">{alt.id}</p>
      {alt.message && <p className="alt-message">{alt.message}</p>}
      {/* CLI 는 참이 아닌 대안을 싣는다(거짓 또는 모름). 모름이면 메시지가 "없다"로 읽히지 않게 그 사실을 적는다. */}
      {alt.value === "unknown" && (
        <p className="hint">
          이 대안의 값은 &lsquo;모름&rsquo;입니다. 확인하지 못했을 뿐이고, 없다고 판정된 것은 아닙니다.
        </p>
      )}
      {alt.value !== "unknown" && alt.value !== "false" && <p className="hint">이 대안의 값: {alt.value}</p>}
      <dl className="alt-rows">
        <div>
          <dt>질문</dt>
          <dd>{alt.ask_developer ?? <span className="none">이 대안에는 질문이 실려 있지 않습니다.</span>}</dd>
        </div>
        <div>
          <dt>고치는 법</dt>
          <dd>{alt.remediation ?? <span className="none">이 대안에는 고치는 법이 실려 있지 않습니다.</span>}</dd>
        </div>
      </dl>
    </li>
  );
}

/**
 * 발견 하나를 펼친 안쪽. 맨 위에 판정이 본 범위를 문장으로 적고, 그 아래는
 * 확인되지 않은 대안(질문·고치는 법) → 판정을 끝까지 하지 못한 이유 → 판정 경로 순서다.
 */
function FindingBody({ location }: { location: LocationView }) {
  const { finding } = location;
  const alternatives = finding.unsatisfied_alternatives;
  // 판정자가 꺼져 있었다는 이유는 AI 조건 안내가 이미 말한다. 같은 말을 두 번 적지 않는다.
  const reasons = finding.untested_reasons.filter(
    (reason) => !(reason === "no-judge" && finding.ai_pending.length > 0),
  );
  return (
    <div className="finding-body">
      <p className="hint">{scopeNote(location.scope, location.line !== null)}</p>

      <section className="step">
        <h5>확인되지 않은 적법한 대안{alternatives.length > 0 && ` ${alternatives.length}개`}</h5>
        {alternatives.length > 0 ? (
          <ul className="alternatives">
            {alternatives.map((alt, i) => (
              <Alternative key={`${alt.id}:${i}`} alt={alt} />
            ))}
          </ul>
        ) : (
          // 목록이 비어도 대안이 모두 확인됐다는 뜻이 아니다. CLI 는 참이 아니라고 판정한 대안만 싣는다.
          <p className="hint">
            결과에 실린 것이 없습니다. 여기에는 확인되지 않은 것으로 판정된 대안만 실립니다. 판정에 넣지 않은 AI 조건과,
            약한 근거만 있어 풀지 못한 대안은 판정 경로에서 볼 수 있습니다.
          </p>
        )}
      </section>

      {(finding.ai_pending.length > 0 || reasons.length > 0) && (
        <section className="step">
          <h5>판정을 끝까지 하지 못한 이유</h5>
          <AiPending location={location} />
          {reasons.length > 0 && (
            <ul className="reasons">
              {reasons.map((reason, i) => (
                <li key={`${reason}:${i}`}>{reasonLabel(reason)}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="step">
        <h5>판정 경로</h5>
        {finding.decision_path.length > 0 ? (
          <>
            <p className="hint">CLI 가 남긴 문장 그대로입니다.</p>
            <ol className="path">
              {finding.decision_path.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </>
        ) : (
          <p className="hint">결과에 판정 경로가 실려 있지 않습니다.</p>
        )}
      </section>
    </div>
  );
}

/**
 * 발견 하나. 단위는 정책 × 규칙 × 파일(함수 단위 규칙이면 함수)이다. 한 줄로 보이고, 펼치면 안쪽이 나온다.
 *
 * 닫힌 줄에서도 보여야 하는 것은 줄 안(summary)에 둔다: 경로·줄, 판정이 본 범위, 상태. 줄 번호는 문제의 줄이 아니라
 * 판정이 본 범위 안의 한 줄이므로, 줄 번호가 보이는 곳에는 범위가 늘 함께 보여야 한다.
 */
function FindingItem({ location, open }: { location: LocationView; open: boolean }) {
  return (
    <li className="finding">
      <details open={open}>
        <FindingSummary>
          {/* 배치는 안쪽 상자에서 한다. summary 자체를 flex·grid 로 만들면 브라우저에 따라 다르게 그려진 적이 있다. */}
          <span className="finding-head">
            <Where file={location.file} line={location.line} />{" "}
            <span className="finding-scope">{scopeLabel(location.scope)}</span>{" "}
            <StatusChip status={location.status} />{" "}
            {/* 같은 파일·같은 줄에 규칙이 다른 발견이 있으면 줄의 글이 같아진다. 눈에는 묶음 머리가 규칙을 말해 주지만,
                화면 낭독기로 줄만 옮겨 다니면 구분되지 않으므로 줄마다 규칙 이름을 보이지 않게 붙여 둔다. */}
            <span className="visually-hidden">규칙 {location.rule}</span>
          </span>
        </FindingSummary>
        <FindingBody location={location} />
      </details>
    </li>
  );
}

/**
 * 같은 규칙의 발견 묶음. 대표 위치를 먼저 보이고, 같은 규칙이 그보다 많이 반복될 때만 나머지를 접는다.
 * 접는 것은 이 묶음 안에서만 한다. 규칙이 다른 발견은 서로 다른 의무라서 접어 가리지 않는다.
 */
function RuleGroup({ group }: { group: RuleGroupView }) {
  const total = group.shown.length + group.folded.length;
  return (
    <section className="rule-group">
      <div className="rule-head">
        <h4>규칙 {group.rule}</h4>
        {total > 1 && <span className="count">{total}곳</span>}
        {/* 접힌 곳에만 있는 상태가 가려지지 않게, 상태가 섞여 있으면 개수를 머리에 적는다. */}
        {group.folded.length > 0 &&
          group.counts.length > 1 &&
          group.counts.map(({ status, count }) => (
            <span key={status} className="rule-count">
              <StatusChip status={status} /> {count}곳
            </span>
          ))}
      </div>
      <ul className="findings">
        {group.shown.map((location, i) => (
          // 묶음의 첫 발견만 펼쳐 둔다. 같은 규칙의 다른 곳은 대안이 대개 같으므로 한 줄로 둔다.
          <FindingItem key={`${location.fingerprint}:${i}`} location={location} open={i === 0} />
        ))}
      </ul>
      {group.folded.length > 0 && (
        <details className="more">
          <summary>같은 규칙의 나머지 {group.folded.length}곳</summary>
          <ul className="findings">
            {group.folded.map((location, i) => (
              <FindingItem key={`${location.fingerprint}:${i}`} location={location} open={false} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** 정책 하나. 같은 정책의 발견은 한 장에 묶고, 그 안에서 규칙별로 나눠 보여 준다. */
export function PolicyCard({ policy }: { policy: PolicyView }) {
  const question = policy.locations[0]?.finding.ask_developer;
  // 발견이 없는 정책에는 왜 없는지(상태의 설명)를 늘 적는다. 충족 근거 위치가 함께 실려 있어도 적는다.
  const quiet = policy.locations.length === 0;
  // 정책별 수는 결과에 정책별 요약이 있을 때(v1 초안)만 안다. CLI 0.3 의 전체 수에서 짐작해 적지 않는다.
  const units = policy.units === null ? null : `이 정책의 판정 단위는 ${policy.units}개입니다.`;
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

      {quiet ? (
        <p className="hint">
          {policy.aiCleared > 0 ? (
            <>
              AI 판정자의 답으로 풀린 경고가 {policy.aiCleared}건 있습니다. 아래 &lsquo;AI 가 푼 경고&rsquo;에서 인용한 줄을
              확인하세요.
            </>
          ) : (
            STATUS_HINT[policy.status]
          )}
          {units && ` ${units}`}
        </p>
      ) : (
        units && <p className="hint">{units}</p>
      )}

      {question && <p className="question">개발자에게 할 질문: {question}</p>}

      {policy.evidence.length > 0 && (
        <ul className="evidence" aria-label="충족 근거 위치">
          {policy.evidence.map((e, i) => (
            <li key={`${e.file}:${e.line}:${e.alternative}:${i}`}>
              <Where file={e.file} line={e.line} /> 에서 대안 <span className="alt-id">{e.alternative}</span> 확인
            </li>
          ))}
        </ul>
      )}

      {policy.rules.map((group) => (
        <RuleGroup key={group.rule} group={group} />
      ))}
    </article>
  );
}
