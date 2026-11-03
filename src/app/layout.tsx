import type { Metadata } from "next";
import Link from "next/link";
import { SearchForm } from "@/components/service/SearchForm";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: SITE.name, template: `%s · ${SITE.name}` },
  description: SITE.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">
              {SITE.name}
            </Link>
            {/* 검색이 맨 위다(방향 B). 모든 쪽에서 글자까지 같아야 해서 지금 쪽의 질의를 채우지 않는다. */}
            <SearchForm id="site-q" label="저장소 검색" />
            <nav aria-label="주 메뉴">
              <Link href="/search/">저장소</Link>
              <Link href="/policy/">조문 도감</Link>
              <Link href="/view/">결과 파일 열기</Link>
              <Link href="/demo/">데모</Link>
            </nav>
          </div>
        </header>
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
