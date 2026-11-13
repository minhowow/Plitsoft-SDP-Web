import type { Metadata } from "next";
import Link from "next/link";
import { StructureFigure } from "@/components/how/StructureFigure";
import { casesFile, casesHref } from "@/lib/cases";
import { buildFigures, TRACE, traceSourceLine } from "@/lib/how/figures";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: SITE.how.title };

/**
 * 구조 쪽(2026-11-13 오너 지시, 전시와 보고서용). 맨 위는 쉬운 판 셋(처음 보는 사람이 10초 안에 읽는 것)과 따라가 보기(사례 하나가
 * 단계를 지나는 모습, 발표의 중심 장), 그 아래 '자세히 보기'에 자세한 판 셋(만든 사람이 읽는 설계도, 그림마다 글 3~4줄)을 접어 둔다.
 * 빌드할 때 그린다. 그림의 자료와 출처는 src/lib/how/figures.ts, 포스터·보고서용 파일은 docs/figures/(scripts/export-figures.mjs).
 */
export default function HowPage() {
  const { simple, trace, detailed } = buildFigures(casesFile);
  const repo = casesFile.cases.find((c) => c.slug === TRACE.slug);
  // 사례 결과를 실을 때 함께 보이는 것(미리 돌린 결과, 저장소·커밋·돌린 날·모델). 앞의 "사례 저장소"는 그 사례 쪽으로 가는 링크다.
  const source = traceSourceLine(casesFile);
  const repoLabel = repo ? `사례 ${repo.owner}/${repo.name}` : "";
  return (
    <div className="how">
      {/* data-page: 머리글이 지금 쪽(구조)을 표시하는 데 쓴다(CSS :has). */}
      <h1 data-page="how">{SITE.how.title}</h1>
      {[...simple, trace].map((figure, i) => (
        <section key={figure.id} className="how-sec" aria-labelledby={`${figure.id}-h`}>
          <h2 className="sec-h" id={`${figure.id}-h`}>
            {i + 1}. {figure.title}
          </h2>
          <StructureFigure figure={figure} />
          {figure === trace && repo && (
            <p className="how-src">
              <Link href={casesHref(repo.slug)}>{repoLabel}</Link>
              {source.slice(repoLabel.length)}
            </p>
          )}
        </section>
      ))}
      <details className="how-more">
        <summary>자세히 보기</summary>
        <div className="how">
          {detailed.map((figure, i) => (
            <section key={figure.id} className="how-sec" aria-labelledby={`${figure.id}-h`}>
              <h3 className="sec-h" id={`${figure.id}-h`}>
                {i + 1}. {figure.title}
              </h3>
              <StructureFigure figure={figure} />
              <ul className="how-notes">
                {figure.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </details>
    </div>
  );
}
