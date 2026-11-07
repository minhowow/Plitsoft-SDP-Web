import type { Metadata } from "next";
import { ReportViewer } from "@/components/viewer/ReportViewer";
import { packIndex } from "@/lib/pack";

export const metadata: Metadata = { title: "결과 파일 열기" };

/**
 * 결과 파일 열기(유틸리티. 2026-11-05 에 메뉴에서 뺐고 주소는 남는다). 제목 아래에 부제를 두지 않는다(docs/redesign.md 3장).
 * 연 파일은 브라우저 안에서만 읽는다는 문장은 드롭존 띠에 있다(`SITE.viewLocal`).
 */
export default function ViewPage() {
  return (
    <>
      <h1>결과 파일 열기</h1>
      <ReportViewer pack={packIndex} />
    </>
  );
}
