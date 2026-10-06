import { describe, expect, it } from "vitest";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import type { Status } from "@/lib/report/status";
import { buildReportView, type ReportView } from "@/lib/report/view-model";
import { readJson } from "./helpers";

function view(dir: string, file: string): ReportView {
  const parsed = parseReport(readJson("contract", dir, file));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

function statusOf(v: ReportView, policy: string): Status | undefined {
  return v.policies.find((p) => p.id === policy)?.status;
}

describe("현재 CLI 출력으로 만든 화면 구조", () => {
  it("아동 가입 고치기 전: 검토 필요이고 AI 확인 전이다 (판단 보류가 아니다)", () => {
    const v = view("cli-current", "kids-signup.main.json");
    expect(statusOf(v, "kr.pipa.22-2")).toBe("needs-review-ai-pending");
    expect(v.findingCount).toBe(1);
    // 가장 먼저 봐야 할 정책이 맨 위에 온다.
    expect(v.policies[0].id).toBe("kr.pipa.22-2");
  });

  it("아동 가입 고친 뒤: 발견이 없고, 충족인지 미적용인지는 지금 출력으로 알 수 없다", () => {
    const v = view("cli-current", "kids-signup.fixed.json");
    expect(v.findingCount).toBe(0);
    expect(statusOf(v, "kr.pipa.22-2")).toBe("not-reported");
  });

  it("약한 근거만 있는 대안은 판단 보류로 남는다", () => {
    const v = view("cli-current", "night-push.fixed.json");
    expect(statusOf(v, "kr.network-act.50-3")).toBe("uncertain");
  });

  it("같은 정책의 발견은 정책 하나 아래 위치 목록으로 묶인다", () => {
    const v = view("cli-current", "night-push.main.json");
    const policy = v.policies.find((p) => p.id === "kr.network-act.50-4");
    expect(policy?.locations.length).toBe(2);
    expect(v.policies.filter((p) => p.id === "kr.network-act.50-4").length).toBe(1);
  });

  it("팩의 정책은 발견이 없어도 모두 나온다", () => {
    const v = view("cli-current", "plain.main.json");
    expect(v.policies.map((p) => p.id).sort()).toEqual(packMeta.policies.map((p) => p.id).sort());
    expect(v.policies.every((p) => p.status === "not-reported")).toBe(true);
  });

  it("결과와 팩 메타데이터의 판이 같으면 packMatches 가 참이다", () => {
    expect(view("cli-current", "plain.main.json").packMatches).toBe(true);
  });
});

describe("다른 판의 팩으로 만든 결과", () => {
  function withOtherPack(file: string): ReportView {
    const data = readJson("contract", "cli-current", file) as { run: Record<string, unknown> };
    const parsed = parseReport({ ...data, run: { ...data.run, pack_digest: "0000000000000000" } });
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return buildReportView(parsed.report, parsed.contract, packMeta);
  }

  it("발견이 없는 정책을 '발견 없음'이라고 하지 않는다", () => {
    const v = withOtherPack("night-push.main.json");
    expect(v.packMatches).toBe(false);
    expect(statusOf(v, "kr.network-act.50-4")).toBe("needs-review-ai-pending");
    expect(statusOf(v, "kr.pipa.22-2")).toBe("pack-unknown");
    expect(v.policies.some((p) => p.status === "not-reported")).toBe(false);
  });
});

describe("판정자를 켠 결과 (손으로 만든 시험용 자료)", () => {
  it("AI 가 푼 경고는 화면 구조에 남는다", () => {
    const v = view("../tests/fixtures", "judge-on.cleared.json");
    expect(v.judge).toBe("claude-cli:haiku");
    expect(v.aiCleared).toHaveLength(1);
    expect(v.policies.find((p) => p.id === "kr.pipa.22-2")?.aiCleared).toBe(1);
  });

  it("인용이 거절된 답은 판정에 넣지 않으므로 검토 필요가 그대로 남는다", () => {
    const v = view("../tests/fixtures", "judge-on.citation-rejected.json");
    expect(statusOf(v, "kr.pipa.22-2")).toBe("needs-review-ai-pending");
  });

  it("적용 질문으로 빠진 판정도 남는다", () => {
    expect(view("../tests/fixtures", "judge-on.dismissed.json").aiDismissed).toHaveLength(1);
  });
});

describe("v1 초안으로 만든 화면 구조", () => {
  it("충족 근거 위치가 있으면 충족 근거 발견이다", () => {
    const v = view("samples-v1-draft", "kids-signup.fixed.json");
    expect(statusOf(v, "kr.pipa.22-2")).toBe("evidence-found");
    expect(v.policies.find((p) => p.id === "kr.pipa.22-2")?.evidence[0]).toMatchObject({
      file: "src/auth/signup.ts",
      alternative: "under14-branch",
    });
  });

  it("판정 단위가 0인 정책은 적용 신호 없음이다", () => {
    const v = view("samples-v1-draft", "plain.main.json");
    expect(v.policies.every((p) => p.status === "no-signal")).toBe(true);
  });
});
