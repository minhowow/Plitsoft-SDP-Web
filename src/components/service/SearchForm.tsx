import { Icon } from "@/components/Icon";
import { SITE } from "@/lib/site";

/**
 * 본문의 저장소 검색창(검색 쪽). 스크립트 없이도 듣는 보통의 GET 양식이라 `/search/?q=…` 로 간다. 검색 쪽은 제 검색창에 질의를
 * 채운다. 오른쪽 끝의 돋보기가 보내기 단추다(이름은 aria-label). 첫 화면의 큰 검색창은 아래 `HomeSearch`, 머리글의 것은
 * `HeaderSearch` 다.
 */
export function SearchForm({ id, label, defaultValue }: { id: string; label: string; defaultValue?: string }) {
  return (
    <form className="search" action="/search/" method="get" role="search" aria-label={label}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input
        id={id}
        name="q"
        type="search"
        placeholder={SITE.service.searchPlaceholder}
        autoComplete="off"
        spellCheck={false}
        defaultValue={defaultValue}
      />
      <button type="submit" aria-label="검색">
        <Icon name="search" />
      </button>
    </form>
  );
}

/**
 * 첫 화면의 큰 검색창(600×48px, 글자 16px. 목업 home-feed). 머리글 검색창처럼 돋보기가 왼쪽에 있고, 그 돋보기가 보내기 단추다.
 * 보통의 GET 양식이다(스크립트 없음). 돋보기는 Tab 차례에서 뺀다(목업과 같다): 첫 Tab 이 검색창에 닿고, 검색창에서 엔터로 보낸다.
 * 빈 질의를 보내는 단추에 먼저 닿지 않는다.
 */
export function HomeSearch({ id, label }: { id: string; label: string }) {
  return (
    <form className="find" action="/search/" method="get" role="search" aria-label={label}>
      <button type="submit" className="find-go" aria-label="검색" tabIndex={-1}>
        <Icon name="search" />
      </button>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input id={id} name="q" type="search" placeholder={SITE.service.searchPlaceholder} autoComplete="off" spellCheck={false} />
    </form>
  );
}

/**
 * 머리글의 검색창(docs/redesign.md 3장 "공통: 머리글과 바닥글"). 본문의 것(`SearchForm`)과 같은 GET 양식이고 단추 없이 엔터로
 * 보낸다(입력창이 하나뿐인 양식은 엔터로 보내진다). 돋보기는 그림이라 화면 낭독기에는 숨긴다. 머리글은 모든 쪽에서 글자까지
 * 같아야 해서(tests/browser/served-files.test.ts) 지금 쪽의 질의를 채우지 않는다. 본문에 검색창이 있는 쪽에서는 CSS 가 감춘다.
 *
 * 목업의 "/" 키 표시와 그 키로 검색창에 들어가는 것은 뺐다. 끌 수 없는 글자 하나짜리 단축키는 WCAG 2.1.4 에 걸린다
 * (docs/ROADMAP.md 의 "사람 결정이 필요한 것").
 */
export function HeaderSearch({ id, label }: { id: string; label: string }) {
  return (
    <form className="hdr-search" action="/search/" method="get" role="search" aria-label={label}>
      <Icon name="search" />
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <input id={id} name="q" type="search" placeholder={SITE.service.searchPlaceholder} autoComplete="off" spellCheck={false} />
    </form>
  );
}
