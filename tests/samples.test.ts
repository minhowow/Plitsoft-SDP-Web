import { describe, expect, it } from "vitest";
import { parseReport } from "@/lib/report/parse";
import { SAMPLES } from "@/lib/samples";

// `/view` 의 합성 예시 목록(src/lib/samples.ts). 화면은 이름과 출처를 이어 적는다: 예시 고르기의 항목은 "이름 · 출처",
// 연 것의 제목은 "이름 (출처)"다(src/components/viewer/ReportViewer.tsx).

describe("합성 예시 목록", () => {
  const option = (sample: (typeof SAMPLES)[number]) => `${sample.label} · ${sample.origin}`;
  const title = (sample: (typeof SAMPLES)[number]) => `${sample.label} (${sample.origin})`;

  it("예시마다 읽히고, id 와 화면에 적는 이름이 서로 겹치지 않는다", () => {
    expect(SAMPLES).toHaveLength(10);
    for (const sample of SAMPLES) expect(parseReport(sample.data).ok, sample.id).toBe(true);
    expect(new Set(SAMPLES.map((sample) => sample.id)).size).toBe(SAMPLES.length);
    // 같은 코드의 두 출력(CLI 실제 출력, v1 초안 예시)은 이름이 같고 출처로 갈린다.
    expect(new Set(SAMPLES.map(option)).size).toBe(SAMPLES.length);
  });

  it("이름에 출처를 다시 적지 않는다 (고르기 상자는 줄을 바꾸지 못해 좁은 화면에서 끝이 잘린다)", () => {
    // "아동 가입 · 고치기 전 (v1 초안) · v1 초안 예시"처럼 같은 말이 두 번 나오면 320px 에서 고른 항목의 끝이 잘렸다.
    // 잘리는지는 글꼴에 달려 있어 여기서 재지 않는다. 같은 말을 두 번 적지 않는다는 것만 본다.
    for (const sample of SAMPLES) {
      expect(sample.label, sample.id).not.toMatch(/v1|초안|CLI|실제 출력|예시/);
      for (const shown of [option(sample), title(sample)]) {
        expect(shown.match(/초안/g)?.length ?? 0, shown).toBe(sample.origin === "v1 초안 예시" ? 1 : 0);
      }
    }
  });

  it("v1 초안 예시는 화면에 적는 이름에 v1 초안이라고 밝힌다", () => {
    // G1 전에는 v1 초안을 `/view` 의 예시 목록에서만 쓰고, 이름으로 구분한다(docs/ROADMAP.md).
    const drafts = SAMPLES.filter((sample) => sample.id.startsWith("draft."));
    expect(drafts).toHaveLength(3);
    for (const sample of drafts) {
      expect(parseReport(sample.data)).toMatchObject({ ok: true, contract: "v1-draft" });
      expect(option(sample), sample.id).toContain("v1 초안");
      expect(title(sample), sample.id).toContain("v1 초안");
    }
    for (const sample of SAMPLES.filter((s) => !s.id.startsWith("draft."))) {
      expect(parseReport(sample.data)).toMatchObject({ ok: true, contract: "cli-0.3" });
      expect(sample.origin, sample.id).toBe("CLI 실제 출력");
    }
  });
});
