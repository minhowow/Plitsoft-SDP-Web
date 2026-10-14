"use client";

import { useEffect, useState } from "react";
import type { DemoApp } from "@/lib/demo/apps";
import type { PackIndex } from "@/lib/pack/types";
import { documentWasRestored, startAtTop } from "@/lib/scroll";
import { DemoPanel } from "./DemoPanel";

interface Picked {
  app: string;
  variant: string;
}

/**
 * 이 탭에서 가장 나중에 고른 앱과 판. 다른 쪽(조문 도감 등)에 다녀오면 이 부품이 새로 붙는데, 그때 이것을 되살린다.
 *
 * 되살리지 않으면, 정책 카드의 링크를 눌렀다가 뒤로 왔을 때 첫 앱의 고치기 전이 열려 있다. 브라우저가 스크롤 자리는
 * 되살리므로, 보던 것과 다른 앱의 결과 한가운데에 놓인다(결과 뷰어의 `kept` 와 같은 까닭이다).
 *
 * 메모리에만 둔다(docs/commitments.md 의 1층). 브라우저 저장소에 쓰지 않으므로 새로 고치면 첫 앱으로 돌아간다.
 */
let kept: Picked | null = null;

/**
 * 합성 데모 앱들의 고치기 전·후를 오가며 본다. 코드와 결과는 쪽(서버 부품)이 빌드할 때 읽어 화면 구조로 만들어
 * 넘긴 것이다. 여기서는 고르기만 한다. 판을 바꿔도 요청을 내보내지 않는다.
 *
 * `pack` 은 쪽이 골라 넘긴 팩 정보다(`packIndex`). 판마다의 조문별 검사 기록이 대표 조문의 시행일과 원문 해시를 여기서
 * 얻는다.
 */
export function DemoSwitcher({ apps, pack }: { apps: DemoApp[]; pack: PackIndex }) {
  // 되살릴 것이 있는 채로 붙었는지. 처음 그릴 때 정해 둔다(`kept` 는 붙은 뒤에 곧 채워진다).
  const [hadKept] = useState(() => kept !== null);
  const [picked, setPicked] = useState<Picked>(() => kept ?? { app: apps[0].key, variant: apps[0].variants[0].key });
  const app = apps.find((a) => a.key === picked.app) ?? apps[0];
  const variant = app.variants.find((v) => v.key === picked.variant) ?? app.variants[0];

  useEffect(() => {
    kept = picked;
  }, [picked]);

  // 새로 고치거나 뒤로·앞으로 가기로 문서를 다시 받았는데 되살릴 것이 없으면(첫 앱으로 시작한다) 맨 위에서 시작한다.
  // 브라우저는 앞서 보던 스크롤 자리를 되살리는데, 그대로 두면 보던 것과 다른 앱의 결과 한가운데에 놓인다.
  // 처음 찾아온 문서에서는 하지 않는다. 스크립트가 늦게 붙는 동안 읽어 내려간 사람을 맨 위로 끌어올리게 된다.
  useEffect(() => {
    if (hadKept || !documentWasRestored()) return undefined;
    return startAtTop();
  }, [hadKept]);

  return (
    <div className="demo">
      <div className="demo-pick">
        <div className="segmented" role="group" aria-label="데모 코드 고르기">
          {apps.map((a) => (
            <button
              key={a.key}
              type="button"
              aria-pressed={a.key === app.key}
              // 앱을 바꿔도 보던 판(고치기 전·후)은 그대로 둔다.
              onClick={() => setPicked({ app: a.key, variant: variant.key })}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="고치기 전과 고친 뒤 고르기">
          {app.variants.map((v) => (
            <button
              key={v.key}
              type="button"
              aria-pressed={v.key === variant.key}
              onClick={() => setPicked({ app: app.key, variant: v.key })}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* 판마다 새로 만든다(key). 한 판에서 여닫은 발견 줄의 상태가 다른 판의 발견으로 넘어가지 않게 한다. */}
      <DemoPanel key={`${app.key}.${variant.key}`} app={app} variant={variant} pack={pack} />
    </div>
  );
}
