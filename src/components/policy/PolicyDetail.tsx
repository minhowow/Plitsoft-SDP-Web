import { Icon } from "@/components/Icon";
import {
  altKind,
  ASKED_TO_JUDGE,
  CONDITION_UNDESCRIBED,
  type Fact,
  HASH_MISMATCH_NOTE,
  HASH_SHOWN,
  hashStatus,
  isWeak,
  judgeNote,
  legalFacts,
  LEGEND_COVERS,
  NO_APPLIES_QUESTION,
  NO_STATUTE_TEXT,
  NOT_IN_PACK,
  policyUnit,
  ruleLegend,
  sameTextNote,
  unitLabel,
  WEAK_NOTE,
} from "@/lib/pack/guide";
import { ruleAnchor } from "@/lib/pack/href";
import type { Alternative, LegalRef, PackMeta, PolicyDoc, Rule } from "@/lib/pack/types";
import { JumpLink, OpenTargetRule } from "./PolicyNav";

// 조문 도감의 정책 한 쪽(목업 policy, docs/redesign.md 3장). 서버 부품이다. 빌드할 때 그려진다. 접는 것은 details 가 하고,
// 브라우저에서 도는 것은 쪽 안의 자리로 옮기는 링크와 주소의 규칙 자리를 펼치는 것뿐이다(`PolicyNav.tsx`. 어디에도 요청하지 않는다).
//
// 쪽 안의 자리(id)는 셋이다: 근거 조문(`legal`), 규칙(`rules`), 규칙마다(`ruleAnchor`). 결과 화면의 규칙 id 가 규칙의 자리로 잇는다.

/** 팩에 없는 값의 자리. 비워 두지 않고 없다고 적는다. */
function Missing() {
  return <span className="none">{NOT_IN_PACK}</span>;
}

/** id 가 팩에 없을 때 그 자리에 적는 말. CLI 는 id 가 없는 팩을 받지 않으므로 손으로 만든 자료에서만 보인다. */
const NO_ID = "(id 없음)";

/**
 * 화면 낭독기에만 읽히는, 이름 앞에 붙이는 말. 한 쪽에 같은 이름의 링크와 접어 둔 것이 되풀이되므로("법제처 원문",
 * "판정자에게 묻는 글") 어느 조문·규칙·대안의 것인지 붙여 이름이 서로 다르게 한다. 눈에는 보이지 않는다.
 * 뒤에 오는 보이는 글과 붙어 읽히지 않게 끝에 빈칸을 둔다.
 */
function Whose({ children }: { children: string }) {
  return <span className="visually-hidden">{`${children} `}</span>;
}

/**
 * 사실 줄(이름표와 값). 곁칸 `이 정책` 과 조문마다의 줄이 쓴다. 식별자(팩, 팩 판)는 `code` 로 적고 번역하지 않게 한다(목록의 메타
 * 줄과 같다. docs/redesign.md 2.2).
 */
function FactRow({ fact, code = false }: { fact: Fact; code?: boolean }) {
  return (
    <div>
      <dt>{fact.label}</dt>
      <dd className={fact.warn ? "warn" : undefined}>{code ? <code translate="no">{fact.value}</code> : fact.value}</dd>
    </div>
  );
}

/**
 * 원문 해시. 앞 16자만 보이고, 전체 값은 그것을 누르면 펼쳐지는 자리에 글로 있다(골라 복사할 수 있다). 마우스를 올려야 뜨는
 * 말(title)에 두지 않는다. 화면 낭독기에는 어느 조문의 해시인지 함께 읽힌다.
 */
function HashValue({ legal }: { legal: LegalRef }) {
  if (!legal.text_sha256) return <Missing />;
  return (
    <details className="hash">
      <summary>
        <Whose>{`${legal.label} 원문 해시`}</Whose>
        <code translate="no">{`${legal.text_sha256.slice(0, HASH_SHOWN)}…`}</code>
      </summary>
      <code className="hash-full" translate="no">
        {legal.text_sha256}
      </code>
    </details>
  );
}

/**
 * 근거 조문 하나: 접는 줄(이름, 대표 조문 표시, 같은 원문 표시)과 그 옆의 법제처 링크, 펼치면 조문마다의 사실 줄과 원문.
 *
 * 원문은 팩에 실린 글자 그대로 싣는다. 다듬거나 줄이거나 줄을 나누어 다시 짜지 않는다. 줄바꿈과 빈칸은 CSS 가 그대로
 * 보인다(`.statute`, 이 컴퓨터의 명조). 대표 조문의 원문만 펼쳐 두고 나머지는 접는다.
 *
 * 법제처 링크는 접는 줄(summary) 밖에 둔다. 누르는 것 안에 누르는 것을 넣지 않는다. 화면에서는 CSS 가 줄의 오른쪽 끝에 놓는다.
 * 팩에 주소가 없으면 링크 대신 조문마다의 사실 줄에 없다고 적는다(빈 자리로 두지 않는다).
 *
 * 원문 해시가 팩에 적힌 것과 맞지 않거나 견주지 못한 조문은 대표 조문이 아니어도 펼쳐 둔다. 그 사실(해시 대조의 줄, 원문 위의
 * 알림)이 접힌 안쪽에만 있으면 펼치기 전에는 보이지 않는다.
 */
function LegalItem({ legal, primary, sameText, facts }: { legal: LegalRef; primary: boolean; sameText: string | null; facts: Fact[] }) {
  // 이름 뒤의 빈칸은 앞의 글에 붙여 한 덩어리로 적는다. 따로 떼어 적으면({" "}) Chrome 이 화면 낭독기에 내주는 이름에서 그
  // 빈칸이 빠져 두 말이 붙는다.
  const tail = primary || sameText !== null;
  return (
    <div className={legal.url ? "lg-item has-ext" : "lg-item"}>
      <details className="lg" open={primary || hashStatus(legal).warn}>
        <summary>
          <span className="lg-label">{tail ? `${legal.label} ` : legal.label}</span>
          {primary && <span className="tag">{sameText ? "대표 조문 " : "대표 조문"}</span>}
          {sameText && <span className="fold-note">{sameText}</span>}
        </summary>
        <div className="lg-body">
          <dl className="lg-facts">
            {facts.map((fact) => (
              <FactRow key={fact.label} fact={fact} />
            ))}
            {!legal.url && (
              <div>
                <dt>법제처 링크</dt>
                <dd>
                  <Missing />
                </dd>
              </div>
            )}
            <div>
              <dt>원문 해시</dt>
              <dd>
                <HashValue legal={legal} />
              </dd>
            </div>
          </dl>
          {legal.text && legal.text_sha256_matches === false && <p className="notice notice-warn">{HASH_MISMATCH_NOTE}</p>}
          {legal.text ? <pre className="statute">{legal.text}</pre> : <p className="none">{NO_STATUTE_TEXT}</p>}
        </div>
      </details>
      {legal.url && (
        // 주소는 팩 메타데이터의 것만 쓴다. 눌러야 나간다. 화면 낭독기에는 어느 조문의 링크인지와 새 창이라는 것이 함께 읽힌다.
        <a className="ext" href={legal.url} rel="noopener noreferrer" target="_blank">
          <Whose>{legal.label}</Whose>
          법제처 원문<span className="visually-hidden"> (새 창)</span>
          <Icon name="external" />
        </a>
      )}
    </div>
  );
}

/**
 * 대안 하나: id 와 종류·세기, 약한 대안의 말, 사람에게 하는 말(알리는 말, 질문, 고치는 법), AI 대안이 판정자에게 묻는 글(접어 둠).
 * 알리는 말과 질문은 팩에 없으면 없다고 적는다. 고치는 법은 팩에 있는 대안에만 적는다(결과 화면과 같다. docs/redesign.md 3장).
 * 같은 규칙의 다른 대안에서 끌어오지 않는다.
 */
function AlternativeItem({ alt, ruleId }: { alt: Alternative; ruleId: string }) {
  return (
    <li>
      <p className="alt-h">
        <code translate="no">{alt.id ?? NO_ID}</code> <span className="alt-kind">{altKind(alt)}</span>
      </p>
      {isWeak(alt) && <p className="hint">{WEAK_NOTE}</p>}
      <dl className="says">
        <div>
          <dt>알리는 말</dt>
          <dd>{alt.message ?? <Missing />}</dd>
        </div>
        <div>
          <dt>질문</dt>
          <dd>{alt.ask_developer ?? <Missing />}</dd>
        </div>
        {alt.remediation && (
          <div>
            <dt>고치는 법</dt>
            <dd>{alt.remediation}</dd>
          </div>
        )}
      </dl>
      {alt.question && (
        <details className="fold">
          <summary>
            <Whose>{`${ruleId} 대안 ${alt.id ?? NO_ID}`}</Whose>
            {ASKED_TO_JUDGE}
          </summary>
          <p>{alt.question}</p>
        </details>
      )}
    </li>
  );
}

/**
 * 규칙 하나(접는 줄). 첫 줄은 첫 대안의 알리는 말(팩 원문), 둘째 줄은 규칙 id 와 판정 단위다. 오른쪽에 대안의 수. 펼치면 적용
 * 조건, 적용 질문(접어 둠), 대안들. 규칙 줄에는 쪽 안의 자리(`ruleAnchor`)가 있다. 결과 화면의 규칙 id 가 이리로 온다.
 *
 * 적용 조건은 팩에 id 만 있다. id 옆의 설명 자리에는 팩이 아직 알려 주지 않는다고 적는다. id 를 풀어 쓰지 않는다.
 */
function RuleRow({ rule, open }: { rule: Rule; open: boolean }) {
  const ruleId = rule.id ?? NO_ID;
  const lead = rule.alternatives[0]?.message ?? null;
  return (
    <details className="rule-row" id={rule.id === null ? undefined : ruleAnchor(rule.id)} open={open}>
      <summary>
        <span className="msg">{lead ?? <Missing />}</span>
        <span className="n">대안 {rule.alternatives.length}</span>
        <span className="loc">
          <code translate="no">{ruleId}</code> <span>판정 단위 {unitLabel(rule.scope)}</span>
        </span>
      </summary>
      <div className="rule-body">
        <dl className="facts">
          <div>
            <dt>적용 조건</dt>
            <dd>
              {rule.applies_when.length > 0 ? (
                <ul className="conditions">
                  {rule.applies_when.map((id, i) => (
                    <li key={`${id}:${i}`}>
                      <code translate="no">{id ?? NO_ID}</code> <span className="none">{CONDITION_UNDESCRIBED}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="none">이 규칙에는 적용 조건이 없습니다.</span>
              )}
            </dd>
          </div>
          <div>
            <dt>적용 질문</dt>
            <dd>
              {rule.applies_question ? (
                <details className="fold">
                  <summary>
                    <Whose>{`${ruleId} 적용 질문`}</Whose>
                    {ASKED_TO_JUDGE}
                  </summary>
                  <p>{rule.applies_question}</p>
                </details>
              ) : (
                <span className="none">{NO_APPLIES_QUESTION}</span>
              )}
            </dd>
          </div>
        </dl>
        <ul className="alt-list">
          {rule.alternatives.map((alt, i) => (
            <AlternativeItem key={`${alt.id}:${i}`} alt={alt} ruleId={ruleId} />
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * 조문 도감의 정책 한 쪽. 정책마다 같은 틀이다: 머리(제목, 대표 조문과 정책 id, 개발자에게 할 질문, 바로가기) → 근거 조문 →
 * 규칙, 곁칸 `이 정책`(판정 단위, 재검토 기한, 팩, 팩 판, 원문의 출처). 넓은 화면에서는 곁칸이 오른쪽, 좁은 화면에서는 맨 아래다.
 *
 * 값은 팩 메타데이터에 실린 그대로이고, 글은 `lib/pack/guide.ts` 에 있다. 팩 작성자 메모는 받지 않는다(`PolicyDoc`). 면책은
 * 모든 쪽의 바닥글에 있다.
 */
export function PolicyDetail({ policy, pack }: { policy: PolicyDoc; pack: PackMeta["pack"] }) {
  const judge = judgeNote(policy);
  const primary = policy.legal[0]?.label;
  const unit = policyUnit(policy);
  const sources = legalFacts(policy.legal);
  return (
    <article className="policy-page">
      <header className="policy-page-head">
        <h1>{policy.title}</h1>
        <p className="pd-meta">
          {primary && <span className="law">{`${primary} `}</span>}
          <code translate="no">{policy.id}</code>
        </p>
        {policy.ask_developer && (
          <div className="pd-q">
            <p className="lbl">개발자에게 할 질문</p>
            <p className="question">{policy.ask_developer}</p>
          </div>
        )}
        <p className="jump">
          <JumpLink target="legal">
            근거 조문 <span className="n">{policy.legal.length}</span>
          </JumpLink>
          {" · "}
          <JumpLink target="rules">
            규칙 <span className="n">{policy.rules.length}</span>
          </JumpLink>
        </p>
      </header>

      <div className="policy-cols">
        <div className="policy-main">
          <section className="policy-section" id="legal" aria-labelledby="legal-title">
            <h2 className="sec-h" id="legal-title">
              근거 조문 <span className="count">{policy.legal.length}</span>
            </h2>
            {policy.legal.length > 0 ? (
              <div className="box rows legal-list">
                {policy.legal.map((legal, i) => (
                  <LegalItem
                    key={`${legal.label}:${i}`}
                    legal={legal}
                    primary={i === 0}
                    sameText={sameTextNote(policy.legal, i)}
                    facts={sources.perLegal[i]}
                  />
                ))}
              </div>
            ) : (
              <p className="none">팩에 근거 조문이 실려 있지 않습니다.</p>
            )}
          </section>

          <section className="policy-section" id="rules" aria-labelledby="rules-title">
            <h2 className="sec-h" id="rules-title">
              규칙 <span className="count">{policy.rules.length}</span>
            </h2>
            {/* 판정자를 켜야 묻는다는 것과, 켜면 코드가 밖으로 나간다는 것은 한 문단에 함께, 규칙보다 앞에 둔다. */}
            {judge && <p className="judge-note">{judge}</p>}
            <div className="box rows rule-list">
              <details className="legend-fold">
                <summary>
                  {"규칙 읽는 법 "}
                  <span className="fold-note">{LEGEND_COVERS}</span>
                </summary>
                <ul className="legend">
                  {ruleLegend(policy).map((item) => (
                    <li key={item.term}>
                      <strong>{item.term}:</strong> {item.text}
                    </li>
                  ))}
                </ul>
              </details>
              {policy.rules.map((rule, i) => (
                <RuleRow key={`${rule.id}:${i}`} rule={rule} open={i === 0} />
              ))}
            </div>
          </section>
        </div>

        <aside className="policy-side">
          <section className="box" aria-labelledby="facts-title">
            <div className="box-hd">
              <h2 id="facts-title">이 정책</h2>
            </div>
            <dl className="side-facts">
              <FactRow fact={{ label: "판정 단위", value: unit ?? NOT_IN_PACK }} />
              <FactRow fact={{ label: "재검토 기한", value: policy.review_by ?? NOT_IN_PACK }} />
              <FactRow fact={{ label: "팩", value: pack.id ?? NOT_IN_PACK }} code={pack.id !== null} />
              <FactRow fact={{ label: "팩 판", value: pack.digest }} code />
              {sources.side.map((fact) => (
                <FactRow key={fact.label} fact={fact} />
              ))}
            </dl>
          </section>
        </aside>
      </div>
      <OpenTargetRule />
    </article>
  );
}
