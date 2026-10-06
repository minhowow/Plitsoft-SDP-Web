import type { Metadata } from "next";
import Link from "next/link";
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
            <nav aria-label="주 메뉴">
              <Link href="/view/">결과 보기</Link>
              <Link href="/demo/">데모</Link>
              <Link href="/policy/">조문 도감</Link>
            </nav>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site-footer">
          <div className="wrap">
            <p>{SITE.disclaimer}</p>
            <p>이 사이트는 정적 페이지입니다. 열어 본 결과 파일과 코드는 서버로 보내지 않습니다.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
