import {
  altKind,
  ASKED_TO_JUDGE,
  CONDITION_UNDESCRIBED,
  HASH_MISMATCH_NOTE,
  hashStatus,
  isWeak,
  judgeNote,
  LEGAL_NOTE,
  LEGEND_COVERS,
  NO_APPLIES_QUESTION,
  NO_STATUTE_TEXT,
  NOT_IN_PACK,
  PACK_DIGEST_NOTE,
  policyUnits,
  PRIMARY_NOTE,
  REVIEW_BY_NOTE,
  ruleLegend,
  sameTextNote,
  unitLabel,
  WEAK_NOTE,
} from "@/lib/pack/guide";
import type { Alternative, LegalRef, PackMeta, PolicyDoc, Rule } from "@/lib/pack/types";
import { SITE } from "@/lib/site";

// 조문 도감의 정책 한 쪽. 서버 부품이다. 빌드할 때 그려지고, 브라우저에서 도는 코드가 없다(접는 것은 details 가 한다).
// 쪽 안의 자리로 가는 링크(#…)를 두지 않는다. 브라우저에 그대로 맡기면 뒤로 가기가 어긋나고(`lib/scroll.ts` 의 moveTo),
// 직접 옮기려면 브라우저에서 도는 부품이 있어야 한다.

/** 팩에 없는 값의 자리. 비워 두지 않고 없다고 적는다. */
function Missing() {
  return <span className="none">{NOT_IN_PACK}</span>;
}

/** id 가 팩에 없을 때 그 자리에 적는 말. CLI 는 id 가 없는 팩을 받지 않으므로 손으로 만든 자료에서만 보인다. */
const NO_ID = "(id 없음)";

/**
 * 화면 낭독기에만 읽히는, 이름 앞에 붙이는 말. 한 쪽에 같은 이름의 링크와 접어 둔 것이 되풀이되므로("새 창에서 열기",
 * "조문 원문", "판정자에게 묻는 글") 어느 조문·규칙·대안의 것인지 붙여 이름이 서로 다르게 한다. 눈에는 보이지 않는다.
 * 뒤에 오는 보이는 글과 붙어 읽히지 않게 끝에 빈칸을 둔다.
 */
function Whose({ children }: { children: string }) {
  return <span className="visually-hidden">{`${children} `}</span>;
}

/**
 * 근거 조문 하나: 이름, 팩에 적힌 날짜와 해시, 법제처 링크, 원문.
 *
 * 원문은 팩에 실린 글자 그대로 싣는다. 다듬거나 줄이지 않는다. 줄바꿈과 빈칸은 CSS 가 그대로 보인다(`.statute`).
 * 대표 조문의 원문만 펼쳐 두고 나머지는 접는다. 원문이 길어서 모두 펼치면 규칙이 한참 아래로 밀린다.
 */
function LegalBlock({ legal, primary, sameText }: { legal: LegalRef; primary: boolean; sameText: string | null }) {
  const hash = hashStatus(legal);
  return (
    <div className="legal">
      <h3>
        {legal.label}
        {primary && (
          <>
            {" "}
            <span className="tag">대표 조문</span>
          </>
        )}
      </h3>
      {/* 표시의 뜻은 보이는 글로 적는다. 마우스를 올려야 뜨는 말(title)은 터치 화면과 키보드로는 읽을 수 없다. */}
      {primary && <p className="hint">{PRIMARY_NOTE}</p>}
      <dl className="meta-row legal-facts">
        <div>
          <dt>시행일</dt>
          <dd>{legal.effective_from ?? <Missing />}</dd>
        </div>
        <div>
          <dt>원문을 받은 날</dt>
          <dd>{legal.text_retrieved ?? <Missing />}</dd>
        </div>
        <div>
          <dt>원문 해시</dt>
          <dd className={hash.warn ? "warn" : undefined}>{hash.text}</dd>
        </div>
        <div>
          <dt>법제처 링크</dt>
          <dd>
            {legal.url ? (
              // 주소는 팩 메타데이터의 것만 쓴다. 눌러야 나간다. 화면 낭독기에는 어느 조문의 링크인지 함께 읽힌다.
              <a href={legal.url} rel="noopener noreferrer" target="_blank">
                <Whose>{legal.label}</Whose>새 창에서 열기
              </a>
            ) : (
              <Missing />
            )}
          </dd>
        </div>
      </dl>
      {legal.text ? (
        <>
          {legal.text_sha256_matches === false && <p className="notice notice-warn">{HASH_MISMATCH_NOTE}</p>}
          <details className="fold" open={primary}>
            <summary>
              <Whose>{legal.label}</Whose>
              {sameText ? (
                <>
                  {/* 빈칸은 앞의 글에 붙여 한 덩어리로 적는다. 따로 떼어 적으면({" "}) Chrome 이 화면 낭독기에 내주는
                      이름에서 그 빈칸이 빠져 두 말이 붙는다("조문 원문위 첫째 …"). */}
                  {"조문 원문 "}
                  <span className="fold-note">{sameText}</span>
                </>
              ) : (
                "조문 원문"
              )}
            </summary>
            <pre className="statute">{legal.text}</pre>
          </details>
        </>
      ) : (
        <p className="none">{NO_STATUTE_TEXT}</p>
      )}
    </div>
  );
}

/**
 * 대안 표의 한 줄: 대안의 id, 종류와 세기, 확인되지 않았을 때 사람에게 하는 말(알리는 말, 질문, 고치는 법).
 * 팩에 없는 글은 없다고 적는다. 같은 규칙의 다른 대안에서 끌어오지 않는다. AI 대안이 판정자에게 묻는 글은 접어 둔다.
 */
function AlternativeRow({ alt, ruleId }: { alt: Alternative; ruleId: string }) {
  return (
    <tr role="row">
      <th scope="row" role="rowheader">
        <code>{alt.id ?? NO_ID}</code>
      </th>
      <td className="alt-kind" role="cell">
        {altKind(alt)}
      </td>
      <td className="alt-says" role="cell">
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
          <div>
            <dt>고치는 법</dt>
            <dd>{alt.remediation ?? <Missing />}</dd>
          </div>
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
      </td>
    </tr>
  );
}

/**
 * 규칙 하나: 판정 단위, 적용 조건, 적용 질문, 대안 표.
 *
 * 적용 조건은 팩에 id 만 있다. id 옆의 설명 자리에는 팩이 아직 알려 주지 않는다고 적는다. id 를 풀어 쓰지 않는다.
 * 대안 표는 진짜 table 이다. 좁은 화면에서는 CSS 가 줄을 세로로 쌓는다. display 가 바뀌어도 화면 낭독기가 표로 읽게
 * role 을 직접 적는다(커버리지 보기의 표와 같다).
 */
function RuleBlock({ rule }: { rule: Rule }) {
  const ruleId = rule.id ?? NO_ID;
  return (
    <section className="rule-doc">
      <h3>
        규칙 <code>{ruleId}</code>
      </h3>
      <dl className="facts">
        <div>
          <dt>판정 단위</dt>
          <dd>{unitLabel(rule.scope)}</dd>
        </div>
        <div>
          <dt>적용 조건</dt>
          <dd>
            {rule.applies_when.length > 0 ? (
              <ul className="conditions">
                {rule.applies_when.map((id, i) => (
                  <li key={`${id}:${i}`}>
                    <code>{id ?? NO_ID}</code> <span className="none">{CONDITION_UNDESCRIBED}</span>
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
      <table className="alts" role="table">
        <caption>적법한 대안 {rule.alternatives.length}개</caption>
        <thead role="rowgroup">
          <tr role="row">
            <th scope="col" role="columnheader">
              대안
            </th>
            <th scope="col" role="columnheader">
              종류와 세기
            </th>
            <th scope="col" role="columnheader">
              확인되지 않았을 때 하는 말
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rule.alternatives.map((alt, i) => (
            <AlternativeRow key={`${alt.id}:${i}`} alt={alt} ruleId={ruleId} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 조문 도감의 정책 한 쪽. 정책마다 같은 틀이다: 머리(대표 조문, 제목, 개발자에게 할 질문) → 한눈에 보는 것(근거 조문과
 * 규칙의 수, 판정 단위, 재검토 기한, 팩과 팩 판) → 근거 조문 → 규칙.
 *
 * 값은 팩 메타데이터에 실린 그대로이고, 글은 `lib/pack/guide.ts` 에 있다. 팩 작성자 메모는 받지 않는다(`PolicyDoc`).
 */
export function PolicyDetail({ policy, pack }: { policy: PolicyDoc; pack: PackMeta["pack"] }) {
  const judge = judgeNote(policy);
  const primary = policy.legal[0]?.label;
  const units = policyUnits(policy);
  return (
    <article className="policy-page">
      <header className="policy-page-head">
        {primary && <p className="law">{primary}</p>}
        <h1>{policy.title}</h1>
        {policy.ask_developer && <p className="question">개발자에게 할 질문: {policy.ask_developer}</p>}
      </header>

      {/* 한눈에 보는 것. 값만 짧게 늘어놓고, 그 값이 무엇인지는 바로 아래에 한 번 적는다. */}
      <div className="policy-facts">
        <dl className="meta-row">
          <div>
            <dt>근거 조문</dt>
            <dd>{policy.legal.length}개</dd>
          </div>
          <div>
            <dt>규칙</dt>
            <dd>{policy.rules.length}개</dd>
          </div>
          <div>
            <dt>판정 단위</dt>
            <dd>{units.length > 0 ? units.join(", ") : <Missing />}</dd>
          </div>
          <div>
            <dt>재검토 기한</dt>
            <dd>{policy.review_by ?? <Missing />}</dd>
          </div>
          <div>
            <dt>팩</dt>
            <dd>{pack.id ? <code>{pack.id}</code> : <Missing />}</dd>
          </div>
          <div>
            <dt>팩 판</dt>
            <dd>
              <code>{pack.digest}</code>
            </dd>
          </div>
        </dl>
        <p className="hint">
          이 페이지는 위에 적은 팩 판으로 만들었습니다. {PACK_DIGEST_NOTE}
          {policy.review_by && ` ${REVIEW_BY_NOTE}`}
        </p>
      </div>

      <section className="policy-section">
        <h2>근거 조문 {policy.legal.length}개</h2>
        {policy.legal.length > 0 ? (
          <p className="hint">{LEGAL_NOTE}</p>
        ) : (
          <p className="none">팩에 근거 조문이 실려 있지 않습니다.</p>
        )}
        {policy.legal.map((legal, i) => (
          <LegalBlock key={`${legal.label}:${i}`} legal={legal} primary={i === 0} sameText={sameTextNote(policy.legal, i)} />
        ))}
      </section>

      <section className="policy-section">
        <h2>규칙 {policy.rules.length}개</h2>
        {/* 판정자를 켜야 묻는다는 것과, 켜면 코드가 밖으로 나간다는 것은 한 문단에 함께 둔다. */}
        {judge && <p className="notice">{judge}</p>}
        <details className="fold">
          <summary>
            규칙 읽는 법 <span className="fold-note">{LEGEND_COVERS}</span>
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
          <RuleBlock key={`${rule.id}:${i}`} rule={rule} />
        ))}
      </section>

      <p className="disclaimer">{SITE.disclaimer}</p>
    </article>
  );
}
