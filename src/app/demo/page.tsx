import type { Metadata } from "next";
import { DemoSwitcher } from "@/components/demo/DemoSwitcher";
import { loadDemoApps } from "@/lib/demo/load";
import { packIndex } from "@/lib/pack";

export const metadata: Metadata = { title: "데모" };

export default function DemoPage() {
  // 빌드할 때 합성 코드와 그 결과(contract/)를 읽는다. 실행 중에는 아무것도 읽지 않는다.
  const apps = loadDemoApps(packIndex);
  // 수집본은 판정자 없이 만든다. 판정자를 켠 수집본이 생기면 틀린 말이 되므로, 결과에서 확인하고 적는다.
  const judgeOff = apps.every((app) => app.variants.every((variant) => variant.view.judge === null));
  return (
    <>
      <h1>데모: 고치기 전과 고친 뒤</h1>
      <p className="lede">
        합성 예시입니다. 실제 서비스의 코드가 아닙니다. 코드 {apps.length}가지를 고치기 전과 고친 뒤로 나눠,{" "}
        {judgeOff && "판정자 없이 "}같은 팩으로 검사한 CLI 실제 출력을 보입니다.
      </p>
      <DemoSwitcher apps={apps} pack={packIndex} />
    </>
  );
}
