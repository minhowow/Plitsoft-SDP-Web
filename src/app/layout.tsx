import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { HeaderBehavior } from "@/components/HeaderBehavior";
import { Icon } from "@/components/Icon";
import { HeaderSearch } from "@/components/service/SearchForm";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.tagline,
};

/**
 * 브라우저의 틀(주소 표시줄 등)과 폼 요소가 사이트의 바탕과 테마를 따르게 한다. 값은 globals.css 의 --bg 와 같다(밝은 테마
 * #ffffff, 어두운 테마 #0d1117). 테마는 운영체제 설정을 따른다.
 */
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
};

/**
 * 메뉴의 링크. 넓은 화면의 메뉴와 좁은 화면의 펼치는 메뉴가 같은 것을 쓴다. 결과 파일 열기(/view)는 메뉴에 두지 않는다. 주소는
 * 유틸리티로 남는다(docs/redesign.md, 2026-11-05 오너 결정).
 */
function NavLinks() {
  return (
    <>
      <Link href="/policy/">조문 도감</Link>
      <Link href="/demo/">데모</Link>
    </>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        {/*
          머리글은 모든 쪽에서 글자까지 같다(tests/browser/served-files.test.ts). 지금 쪽의 표시와, 본문에 검색창이 있는 쪽에서 머리글의
          검색창을 감추는 것은 CSS(:has)가 한다. 768px 아래에서는 검색창과 메뉴 대신 검색 단추와 펼치는 메뉴가 보인다.
        */}
        <header className="site-header">
          <div className="wrap hdr-in">
            <Link href="/" className="brand">
              {SITE.name}
            </Link>
            <HeaderSearch id="site-q" label="저장소 검색" />
            <nav className="hdr-nav" aria-label="주 메뉴">
              <NavLinks />
            </nav>
            <div className="hdr-m">
              <Link href="/search/" className="icon-btn hdr-m-search" aria-label="저장소 검색" prefetch={false}>
                <Icon name="search" />
              </Link>
              <details className="menu">
                <summary>
                  메뉴
                  <Icon name="chevron-down" />
                </summary>
                <nav className="menu-pop" aria-label="주 메뉴">
                  <NavLinks />
                </nav>
              </details>
            </div>
          </div>
        </header>
        <HeaderBehavior />
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <p>{SITE.disclaimer}</p>
            <p>{SITE.footer}</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
