import { SITE } from "@/lib/site";

/**
 * 저장소 검색창. 스크립트 없이도 듣는 보통의 GET 양식이라 `/search/?q=…` 로 간다. 머리글과 첫 화면, 검색 쪽이 함께 쓴다.
 *
 * 머리글의 것은 모든 쪽에서 글자까지 같아야 한다(tests/browser/out-files.test.ts). 그래서 지금 쪽의 질의를 채워 넣지 않는다.
 * 검색 쪽은 제 검색창에 질의를 채운다(`SearchResults`).
 */
export function SearchForm({
  id,
  label,
  big = false,
  defaultValue,
  value,
  onChange,
}: {
  id: string;
  label: string;
  big?: boolean;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <form className={big ? "search search-big" : "search"} action="/search/" method="get" role="search" aria-label={label}>
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
        {...(onChange ? { value: value ?? "", onChange: (event) => onChange(event.target.value) } : { defaultValue })}
      />
      <button type="submit">검색</button>
    </form>
  );
}
