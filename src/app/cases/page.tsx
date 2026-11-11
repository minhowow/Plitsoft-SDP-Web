import type { Metadata } from "next";
import Link from "next/link";
import { CaseFacts } from "@/components/cases/CaseFacts";
import { Icon } from "@/components/Icon";
import { casesFile, casesHref } from "@/lib/cases";
import { CASE_STORIES } from "@/lib/cases/stories";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: SITE.cases.title };

/**
 * 사례 목록. CLI 세션이 미리 돌린 공개 저장소 결과(2026-11-10·11 오너 결정). 빌드할 때 그린다. 저장소마다 한 줄: 이름, 한 줄
 * 요약, 규칙만 본 발견 수와 AI 를 켠 뒤의 발견 수. 줄 전체가 그 사례 쪽으로 가는 링크다(조문 도감 목록과 같은 꼴).
 */
export default function CasesPage() {
  const { cases } = casesFile;
  return (
    <>
      {/* data-page: 머리글이 지금 쪽(사례)을 표시하는 데 쓴다(CSS :has. 머리글의 HTML 은 모든 쪽에서 같다). */}
      <h1 data-page="cases">{SITE.cases.title}</h1>
      <CaseFacts cases={cases} />
      <ul className="policy-index">
        {cases.map((c) => (
          <li key={c.slug}>
            <Link href={casesHref(c.slug)} className="pi-row">
              <span className="pi-title">
                {c.owner}/{c.name}
              </span>
              <span className="pi-law">{CASE_STORIES[c.slug]?.headline}</span>
              <span className="pi-n">
                규칙만 {c.ruleOnly.length} · AI 를 켠 뒤 {c.final.length}
              </span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
