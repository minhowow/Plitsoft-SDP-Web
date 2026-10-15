import { Fragment, useId, type ReactNode } from "react";
import { keepParticles } from "@/components/text";
import { GAPS_NOTE, GAPS_TITLE } from "@/lib/report/coverage";
import {
  AI_CLEARED,
  AI_DISMISSED,
  LINE_UNSURE,
  NOT_IN_PACK,
  RECORD_OMITS,
  RECORD_REFUSED,
  sourceLine,
  type RecordGap,
  type RecordSource,
  type RecordView,
} from "@/lib/report/record";
import { SITE } from "@/lib/site";
import { Where } from "./Where";

// 조문별 검사 기록(인쇄용)을 그린다. 무엇을 싣고 무엇을 싣지 않는지는 `lib/report/record.ts` 가 정한다. 여기서는 받은 것을
// 늘어놓기만 한다.
//
// 인쇄할 때는 이 기록만 나온다(globals.css 의 @media print). 그래서 기록에는 접어 둔 것(details), 링크, 마우스를 올려야
// 뜨는 말(title)을 두지 않는다. 종이에서는 펼칠 수도 누를 수도 없다. 상태도 색 칩이 아니라 글자로 적는다.
//
// 표는 진짜 table 이다. 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다. display 가 바뀌어도 화면 낭독기가 표로 읽게 role 을
// 직접 적는다(커버리지 보기의 표와 같다). 쌓았을 때 칸 앞에 적는 이름은 `data-label` 에서 CSS 가 그린다. 그 이름은 눈에만
// 보이게 한다(빈 대체 글을 준다. globals.css). 화면 낭독기에는 가려 둔 칸 머리가 있어서, 함께 알리면 칸마다 두 번 읽힌다.
//
// 구역마다 제목(h4)이 있다. 표가 든 구역에서는 그 제목이 표의 이름이기도 하다(표가 `aria-labelledby` 로 가리킨다. 표 이름을
// 따로 두 번 적지 않는다). 제목으로 건너다니는 사람이 표가 든 구역을 지나치지 않는다.
//
// 표에 덧붙이는 말 가운데 표의 줄이 무엇인지 적은 것은 표 위에 둔다(`About`). 표 아래에 두면, 표가 쪽을 넘어갈 때 그 글만
// 다음 쪽에 남을 수 있다.

/** 표의 칸 머리. `hidden` 이면 화면에서만 가린다(화면 낭독기에는 남는다). */
function Columns({ names, hidden = false }: { names: readonly string[]; hidden?: boolean }) {
  return (
    <thead className={hidden ? "visually-hidden" : undefined} role="rowgroup">
      <tr role="row">
        {names.map((name) => (
          <th key={name} scope="col" role="columnheader">
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/**
 * 값이 든 칸 하나. `label` 은 그 칸의 칸 머리와 같은 이름이고, 줄을 쌓았을 때 칸 앞에 적힌다. 칸의 내용은 상자 하나로
 * 감싼다. 쌓았을 때 이름과 내용이 나란히 놓이는 두 덩어리가 된다.
 */
function Cell({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <td className={className} role="cell" data-label={label}>
      <div>{children}</div>
    </td>
  );
}

/**
 * 표 위에, 구역의 제목 바로 아래에 적는 말: 그 표의 줄과 값이 무엇인지. 표 아래에 두지 않는다. 앞 쪽에서 이어진 표의 뒤에 온
 * 글은 인쇄할 때 표의 마지막 줄과 붙지 않아서, 표의 끝이 쪽의 끝에 걸리면 그 글만 다음 쪽에 남는다
 * (`lib/report/record.ts` 의 `RECORD_OMITS`). 인쇄할 때 제목, 이 말, 표의 첫 줄은 떨어지지 않는다(globals.css).
 */
function About({ children }: { children: ReactNode }) {
  return <p className="hint record-about">{children}</p>;
}

/** 팩에 없는 값의 자리. 비워 두지 않고 없다고 적는다. */
function Missing() {
  return <span className="none">{NOT_IN_PACK}</span>;
}

/** 긴 값을 끊어 적는 마디의 길이. SHA-256 은 네 마디, 지문은 두 마디가 된다. */
const CHUNK = 16;

/**
 * 해시와 지문. 글자를 더하지 않으므로 끌어 골라 복사한 글은 원래 값 그대로다.
 *
 * 값이 칸보다 길면 줄이 바뀌어야 한다(가로로 넘치게 두지 않는다). 아무 데서나 바뀌면 줄마다 길이가 달라 눈으로 견주기
 * 어렵다. 16자마다 줄바꿈 자리(wbr)를 넣어 마디에서 바뀌게 한다. 칸이 한 마디보다도 좁으면 마디 안에서도 바뀐다.
 * 줄바꿈 자리는 화면 낭독기에 알리지 않는다(경로의 줄바꿈 자리와 같다. `Where.tsx`).
 */
function Hex({ value }: { value: string }) {
  const chunks: string[] = [];
  for (let at = 0; at < value.length; at += CHUNK) chunks.push(value.slice(at, at + CHUNK));
  return (
    <code className="record-hex">
      {chunks.map((chunk, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr aria-hidden="true" />}
          {chunk}
        </Fragment>
      ))}
    </code>
  );
}

/** 정책 id 와 규칙 id. 한 줄씩 적는다. AI 의 기록 두 가지가 함께 쓴다. */
function PolicyRule({ policy, rule }: { policy: string; rule: string }) {
  return (
    <>
      <code className="record-id">{policy}</code> <code className="record-id">{rule}</code>
    </>
  );
}

/** 검사 정보: 도구·엔진·판정자·팩 판·출력 형식, 검사한 파일 수와 판정 단위 수, 결과에 없는 것(범위, 날, 커밋). */
function Facts({ record }: { record: RecordView }) {
  return (
    <section className="record-section">
      <h4>검사 정보</h4>
      <dl className="record-facts">
        {record.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd className={fact.kind === "missing" ? "none" : undefined}>
              {fact.kind === "code" ? <code>{fact.value}</code> : fact.value}
            </dd>
          </div>
        ))}
      </dl>
      {record.factNotes.map((note) => (
        <p key={note} className="hint">
          {note}
        </p>
      ))}
    </section>
  );
}

function GapDetail({ gap }: { gap: RecordGap }) {
  return (
    <>
      {gap.meaning && <p>{gap.meaning}</p>}
      {gap.note && <p className="hint">{keepParticles(gap.note)}</p>}
      {gap.files.length > 0 && (
        <ul className="record-files">
          {gap.files.map((item, i) => (
            <li key={`${item.file}:${i}`}>
              <Where file={item.file} line={null} />
              {/* 검사한 파일(일부를 읽지 못했거나 엔진이 끝내지 못한 파일)에는 이 결과에서 나온 발견의 수를 적는다. */}
              {item.findings !== null && (
                <>
                  {" "}
                  <span className="record-scope">발견 {item.findings}건</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 다 보지 못한 것: 결과에 실린 세 목록과 엔진 오류의 수. 결과 화면의 표와 이름이 같다. 맨 위 경고가 이 이름으로 가리킨다.
 * 접지 않고 모두 적는다. 든 것이 하나도 없으면 줄을 촘촘히 적는다.
 */
function Gaps({ record }: { record: RecordView }) {
  const title = useId();
  const none = record.gaps.every((gap) => !gap.on);
  return (
    <section className="record-section">
      <h4 id={title}>
        {GAPS_TITLE} <span className="record-title-note">{GAPS_NOTE}</span>
      </h4>
      <table className={none ? "record-gaps record-gaps-none" : "record-gaps"} role="table" aria-labelledby={title}>
        <Columns names={["목록", "수", "뜻과 파일"]} hidden />
        <tbody role="rowgroup">
          {record.gaps.map((gap) => (
            <tr key={gap.label} className={gap.on ? "gap-on" : undefined} role="row">
              <th scope="row" role="rowheader">
                {gap.label}
              </th>
              <td className="record-gap-count" role="cell">
                {gap.countText}
              </td>
              <td className="record-gap-detail" role="cell">
                <GapDetail gap={gap} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">{record.gapsNote}</p>
    </section>
  );
}

/** 발견의 수와 상태별 수. 0건이면 0의 뜻을 바로 아래에 다시 적는다. AI 가 푼 것의 수가 뒤따른다. */
function Counts({ record }: { record: RecordView }) {
  return (
    <section className="record-section">
      <h4>발견 {record.findingCount}건</h4>
      {/* 0건이라는 줄이 홀로 서지 않게 한다. 맨 위의 말은 좁은 화면에서 여기까지 오면 화면 밖이다. */}
      {record.findingCount === 0 && <p>{SITE.zeroIsNotClearance}</p>}
      {record.counts.length > 0 && (
        <ul className="record-counts">
          {record.counts.map((entry) => (
            <li key={entry.label}>
              <strong>
                {entry.label} {entry.count}건
              </strong>{" "}
              <span className="record-meaning">{entry.meaning}</span>
            </li>
          ))}
        </ul>
      )}
      {record.aiNotes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </section>
  );
}

const POLICIES_TITLE = "정책별 대표 조문과 발견";
const POLICY_COLUMNS = ["정책", "대표 조문", "시행일", "원문 해시", "발견"] as const;

/** 정책마다 한 줄: 대표 조문, 그 조문의 시행일과 원문 해시, 이 결과에서의 발견. 표 아래에 값의 출처와 상태의 뜻을 적는다. */
function Policies({ record }: { record: RecordView }) {
  const title = useId();
  // 정책이 하나도 없는 결과가 있다(정책별 요약이 빈 v1 초안). 빈 표를 그리지 않고 없다고 적는다.
  if (record.policies.length === 0) {
    return (
      <section className="record-section">
        <h4>{POLICIES_TITLE}</h4>
        <p className="none">결과에 정책이 실려 있지 않습니다.</p>
      </section>
    );
  }
  return (
    <section className="record-section">
      <h4 id={title}>{POLICIES_TITLE}</h4>
      <table className="record-table" role="table" aria-labelledby={title}>
        <Columns names={POLICY_COLUMNS} />
        <tbody role="rowgroup">
          {record.policies.map((policy) => (
            <tr key={policy.id} role="row">
              <th scope="row" role="rowheader">
                {policy.title} <code className="record-id">{policy.id}</code>
              </th>
              <Cell label={POLICY_COLUMNS[1]}>{policy.law ?? <Missing />}</Cell>
              <Cell label={POLICY_COLUMNS[2]} className="record-date">
                {policy.effectiveFrom ?? <Missing />}
              </Cell>
              <Cell label={POLICY_COLUMNS[3]} className="record-hash">
                {policy.textSha256 ? <Hex value={policy.textSha256} /> : <Missing />}
                {policy.hashNote && <p className="record-warn">{policy.hashNote}</p>}
              </Cell>
              <Cell label={POLICY_COLUMNS[4]} className="record-found-cell">
                <ul className="record-found">
                  {policy.found.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="record-notes">
        {record.policyNotes.map((note) => (
          <li key={note}>{keepParticles(note)}</li>
        ))}
        {record.quiet.map((entry) => (
          <li key={entry.label}>
            <strong>{entry.label}:</strong> {entry.meaning}
          </li>
        ))}
      </ul>
    </section>
  );
}

const FINDING_COLUMNS = ["자리", "상태", "지문"] as const;

/**
 * 발견마다 한 줄: 자리(경로와 줄, 판정이 본 범위), 상태, 지문. 정책·규칙마다 묶고, 묶음의 첫 줄에 그 id 를 적는다.
 * 줄 번호 옆에는 판정이 본 범위를 늘 함께 적는다. 줄 번호는 문제의 줄이 아니다. 표 위에 줄 번호와 지문이 무엇인지 적는다.
 */
function Findings({ record }: { record: RecordView }) {
  const title = useId();
  if (record.findingGroups.length === 0) return null;
  return (
    <section className="record-section">
      <h4 id={title}>발견의 자리와 지문</h4>
      {record.findingNote && <About>{record.findingNote}</About>}
      <table className="record-table record-findings" role="table" aria-labelledby={title}>
        <Columns names={FINDING_COLUMNS} />
        {record.findingGroups.map((group) => (
          <tbody key={`${group.policy}/${group.rule}`} role="rowgroup">
            <tr className="record-group" role="row">
              <th colSpan={FINDING_COLUMNS.length} scope="rowgroup" role="rowheader">
                정책 <code>{group.policy}</code> · 규칙 <code>{group.rule}</code> · {group.findings.length}건
              </th>
            </tr>
            {group.findings.map((finding, i) => (
              <tr key={`${finding.fingerprint}:${i}`} role="row">
                <th scope="row" role="rowheader">
                  <Where file={finding.file} line={finding.line} /> <span className="record-scope">{finding.scope}</span>
                  {finding.lineUnsure && (
                    <>
                      {" "}
                      <span className="record-scope">{LINE_UNSURE}</span>
                    </>
                  )}
                </th>
                <Cell label={FINDING_COLUMNS[1]} className="record-status">
                  {finding.status}
                </Cell>
                <Cell label={FINDING_COLUMNS[2]} className="record-hash">
                  <Hex value={finding.fingerprint} />
                </Cell>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </section>
  );
}

/** AI 의 '예'로 풀린 경고: 자리, 정책과 규칙, 대안의 id. 인용한 줄은 싣지 않는다. */
function AiCleared({ record }: { record: RecordView }) {
  const title = useId();
  if (record.aiCleared.length === 0) return null;
  const columns = ["자리", "정책과 규칙", "AI 가 ‘예’라고 답한 대안"];
  return (
    <section className="record-section">
      <h4 id={title}>
        {AI_CLEARED} {record.aiCleared.length}건
      </h4>
      {/* 인용한 줄은 기록에 싣지 않는다. 사람이 봐야 한다고만 적으면 어디서 보는지 알 수 없으므로, 볼 곳을 이름으로 가리킨다. */}
      <About>
        AI 판정자가 &lsquo;예&rsquo;라고 답하고 코드 줄을 인용해서 풀린 경고입니다. 인용이 코드에 있는지만 확인된 것이라, 그
        줄이 근거가 맞는지는 사람이 봐야 합니다. 인용한 줄은 결과의 &lsquo;{AI_CLEARED}&rsquo;에서 확인하세요.
      </About>
      <table className="record-table" role="table" aria-labelledby={title}>
        <Columns names={columns} />
        <tbody role="rowgroup">
          {record.aiCleared.map((cleared, i) => (
            <tr key={i} role="row">
              <th scope="row" role="rowheader">
                <Where file={cleared.file} line={cleared.line} />
              </th>
              <Cell label={columns[1]} className="record-ids">
                <PolicyRule policy={cleared.policy} rule={cleared.rule} />
              </Cell>
              <Cell label="대안">
                {cleared.alternatives.map((id, j) => (
                  <Fragment key={`${id}:${j}`}>
                    {j > 0 && ", "}
                    <code>{id}</code>
                  </Fragment>
                ))}
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** 적용 질문에 AI 가 '아니오'라고 답해 빠진 판정: 자리, 정책과 규칙. 질문과 답은 싣지 않는다. */
function AiDismissed({ record }: { record: RecordView }) {
  const title = useId();
  if (record.aiDismissed.length === 0) return null;
  const columns = ["자리", "정책과 규칙"];
  return (
    <section className="record-section">
      <h4 id={title}>
        {AI_DISMISSED} {record.aiDismissed.length}건
      </h4>
      <About>적용 여부를 묻는 질문에 AI 가 &lsquo;아니오&rsquo;라고 답해, 인용 없이 빠진 판정입니다.</About>
      <table className="record-table" role="table" aria-labelledby={title}>
        <Columns names={columns} />
        <tbody role="rowgroup">
          {record.aiDismissed.map((dismissed, i) => (
            <tr key={i} role="row">
              <th scope="row" role="rowheader">
                <Where file={dismissed.file} line={dismissed.line} />
              </th>
              <Cell label={columns[1]} className="record-ids">
                <PolicyRule policy={dismissed.policy} rule={dismissed.rule} />
              </Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 조문별 검사 기록 한 장. 머리(이름, 무엇으로 만든 것인지, 싣지 않은 것, 법률 자문·인증이 아니라는 말, 다 보지 못한
 * 검사라는 경고) → 검사 정보 → 다 보지 못한 것 → 발견(상태별 수) → 정책별 대표 조문 → 발견의 자리와 지문 → AI 가 푼 것.
 *
 * 기록은 마지막 구역으로 끝난다. 그 뒤에 따로 선 글을 두지 않는다. 표가 한 쪽을 넘으면 인쇄할 때 그 글만 마지막 쪽에
 * 남을 수 있다(`lib/report/record.ts` 의 `RECORD_OMITS`). 구역 안에서도 같다. 길어질 수 있는 표(발견, AI 의 표 둘)는 구역의
 * 끝이고, 덧붙이는 말은 표 위에 있다(`About`). 표 아래에 말이 남은 구역은 둘이다. "다 보지 못한 것"은 늘 다른 구역이
 * 뒤따른다. 정책 표는 줄이 팩의 정책 수만큼이라, 앞 쪽에서 이어져도 그 쪽의 끝까지 가지 않는다(재어 본 것은
 * `docs/architecture.md` 의 "조문별 검사 기록"의 "인쇄"에 있다).
 */
export function RecordSheet({ record, source }: { record: RecordView; source: RecordSource }) {
  return (
    <article className="record">
      <header className="record-head">
        <h3>{SITE.record.title}</h3>
        <p className="record-source">{sourceLine(source)}</p>
        <p className="record-omits">{RECORD_OMITS}</p>
        {/* 발견 수와 상관없이 늘 적는다. 0의 뜻은 발견이 없는 정책의 줄을 읽기 전에 알아야 한다. */}
        <p className="record-notice">
          <strong>{SITE.record.lead}</strong> {SITE.record.rest} {SITE.zeroIsNotClearance}
        </p>
        {/* 다 보지 못한 검사라는 경고는 결과 화면에서처럼 맨 위에 둔다. */}
        {record.warning && (
          <p className="record-warning">
            <strong>{record.warning.lead}</strong>
            {record.warning.detail && ` ${record.warning.detail}`}
          </p>
        )}
      </header>
      <Facts record={record} />
      <Gaps record={record} />
      <Counts record={record} />
      <Policies record={record} />
      <Findings record={record} />
      <AiCleared record={record} />
      <AiDismissed record={record} />
    </article>
  );
}

/** 기록을 만들지 않은 결과에 보이는 안내: 만들지 않았다는 것과 그 까닭. */
export function RecordRefused({ reasons }: { reasons: string[] }) {
  return (
    <div className="notice notice-warn record-refused">
      <p>
        <strong>{RECORD_REFUSED}</strong>
      </p>
      <ul>
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </div>
  );
}
