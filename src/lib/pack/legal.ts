/** 항 번호 ①~⑳ 의 첫 글자와 끝 글자. */
const FIRST_MARK = 0x2460;
const LAST_MARK = 0x2473;
const MARK_LINE = /^[①-⑳]/;

/**
 * 조문 원문에서 조문 이름(`legal[].label`)이 가리키는 항 하나. 원문에서 그 항 번호(①, ② …)로 시작하는 줄부터 다음 항 번호의
 * 줄 앞까지를 그대로 잘라 낸다. 글은 고치지 않는다.
 *
 * 이름에 항이 없거나(예: 시행령 제62조), 원문에서 그 항을 찾지 못하면 null 이다. 그때 화면은 원문 전체를 보인다.
 */
export function paragraphOf(label: string, text: string): string | null {
  const match = /제(\d+)항\s*$/.exec(label);
  if (!match) return null;
  const mark = FIRST_MARK + Number(match[1]) - 1;
  if (mark > LAST_MARK) return null;
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.startsWith(String.fromCodePoint(mark)));
  if (start < 0) return null;
  const next = lines.findIndex((line, i) => i > start && MARK_LINE.test(line));
  return lines
    .slice(start, next < 0 ? lines.length : next)
    .join("\n")
    .trimEnd();
}
