import type { Metadata } from "next";
import { DemoSwitcher } from "@/components/demo/DemoSwitcher";
import { loadDemoApps } from "@/lib/demo/load";
import { packIndex } from "@/lib/pack";

export const metadata: Metadata = { title: "데모" };

/**
 * 데모(docs/redesign.md 3장). 제목 옆에 이름표 `합성 예시`. 부제·사용법·상태 풀이 줄은 두지 않는다. 빌드할 때 합성 코드와 그
 * 결과(contract/)를 읽는다. 실행 중에는 아무것도 읽지 않는다.
 */
export default function DemoPage() {
  const apps = loadDemoApps(packIndex);
  return (
    <>
      <div className="ttl demo-head">
        <h1>데모</h1>
        <span className="tag">합성 예시</span>
      </div>
      <DemoSwitcher apps={apps} pack={packIndex} />
    </>
  );
}
