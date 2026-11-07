import type { QuotedLine } from "@/lib/report/view-model";
import { Where } from "./Where";

/**
 * 인용한 줄. 하나든 여럿이든 줄마다 `경로:줄` 과 그 글을 적는다. 글은 결과에 실린 그대로다(줄바꿈과 빈칸까지. CSS 가
 * `white-space: pre-wrap` 으로 보인다). 줄 번호가 실려 있지 않으면 경로만 적는다(짐작해 채우지 않는다).
 *
 * 인용이 받치는 대안이 있으면(`alternative`) 그 id 를 맨 앞에 적는다. 사람이 "그 줄이 그 대안의 근거가 맞는지" 확인하려면 어느
 * 대안의 인용인지 알아야 한다.
 *
 * AI 가 푼 경고의 상자가 쓴다. 인용한 줄이 실리는 다른 자리도 이 부품으로 그린다.
 */
export function Citation({ quotes }: { quotes: QuotedLine[] }) {
  if (quotes.length === 0) return null;
  return (
    <ul className="cites">
      {quotes.map((quote, i) => (
        <li key={i} className="cite">
          <span className="cite-at">
            {quote.alternative !== null && (
              <>
                대안{" "}
                <code className="alt-id" translate="no">
                  {quote.alternative}
                </code>{" "}
              </>
            )}
            <Where file={quote.file} line={quote.line} />
          </span>
          <code className="cite-text" translate="no">
            {quote.text}
          </code>
        </li>
      ))}
    </ul>
  );
}
