import type { Metadata } from "next";
import { StructureFigure } from "@/components/how/StructureFigure";
import { FIGURES } from "@/lib/how/figures";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: SITE.how.title };

/**
 * 구조 쪽(2026-11-13 오너 지시, 전시와 보고서용). 그림 세 장: 한 번의 분석이 지나는 길(구축 구조), CLI 안에서 일어나는 일
 * (review 한 번), 같은 엔진의 두 가지 쓰임. 그림마다 글은 3~4줄이다. 빌드할 때 그린다. 그림의 자료와 출처는 src/lib/how/figures.ts,
 * 포스터·보고서용 파일은 docs/figures/(scripts/export-figures.mjs).
 */
export default function HowPage() {
  return (
    <div className="how">
      {/* data-page: 머리글이 지금 쪽(구조)을 표시하는 데 쓴다(CSS :has). */}
      <h1 data-page="how">{SITE.how.title}</h1>
      {FIGURES.map((figure, i) => (
        <section key={figure.id} className="how-sec" aria-labelledby={`${figure.id}-h`}>
          <h2 className="sec-h" id={`${figure.id}-h`}>
            {i + 1}. {figure.title}
          </h2>
          <StructureFigure figure={figure} />
          <ul className="how-notes">
            {figure.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
