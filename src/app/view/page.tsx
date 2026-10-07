import type { Metadata } from "next";
import { ReportViewer } from "@/components/viewer/ReportViewer";
import { packIndex } from "@/lib/pack";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "결과 보기" };

export default function ViewPage() {
  return (
    <>
      <h1>결과 보기</h1>
      {/* 연 것은 다른 쪽에 다녀와도 남아 있다(ReportViewer). 그때도 맞는 말이게 "처음에는"이라고 적는다. */}
      <p className="lede">
        <code>{SITE.cli} scan --output-format json</code>(또는 <code>sarif</code>)의 출력을 엽니다. 처음에는 합성 예시가
        열려 있습니다.
      </p>
      <ReportViewer pack={packIndex} />
    </>
  );
}
