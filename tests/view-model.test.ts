import { describe, expect, it } from "vitest";
import { packMeta } from "@/lib/pack";
import { examinedFacts } from "@/lib/report/examined";
import { parseReport } from "@/lib/report/parse";
import { judgedScope } from "@/lib/report/scope";
import type { Status } from "@/lib/report/status";
import type { Finding, Report } from "@/lib/report/types";
import { buildReportView, SHOWN_PER_RULE, type PolicyView, type ReportView } from "@/lib/report/view-model";
import { jsonFiles, readJson } from "./helpers";

function viewOf(data: unknown): ReportView {
  const parsed = parseReport(data);
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return buildReportView(parsed.report, parsed.contract, packMeta);
}

function view(dir: string, file: string): ReportView {
  return viewOf(readJson("contract", dir, file));
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

describe("규칙별 묶음과 접기", () => {
  // 발견 하나의 단위는 정책 × 규칙 × 파일이다. 같은 규칙의 반복만 접고, 규칙이 다른 발견은 접어 가리지 않는다.
  const ADS = "kr.network-act.50-4";
  const repeated = () => readJson("tests", "fixtures", "repeated-rule.json") as Report;
  const ads = (v: ReportView): PolicyView => v.policies.find((p) => p.id === ADS)!;
  const group = (v: ReportView, rule: string) => ads(v).rules.find((g) => g.rule === rule)!;
  /** 발견만 바꾼 결과. */
  const withFindings = (findings: Finding[]): Report => ({ ...repeated(), findings });

  it("같은 정책의 발견을 규칙별로 묶는다. 묶음은 결과에 나온 순서(팩의 규칙 순서)다", () => {
    const v = view("cli-current", "night-push.main.json");
    expect(ads(v).rules.map((g) => g.rule)).toEqual(["nonemail-start-block", "nonemail-end-optout"]);
    expect(ads(v).rules.every((g) => g.shown.length === 1 && g.folded.length === 0)).toBe(true);
  });

  it("같은 규칙이 20개 파일에 반복되면 대표 3곳만 먼저 보이고 나머지 17곳은 접힌다", () => {
    const g = group(viewOf(repeated()), "nonemail-start-block");
    expect(new Set([...g.shown, ...g.folded].map((l) => l.file)).size).toBe(20);
    expect(SHOWN_PER_RULE).toBe(3);
    expect(g.shown).toHaveLength(3);
    expect(g.folded).toHaveLength(17);
    // 대표 위치는 파일 순서로 앞의 것이다(상태가 모두 같을 때).
    expect(g.shown.map((l) => l.file)).toEqual([
      "src/campaigns/black-friday.ts",
      "src/campaigns/chuseok-gift.ts",
      "src/campaigns/coupon-reminder.ts",
    ]);
  });

  it("대표 위치를 고르는 파일 순서는 글자 코드 순서다. 보는 사람의 언어 설정에 따라 달라지지 않는다", () => {
    // 언어 설정을 따르는 비교(localeCompare)로 고르면 같은 결과 파일인데도 대표 3곳이 사람마다 달라진다. 체코어는 "ch" 를
    // "h" 뒤의 한 글자로 치고(chuseok 이 coupon 뒤로 간다), 한국어는 한글을 로마자 앞에 둔다. 그런 비교는 어느 언어에서나
    // 소문자 "april" 을 대문자 "BlackFriday" 앞에 둔다. 글자 코드로는 대문자가 앞이다. 그래서 이 시험은 시험을 돌리는
    // 컴퓨터의 언어 설정이 무엇이든, 언어 설정을 따르는 비교가 돌아오면 실패한다.
    const same = repeated().findings.filter((f) => f.rule === "nonemail-start-block");
    const files = [
      "src/campaigns/coupon.ts",
      "src/campaigns/추석.ts",
      "src/campaigns/chuseok.ts",
      "src/campaigns/BlackFriday.ts",
      "src/campaigns/april.ts",
    ];
    const g = group(viewOf(withFindings(files.map((file, i) => ({ ...same[i], file })))), "nonemail-start-block");
    expect(g.shown.map((l) => l.file)).toEqual([
      "src/campaigns/BlackFriday.ts",
      "src/campaigns/april.ts",
      "src/campaigns/chuseok.ts",
    ]);
    expect(g.folded.map((l) => l.file)).toEqual(["src/campaigns/coupon.ts", "src/campaigns/추석.ts"]);
  });

  it("정책의 발견 목록에서 같은 파일·같은 줄의 규칙도 글자 코드 순서로 둔다", () => {
    // 위와 같은 이유다. 규칙 이름을 견줄 때도 언어 설정을 따르지 않는다.
    const [first, second] = repeated().findings;
    const { file, line } = first;
    const findings = [
      { ...first, rule: "april-rule" },
      { ...second, file, line, rule: "BlackFriday-rule" },
    ];
    expect(ads(viewOf(withFindings(findings))).locations.map((l) => l.rule)).toEqual(["BlackFriday-rule", "april-rule"]);
  });

  it("규칙이 다른 발견은 접히지 않는다", () => {
    const v = viewOf(repeated());
    expect(ads(v).locations).toHaveLength(25);
    // 20곳에 반복된 규칙 하나만 접힌다. 2곳에 나온 규칙과, 한 파일·한 줄에 함께 나온 서로 다른 세 규칙은 모두 보인다.
    expect(ads(v).rules.map((g) => [g.rule, g.shown.length, g.folded.length])).toEqual([
      ["nonemail-start-block", 3, 17],
      ["nonemail-end-optout", 2, 0],
      ["email-subject-label", 1, 0],
      ["email-body-sender", 1, 0],
      ["email-body-optout", 1, 0],
    ]);
  });

  it("한 정책의 발견이 대표 위치 수보다 많아도 규칙이 모두 다르면 접히는 것이 없다", () => {
    const onePerRule = [...new Map(repeated().findings.map((f) => [f.rule, f])).values()];
    const v = viewOf(withFindings(onePerRule));
    expect(ads(v).locations.length).toBeGreaterThan(SHOWN_PER_RULE);
    expect(ads(v).rules).toHaveLength(ads(v).locations.length);
    expect(ads(v).rules.every((g) => g.shown.length === 1 && g.folded.length === 0)).toBe(true);
  });

  it("반복이 대표 위치 수와 같으면 접지 않고, 하나 더 많으면 하나를 접는다", () => {
    const same = repeated().findings.filter((f) => f.rule === "nonemail-start-block");
    const three = group(viewOf(withFindings(same.slice(0, 3))), "nonemail-start-block");
    expect([three.shown.length, three.folded.length]).toEqual([3, 0]);
    const four = group(viewOf(withFindings(same.slice(0, 4))), "nonemail-start-block");
    expect([four.shown.length, four.folded.length]).toEqual([3, 1]);
  });

  it("먼저 봐야 할 상태가 대표 위치로 오고, 접힌 곳의 상태도 묶음의 개수에 들어간다", () => {
    // 파일 순서대로라면 접힌 곳에 들어갈 두 곳을 서로 다른 상태로 바꾼다.
    const changes: Record<string, Partial<Finding>> = {
      "src/campaigns/winter-sale.ts": { ai_pending: [], untested_reasons: [] },
      "src/campaigns/weekend-deal.ts": { outcome: "needs-review-uncertain" },
    };
    const findings = repeated().findings.map((f) =>
      f.rule === "nonemail-start-block" ? { ...f, ...changes[f.file] } : f,
    );
    const g = group(viewOf(withFindings(findings)), "nonemail-start-block");
    expect(g.status).toBe("needs-review");
    expect(g.shown[0]).toMatchObject({ file: "src/campaigns/winter-sale.ts", status: "needs-review" });
    expect(g.folded.at(-1)).toMatchObject({ file: "src/campaigns/weekend-deal.ts", status: "uncertain" });
    expect(g.counts).toEqual([
      { status: "needs-review", count: 1 },
      { status: "needs-review-ai-pending", count: 18 },
      { status: "uncertain", count: 1 },
    ]);
  });

  it("같은 파일에 같은 규칙의 발견이 여럿이면(함수 단위 판정) 줄 순서로 둔다", () => {
    // 결과에는 18행, 44행, 3행 순서로 실려 있다. 화면에서는 파일, 줄 순서다.
    const v = viewOf(readJson("tests", "fixtures", "uncommon-shapes.json"));
    const place = (l: { file: string; line: number | null }) => `${l.file}:${l.line}`;
    const g = group(v, "nonemail-start-block");
    expect(g.shown.map(place)).toEqual([
      "src/jobs/weekly-digest.ts:7",
      "src/notifications/promo.ts:3",
      "src/notifications/promo.ts:18",
    ]);
    expect(g.folded.map(place)).toEqual(["src/notifications/promo.ts:44"]);
    expect(ads(v).locations.map(place)).toEqual([
      "src/jobs/weekly-digest.ts:7",
      "src/legacy/blast.js:null",
      "src/legacy/notify.js:9",
      "src/mail/weekly.ts:4",
      "src/notifications/promo.ts:3",
      "src/notifications/promo.ts:18",
      "src/notifications/promo.ts:44",
    ]);
  });

  it("먼저 봐야 할 묶음이 위에 온다", () => {
    const findings = repeated().findings.map((f) =>
      f.rule === "email-body-optout" ? { ...f, ai_pending: [], untested_reasons: [] } : f,
    );
    expect(ads(viewOf(withFindings(findings))).rules.map((g) => g.rule)).toEqual([
      "email-body-optout",
      "nonemail-start-block",
      "nonemail-end-optout",
      "email-subject-label",
      "email-body-sender",
    ]);
  });

  const every: string[][] = [
    ...jsonFiles("contract", "cli-current").map((f) => ["contract", "cli-current", f]),
    ...jsonFiles("contract", "samples-v1-draft").map((f) => ["contract", "samples-v1-draft", f]),
    ...jsonFiles("tests", "fixtures").map((f) => ["tests", "fixtures", f]),
  ];

  it.each(every.map((parts) => [parts.join("/"), parts] as const))(
    "%s: 묶으면서 발견을 잃거나 겹치지 않는다",
    (_name, parts) => {
      const data = readJson(...parts) as Report;
      const v = viewOf(data);
      const grouped = v.policies.flatMap((p) => p.rules.flatMap((g) => [...g.shown, ...g.folded]));
      expect(grouped.map((l) => l.fingerprint).sort()).toEqual(data.findings.map((f) => f.fingerprint).sort());
      for (const policy of v.policies) {
        for (const g of policy.rules) {
          expect([...g.shown, ...g.folded].every((l) => l.rule === g.rule)).toBe(true);
          expect(g.counts.reduce((sum, c) => sum + c.count, 0)).toBe(g.shown.length + g.folded.length);
        }
      }
    },
  );
});

describe("판정이 본 범위", () => {
  // CLI 가 낸 scope, region, top_level 을 그대로 옮긴다. 결과에 없는 것은 짐작하지 않는다.
  const base = (readJson("contract", "cli-current", "kids-signup.main.json") as Report).findings[0];
  const scope = (patch: Partial<Finding>) => judgedScope({ ...base, ...patch });

  it("파일 단위 규칙은 파일 전체다", () => {
    expect(judgedScope(base)).toEqual({ kind: "file" });
    // 파일 단위에는 구역이 없다. 엉뚱한 값이 함께 실려 있어도 파일 전체로 본다.
    expect(scope({ scope: "file", top_level: true })).toEqual({ kind: "file" });
  });

  it("함수 단위 규칙은 구역이 셋으로 갈린다", () => {
    expect(scope({ scope: "anchor", region: { start_line: 3, end_line: 21 }, top_level: false })).toEqual({
      kind: "function",
      startLine: 3,
      endLine: 21,
    });
    expect(scope({ scope: "anchor", region: null, top_level: true })).toEqual({ kind: "top-level" });
    expect(scope({ scope: "anchor", region: null, top_level: false })).toEqual({ kind: "file" });
  });

  it("함수 단위인데 구역도 top_level 도 없으면 알 수 없음이다", () => {
    expect(scope({ scope: "anchor", region: null, top_level: undefined })).toEqual({ kind: "unknown" });
  });

  it("수집본의 발견은 모두 파일 전체 판정이다 (kr-core 의 규칙은 지금 모두 파일 단위)", () => {
    for (const file of jsonFiles("contract", "cli-current")) {
      const v = view("cli-current", file);
      const scopes = v.policies.flatMap((p) => p.locations.map((l) => l.scope.kind));
      expect(scopes.every((kind) => kind === "file"), file).toBe(true);
    }
  });

  it("화면 구조의 발견마다 범위가 실린다", () => {
    const v = viewOf(readJson("tests", "fixtures", "uncommon-shapes.json"));
    const kinds = v.policies.flatMap((p) => p.locations.map((l) => `${l.file}:${l.line} ${l.scope.kind}`));
    expect(kinds).toEqual([
      "src/jobs/weekly-digest.ts:7 file",
      "src/legacy/blast.js:null file",
      "src/legacy/notify.js:9 file",
      "src/mail/weekly.ts:4 unknown",
      "src/notifications/promo.ts:3 top-level",
      "src/notifications/promo.ts:18 function",
      "src/notifications/promo.ts:44 function",
    ]);
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

describe("빈 결과에서 아는 것과 모르는 것", () => {
  // 발견이 0일 때 화면에 적을 수 있는 것은 결과에 실린 수뿐이다. 실려 있지 않은 것은 null 로 두고 짐작하지 않는다.
  const unitsOf = (v: ReportView) => Object.fromEntries(v.policies.map((p) => [p.id, p.units]));
  const fact = (v: ReportView, label: string) => examinedFacts(v).find((f) => f.label === label)!;

  it("v1 초안: 정책별 판정 단위 수를 요약에서 그대로 옮긴다", () => {
    const fixed = view("samples-v1-draft", "kids-signup.fixed.json");
    expect(unitsOf(fixed)).toEqual({
      "kr.pipa.22-2": 1,
      "kr.network-act.50-3": 0,
      "kr.ai-basic-act.31": 0,
      "kr.ai-basic-act.31-1": 0,
      "kr.network-act.50-4": 0,
    });
    expect(Object.values(unitsOf(view("samples-v1-draft", "plain.main.json")))).toEqual([0, 0, 0, 0, 0]);
    // 정책 수는 결과에 실린 요약의 수다.
    expect(fixed.policyCount).toBe(5);
  });

  it("CLI 0.3: 정책별 판정 단위 수는 모른다. 전체 수가 0이든 1이든 짐작해 채우지 않는다", () => {
    const plain = view("cli-current", "plain.main.json");
    const fixed = view("cli-current", "kids-signup.fixed.json");
    expect([plain.coverage.units, fixed.coverage.units]).toEqual([0, 1]);
    for (const v of [plain, fixed]) {
      expect(Object.values(unitsOf(v))).toEqual([null, null, null, null, null]);
      expect(v.policies.every((p) => p.status === "not-reported")).toBe(true);
      // 결과에는 정책 목록이 없다. 팩 판이 같은 이 사이트의 팩에서 센다.
      expect(v.packMatches).toBe(true);
      expect(v.policyCount).toBe(packMeta.policies.length);
    }
  });

  it("판 번호 없는 결과의 run.policies 는 쓰지 않는다 (정책별 수도, 정책 수도)", () => {
    const data = readJson("contract", "cli-current", "kids-signup.fixed.json") as Report;
    const draft = readJson("contract", "samples-v1-draft", "kids-signup.fixed.json") as Report;
    const policies = draft.run.policies!.slice(0, 2);
    const v = viewOf({ ...data, run: { ...data.run, policies } });
    expect(v.contract).toBe("cli-0.3");
    expect(Object.values(unitsOf(v))).toEqual([null, null, null, null, null]);
    expect(v.policies.every((p) => p.evidence.length === 0)).toBe(true);
    expect(v.policyCount).toBe(packMeta.policies.length);
  });

  it("팩 판이 다르거나 팩 메타데이터가 없으면 정책 수를 모른다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const other = viewOf({ ...data, run: { ...data.run, pack_digest: "0000000000000000" } });
    expect(other.policyCount).toBeNull();
    expect(fact(other, "정책").note).toContain("팩 판이 이 사이트에 실린 팩과 달라");

    const parsed = parseReport(data);
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    const bare = buildReportView(parsed.report, parsed.contract);
    expect(bare.packMatches).toBeNull();
    expect(bare.policyCount).toBeNull();
    expect(fact(bare, "정책")).toEqual({
      label: "정책",
      value: "알 수 없음",
      note: "결과에는 정책 목록이 없어 어떤 정책으로 검사했는지 알 수 없습니다.",
      warn: false,
    });
  });

  it("v1 초안은 팩 판이 달라도 결과에 실린 요약으로 정책 수를 안다 (사이트의 팩에서 세지 않는다)", () => {
    const data = readJson("contract", "samples-v1-draft", "plain.main.json") as Report;
    // 이 사이트의 팩(정책 5개)과 수가 다른 요약을 넣어 본다.
    const policies = data.run.policies!.slice(0, 3);
    const v = viewOf({ ...data, run: { ...data.run, pack_digest: "0000000000000000", policies } });
    expect(v.packMatches).toBe(false);
    expect(packMeta.policies).toHaveLength(5);
    expect(v.policyCount).toBe(3);
    expect(fact(v, "정책")).toMatchObject({ value: "3개", note: "결과에 정책별 요약이 실려 있어, 아래에 정책마다 적었습니다." });
    // 카드도 그 셋뿐이다. 이 사이트의 팩에만 있는 정책을 "알 수 없음"으로 채워 넣지 않는다.
    expect(v.policies.map((p) => p.id)).toEqual(policies.map((p) => p.policy));
    expect(v.policies.every((p) => p.units !== null && p.status === "no-signal")).toBe(true);
  });

  it("v1 초안: 카드는 결과에 나온 정책뿐이다 (요약, 발견, AI 가 푼 경고). 순서는 이 사이트의 팩을 먼저 따른다", () => {
    const data = readJson("contract", "samples-v1-draft", "plain.main.json") as Report;
    const all = data.run.policies!;
    const ids = (run: Partial<Report["run"]>) => viewOf({ ...data, run: { ...data.run, ...run } }).policies.map((p) => p.id);
    const pack = packMeta.policies.map((p) => p.id);
    expect(ids({})).toEqual(pack);

    // 요약이 일부뿐이면 그만큼만. 요약에 적힌 순서가 달라도 팩의 순서로 둔다.
    expect(ids({ policies: [all[3], all[0]] })).toEqual([pack[0], pack[3]]);
    // 요약이 비면 카드가 없다.
    const none = viewOf({ ...data, run: { ...data.run, policies: [] } });
    expect(none.policies).toEqual([]);
    expect(none.policyCount).toBe(0);
    expect(fact(none, "정책")).toMatchObject({ value: "0개", warn: true });
    // 이 사이트의 팩에 없는 정책은 뒤에 붙는다.
    const other = { policy: "kr.other.99", units: 0, needs_review: 0, uncertain: 0, compliant: 0, evidence: [] };
    expect(ids({ policies: [other, all[1]] })).toEqual([pack[1], "kr.other.99"]);

    // 요약에 없어도 발견이나 AI 가 푼 경고에 나온 정책은 카드가 있다. 그 카드에는 정책별 수가 없다.
    const [finding] = (readJson("contract", "samples-v1-draft", "kids-signup.main.json") as Report).findings;
    const [cleared] = (readJson("tests", "fixtures", "judge-on.cleared.json") as Report).run.ai_cleared!;
    expect(finding.policy).toBe(pack[0]);
    expect(cleared.policy).toBe(pack[0]);
    const found = viewOf({ ...data, findings: [finding], run: { ...data.run, policies: [all[1]] } });
    expect(found.policies.map((p) => [p.id, p.units])).toEqual([[pack[0], null], [pack[1], 0]]);
    const freed = viewOf({ ...data, run: { ...data.run, policies: [all[1]], ai_cleared: [cleared] } });
    expect(freed.policies.map((p) => [p.id, p.units])).toEqual([[pack[1], 0], [pack[0], null]]);
    expect(freed.policyCount).toBe(1);
    expect(fact(freed, "정책").note).toContain("요약에 없는 정책 1개도 아래에 있습니다.");
  });

  it("CLI 0.3: 카드는 이 사이트의 팩에 실린 정책 전부다 (결과에 정책 목록이 없어서 팩에서 채운다)", () => {
    for (const file of jsonFiles("contract", "cli-current")) {
      expect(view("cli-current", file).policies.map((p) => p.id).sort(), file).toEqual(packMeta.policies.map((p) => p.id).sort());
    }
  });

  it("빠진 판정이 없었다는 것은 판정자가 꺼져 있었거나 결과에 그 목록이 실려 있을 때만 안다", () => {
    const data = readJson("contract", "cli-current", "plain.main.json") as Report;
    const known = (run: Partial<Report["run"]>) => viewOf({ ...data, run }).aiDismissedKnown;
    const without: Partial<Report["run"]> = { ...data.run };
    delete without.ai_dismissed;
    expect(known(data.run)).toBe(true);
    expect(known(without)).toBe(true);
    expect(known({ ...without, judge: "claude-cli:haiku" })).toBe(false);
    expect(known({ ...data.run, judge: "claude-cli:haiku" })).toBe(true);
    expect(view("../tests/fixtures", "judge-on.dismissed.json").aiDismissedKnown).toBe(true);
  });

  it("검사한 것은 파일 수, 판정 단위 수, 검사하지 않은 파일, 정책 순서다", () => {
    const facts = examinedFacts(view("cli-current", "kids-signup.fixed.json"));
    expect(facts.map((f) => [f.label, f.value, f.warn])).toEqual([
      ["검사한 파일", "1개", false],
      ["판정 단위", "1개", false],
      ["검사하지 않은 파일", "없음", false],
      ["정책", "5개", false],
    ]);
  });
});
