import type { Metadata } from "next";
import { ReportViewer } from "@/components/viewer/ReportViewer";
import { packIndex } from "@/lib/pack";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "결과 보기" };

export default function ViewPage() {
  return (
    <>
      <h1>결과 보기</h1>
      <p className="lede">
        <code>{SITE.cli} scan --output-format json</code> 의 출력을 엽니다. 아래에는 합성 예시가 먼저 열려 있습니다.
      </p>
      <ReportViewer pack={packIndex} />
    </>
  );
}
