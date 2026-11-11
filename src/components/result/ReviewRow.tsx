import { Icon } from "@/components/Icon";
import type { ReviewItem } from "@/lib/report/view-model";
import { fileLink, shortCommit } from "@/lib/service/href";
import { Citation } from "./Citation";
import type { CodeSource } from "./PolicyCard";
import { RuleId } from "./RuleId";
import { Where } from "./Where";

/**
 * AI 의 답으로 풀리거나 빠진 판정 하나: 위치와 정책 이름, 인용한 줄(또는 묻는 말과 답). 규칙·대안 id(팩 안의 이름)와 인용이
 * 없는 대안은 `자세히` 안에 둔다(2026-11-11 오너 지시: 내부 이름은 `자세히` 안. 조문별 검사 기록에는 그대로 실린다).
 */
export function ReviewRow({
  item,
  code = null,
  policy = true,
}: {
  item: ReviewItem;
  /** 분석 쪽이면 위치를 GitHub 의 커밋 고정 링크로 건다. */
  code?: CodeSource | null;
  /** 정책 이름을 적을지. 정책 상자 안(체크리스트)에서는 상자가 이미 그 정책이다. */
  policy?: boolean;
}) {
  // 어느 인용이 어느 대안을 받치는지는 인용과 같은 차례로 `자세히` 안에 적는다.
  const cited = item.quotes.map((quote) => quote.alternative).filter((id): id is string => id !== null);
  const link = code && fileLink(code.htmlUrl, code.commit, item.file, item.line);
  const where = <Where file={item.file} line={item.line} />;
  return (
    <li className="ai-row">
      <p className="ai-at">
        {link && code ? (
          <a className="gh" href={link} target="_blank" rel="noopener noreferrer">
            {where}
            <Icon name="external" />
            <span className="visually-hidden">(GitHub, 새 창, 커밋 {shortCommit(code.commit)} 에 고정)</span>
          </a>
        ) : (
          where
        )}{" "}
        {policy &&
          (item.title === item.policy ? (
            <code className="ai-policy" translate="no">
              {item.policy}
            </code>
          ) : (
            <span className="ai-policy">{item.title}</span>
          ))}
      </p>
      <Citation quotes={item.quotes} />
      {item.question && <p className="ask">질문: {item.question}</p>}
      {item.answer && <p className="ask">답: {item.answer}</p>}
      <details className="f-more">
        <summary>
          자세히
          <span className="visually-hidden">
            {" "}
            {item.line === null ? item.file : `${item.file}:${item.line}`} 규칙 {item.rule}
          </span>
        </summary>
        <p className="ids">
          <span>
            규칙 <RuleId policy={item.policy} rule={item.rule} inPack={item.ruleInPack} />
          </span>
          {cited.length > 0 && (
            <span>
              인용한 대안{" "}
              {cited.map((id, i) => (
                <span key={`${id}:${i}`}>
                  {i > 0 && " "}
                  <code className="alt-id" translate="no">
                    {id}
                  </code>
                </span>
              ))}
            </span>
          )}
          {item.uncited.length > 0 && (
            <span>
              인용 없음{" "}
              {item.uncited.map((id, i) => (
                <span key={`${id}:${i}`}>
                  {i > 0 && " "}
                  <code className="alt-id" translate="no">
                    {id}
                  </code>
                </span>
              ))}
            </span>
          )}
        </p>
      </details>
    </li>
  );
}

