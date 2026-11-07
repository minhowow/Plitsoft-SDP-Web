/**
 * 직접 그린 선 아이콘 다섯(docs/redesign.md 2.1): 검색, 접기(chevron-down), 다음(chevron-right), 새 창(external), 커밋.
 * 16×16, 굵기 1.5, 글자색(currentColor)을 따른다. 바깥 아이콘 묶음을 쓰지 않는다(라이선스 고지와 GitHub 닮음을 함께 피한다).
 *
 * 그림일 뿐이라 화면 낭독기에는 숨긴다(aria-hidden). 뜻은 곁의 글이나 그것을 품은 링크·단추의 이름(aria-label)이 말한다.
 * `title` 속성은 달지 않는다(터치와 키보드에서 보이지 않는다). 목록 줄마다 뿌리지 않는다. 줄 전체가 링크인 목록만 줄 끝에
 * 다음(chevron-right)을 단다(docs/redesign.md 2.1).
 */
const PATHS = {
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25 13.5 13.5" />
    </>
  ),
  "chevron-down": <path d="M4.5 6.25 8 9.75l3.5-3.5" />,
  "chevron-right": <path d="M6.25 4.5 9.75 8l-3.5 3.5" />,
  external: <path d="M9.5 2.75h3.75V6.5M13.25 2.75 7.5 8.5M11.5 9.5v3.75H2.75V4.5H6.5" />,
  commit: (
    <>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M1.5 8h4M10.5 8h4" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className={`ic ic-${name}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
