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
        <code>{SITE.cli} scan --output-format json</code>
        {/* 닫는 괄호 뒤의 조사가 줄 머리로 떨어지지 않게 묶는다(components/text.tsx 의 keepParticles 와 같은 까닭). */}
        <span className="nobreak">
          (또는 <code>sarif</code>)의
        </span>{" "}
        출력을 엽니다. {SITE.viewLocal} 처음에는
        합성 예시가 열려 있습니다.
      </p>
      <ReportViewer pack={packIndex} />
    </>
  );
}
