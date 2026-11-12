import { SearchCombobox } from "./SearchCombobox";

/**
 * 저장소 검색창 셋. 모두 같은 브라우저 부품(`SearchCombobox`, 자동 완성)이고, 스크립트가 없으면 보통의 GET 양식이라
 * `/search/?q=…` 로 간다(docs/redesign.md 5장).
 */

/**
 * 본문의 저장소 검색창(검색 쪽). 검색 쪽은 제 검색창에 질의를 채운다. 오른쪽 끝의 돋보기가 보내기 단추다(이름은 aria-label).
 */
export function SearchForm({ id, label, defaultValue }: { id: string; label: string; defaultValue?: string }) {
  return <SearchCombobox variant="page" id={id} label={label} defaultValue={defaultValue} />;
}

/**
 * 첫 화면의 큰 검색창(600×48px, 글자 16px. 목업 home-feed). 머리글 검색창처럼 돋보기가 왼쪽에 있고, 그 돋보기가 보내기 단추다.
 * 돋보기는 Tab 차례에서 뺀다(목업과 같다): 첫 Tab 이 검색창에 닿고, 검색창에서 엔터로 보낸다. 빈 질의를 보내는 단추에 먼저
 * 닿지 않는다. 빈 검색창에서 ↓ 는 아래 최근 분석의 첫 줄로 간다.
 */
export function HomeSearch({ id, label }: { id: string; label: string }) {
  return <SearchCombobox variant="home" id={id} label={label} />;
}

/**
 * 머리글의 검색창(docs/redesign.md 3장 "공통: 머리글과 바닥글"). 단추 없이 엔터로 보낸다. 돋보기는 그림이라 화면 낭독기에는
 * 숨긴다. 머리글은 모든 쪽에서 글자까지 같아야 해서(tests/browser/served-files.test.ts) 지금 쪽의 질의를 채우지 않고, 펼침
 * 목록도 빈 채로 그린다. 본문에 검색창이 있는 쪽에서는 CSS 가 감춘다.
 *
 * 이 검색창으로 떠나면(클라이언트 이동) 친 글자를 비운다.
 *
 * 목업의 "/" 키 표시와 그 키로 검색창에 들어가는 것은 뺐다. 끌 수 없는 글자 하나짜리 단축키는 WCAG 2.1.4 에 걸린다
 * (docs/ROADMAP.md 의 "사람 결정이 필요한 것").
 */
export function HeaderSearch({ id, label }: { id: string; label: string }) {
  return <SearchCombobox variant="header" id={id} label={label} />;
}
