import { existsSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import type { Report } from "@/lib/report/types";
import { buildReportView } from "@/lib/report/view-model";
import { jsonFiles, readJson, root, sarifFiles } from "./helpers";

// CLI 와 웹 사이의 이음매를 지킨다.
// 실패하면: CLI 출력이 바뀌었거나(npm run capture 뒤라면), 스키마·타입·파서 가운데 하나만 고친 것이다.

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(readJson("contract", "schema", "report.cli-0.3.schema.json") as object);
const validateCurrent = ajv.getSchema("report.cli-0.3.schema.json")!;
const validateDraft = ajv.compile(readJson("contract", "schema", "report.v1-draft.schema.json") as object);
const validateSarif = ajv.compile(readJson("contract", "schema", "sarif.cli-0.3.schema.json") as object);

const captures = jsonFiles("contract", "cli-current");
// SARIF 수집본. 같은 이름의 JSON 수집본과 같은 검사에서 나온 것이다(수집 스크립트가 같은 표본을 두 형식으로 받는다).
const sarifCaptures = sarifFiles("contract", "cli-current");
const drafts = jsonFiles("contract", "samples-v1-draft");
// 시험용 자료. 수집본이 아니지만 같은 스키마를 통과해야 한다. 두 가지가 있다(파일마다 $comment 에 적혀 있다).
//  - 손으로 만든 것(판정자를 켠 결과 등). 실제 CLI 출력이 아니다.
//  - 합성 폴더를 검사한 CLI 출력에 엔진 오류만 흉내 낸 것(incomplete-coverage.json. 엔진 출력에 시간 초과를 끼워 넣었다).
const testData = jsonFiles("tests", "fixtures");

describe("현재 CLI 출력 (contract/cli-current)", () => {
  it("수집본이 있다", () => {
    expect(captures.length).toBeGreaterThan(0);
  });

  it.each(captures)("%s 가 cli-0.3 스키마를 통과한다", (file) => {
    const data = readJson("contract", "cli-current", file);
    validateCurrent(data);
    expect(validateCurrent.errors ?? []).toEqual([]);
  });

  it.each(captures)("%s 를 파서가 cli-0.3 으로 읽는다", (file) => {
    const result = parseReport(readJson("contract", "cli-current", file));
    expect(result).toMatchObject({ ok: true, contract: "cli-0.3" });
  });

  it.each(captures)("%s 의 발견이 가리키는 파일이 표본 폴더에 있다", (file) => {
    // 수집을 git 저장소 안에서 돌리면 CLI 가 경로 기준을 저장소 루트로 잡아 file 과 지문이 달라진다.
    // 수집 스크립트가 표본을 저장소 밖으로 복사해 검사하는 것이 깨지면 여기서 잡힌다.
    const [app, variant] = file.replace(/\.json$/, "").split(".");
    const report = readJson("contract", "cli-current", file) as Report;
    for (const finding of report.findings) {
      const target = path.join(root, "contract", "fixtures", app, variant, finding.file);
      expect(existsSync(target), `${file}: ${finding.file}`).toBe(true);
    }
  });

  it("MANIFEST 가 수집본 전부를 적고 있다", () => {
    const manifest = readJson("contract", "cli-current", "MANIFEST.json") as { files: { file: string }[] };
    expect(manifest.files.map((f) => f.file).sort()).toEqual(captures);
  });
});

describe("현재 CLI 의 SARIF 출력 (contract/cli-current 의 .sarif)", () => {
  // 웹은 SARIF 를 결과 JSON 의 모양으로 옮겨 읽는다(src/lib/report/sarif.ts). 스키마·타입·파서가 함께 맞아야 한다.
  type Sarif = { runs: Record<string, unknown>[] } & Record<string, unknown>;
  const read = (file: string) => readJson("contract", "cli-current", file) as Sarif;
  const converted = (file: string): Report => {
    const parsed = parseReport(read(file));
    if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
    return parsed.report;
  };

  it("수집본이 있고, 같은 검사의 JSON 수집본이 곁에 있다", () => {
    expect(sarifCaptures).toEqual(["kids-signup.main.sarif"]);
    for (const file of sarifCaptures) expect(captures).toContain(file.replace(/\.sarif$/, ".json"));
  });

  it.each(sarifCaptures)("%s 가 SARIF 스키마를 통과한다", (file) => {
    validateSarif(read(file));
    expect(validateSarif.errors ?? []).toEqual([]);
  });

  it.each(sarifCaptures)("%s 를 파서가 sarif 로 읽는다", (file) => {
    expect(parseReport(read(file))).toMatchObject({ ok: true, contract: "sarif" });
  });

  it.each(sarifCaptures)("%s 를 옮긴 결과는 판정 단위 수만 채우면 cli-0.3 스키마를 통과한다", (file) => {
    // 옮긴 결과는 결과 JSON 과 같은 모양이다. 다른 것은 SARIF 에 없는 판정 단위 수(null)뿐이다. 0 으로 채우지 않는다.
    const report = converted(file);
    expect(report.run.units).toBeNull();
    expect("files" in report.run).toBe(false);
    expect(validateCurrent(report)).toBe(false);
    validateCurrent({ ...report, run: { ...report.run, units: 0 } });
    expect(validateCurrent.errors ?? []).toEqual([]);
  });

  it.each(sarifCaptures)("%s 에 실린 것은 같은 검사의 JSON 과 값이 같다", (file) => {
    const report = converted(file);
    const json = readJson("contract", "cli-current", file.replace(/\.sarif$/, ".json")) as Report;
    expect(report.tool).toEqual(json.tool);
    // SARIF 에 없는 것: 판정 단위 수, 검사한 파일 수. 웹이 읽지 않는 것(질문 수, 실행 시간)은 옮기지 않는다.
    expect(Object.keys(report.run).sort()).toEqual([
      "ai_cleared",
      "ai_dismissed",
      "ai_pending",
      "coverage_complete",
      "engine",
      "engine_errors",
      "incomplete",
      "judge",
      "pack_digest",
      "skipped",
      "units",
      "unparsed",
    ]);
    for (const key of Object.keys(report.run) as (keyof Report["run"])[]) {
      if (key !== "units") expect(report.run[key], key).toEqual(json.run[key]);
    }
    // 발견: 옮긴 필드는 모두 JSON 과 같다. top_level 은 SARIF 에 없어서 싣지 않는다.
    expect(report.findings).toHaveLength(json.findings.length);
    report.findings.forEach((finding, i) => {
      expect(Object.keys(finding).sort()).toEqual([
        "ai_pending",
        "ask_developer",
        "decision_path",
        "file",
        "fingerprint",
        "law",
        "line",
        "outcome",
        "policy",
        "region",
        "rule",
        "scope",
        "title",
        "unsatisfied_alternatives",
        "untested_reasons",
      ]);
      expect(json.findings[i]).toMatchObject(finding);
    });
  });

  describe("파서와 스키마가 같은 것을 거부한다", () => {
    const base = () => read("kids-signup.main.sarif");
    const run = (data: Sarif) => data.runs[0] as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    const broken: [string, (data: Sarif) => void][] = [
      ["다른 판의 SARIF", (d) => void (d.version = "2.0.0")],
      ["run 이 둘", (d) => void d.runs.push(d.runs[0])],
      ["run 이 없음", (d) => void (d.runs = [])],
      ["run 이 객체가 아님", (d) => void (d.runs = [null as unknown as Sarif["runs"][number]])],
      ["팩 판이 없음 (다른 도구의 SARIF)", (d) => void delete run(d).invocations[0].properties.packDigest],
      ["invocations 가 없음", (d) => void delete run(d).invocations],
      ["판정자가 없음", (d) => void delete run(d).invocations[0].properties.judge],
      ["coverageComplete 가 참·거짓이 아님", (d) => void (run(d).invocations[0].properties.coverageComplete = "true")],
      ["알림 목록이 없음", (d) => void delete run(d).invocations[0].toolExecutionNotifications],
      ["알림에 id 가 없음", (d) => void delete run(d).invocations[0].toolExecutionNotifications[0].descriptor],
      ["도구 이름이 없음", (d) => void delete run(d).tool.driver.name],
      ["규칙 목록이 없음", (d) => void delete run(d).tool.driver.rules],
      ["규칙에 제목이 없음", (d) => void delete run(d).tool.driver.rules[0].shortDescription],
      ["엔진 이름이 없음", (d) => void delete run(d).tool.extensions[0].name],
      ["results 가 없음", (d) => void delete run(d).results],
      ["ruleId 에 '/' 가 없음", (d) => void (run(d).results[0].ruleId = "kr.pipa.22-2")],
      ["ruleId 에 '/' 가 둘", (d) => void (run(d).results[0].ruleId = "kr/pipa/guard")],
      ["위치가 없음", (d) => void (run(d).results[0].locations = [])],
      ["줄이 없음", (d) => void delete run(d).results[0].locations[0].physicalLocation.region],
      ["줄이 정수가 아님", (d) => void (run(d).results[0].locations[0].physicalLocation.region.startLine = "5")],
      ["contextRegion 에 끝 줄이 없음", (d) => void (run(d).results[0].locations[0].physicalLocation.contextRegion = { startLine: 3 })],
      ["지문이 없음", (d) => void (run(d).results[0].partialFingerprints = {})],
      ["properties 가 없음", (d) => void delete run(d).results[0].properties],
      ["모르는 판정 값", (d) => void (run(d).results[0].properties.outcome = "compliant")],
      ["모르는 scope", (d) => void (run(d).results[0].properties.scope = "function")],
      ["판정 경로가 문자열 배열이 아님", (d) => void (run(d).results[0].properties.decisionPath = "적용: 정적 true")],
      ["대안에 value 가 없음", (d) => void delete run(d).results[0].properties.unsatisfiedAlternatives[0].value],
      ["모양이 다른 aiCleared", (d) => void (run(d).invocations[0].properties.aiCleared = [{ policy: 1 }])],
    ];

    it("고치지 않은 수집본은 둘 다 받아들인다", () => {
      expect(parseReport(base()).ok).toBe(true);
      expect(validateSarif(base())).toBe(true);
    });

    it.each(broken)("%s", (_name, mutate) => {
      const data = base();
      mutate(data);
      expect(validateSarif(data), "스키마").toBe(false);
      const parsed = parseReport(data);
      expect(parsed.ok, "파서").toBe(false);
      // 까닭이 한 줄 이상 있고, 빈 문장이 아니다.
      if (!parsed.ok) expect(parsed.errors.every((error) => error.length > 10) && parsed.errors.length > 0).toBe(true);
    });

    it("스키마로 적을 수 없어 파서만 보는 것", () => {
      // 제목과 질문은 규칙 목록에서 가져온다. ruleId 와 같은 규칙이 없으면 지어낼 수 없으므로 읽지 않는다.
      const orphan = base();
      run(orphan).tool.driver.rules = [];
      expect(validateSarif(orphan)).toBe(true);
      const parsed = parseReport(orphan);
      expect(parsed).toMatchObject({ ok: false });
      if (!parsed.ok) expect(parsed.errors).toEqual(["runs[0].results[0].ruleId 와 같은 규칙이 tool.driver.rules 에 없습니다."]);

      // 다 보지 못한 파일의 알림에 파일이 없으면 어느 파일인지 알 수 없다. 목록에서 빼고 넘어가지 않는다.
      const noFile = base();
      run(noFile).invocations[0].toolExecutionNotifications.push({ descriptor: { id: "policypack/skipped" } });
      expect(validateSarif(noFile)).toBe(true);
      expect(parseReport(noFile).ok).toBe(false);
      const noText = base();
      run(noText).invocations[0].toolExecutionNotifications.push({ descriptor: { id: "policypack/engine-error" } });
      expect(validateSarif(noText)).toBe(true);
      expect(parseReport(noText).ok).toBe(false);
    });
  });
});

describe("v1 초안 예시 (contract/samples-v1-draft)", () => {
  it.each(drafts)("%s 가 v1 초안 스키마를 통과한다", (file) => {
    const data = readJson("contract", "samples-v1-draft", file);
    validateDraft(data);
    expect(validateDraft.errors ?? []).toEqual([]);
  });

  it.each(drafts)("%s 를 파서가 v1-draft 로 읽는다", (file) => {
    const result = parseReport(readJson("contract", "samples-v1-draft", file));
    expect(result).toMatchObject({ ok: true, contract: "v1-draft" });
  });

  it("현재 출력은 v1 초안 스키마를 통과하지 못한다 (아직 CLI 가 내지 않는 필드가 있다)", () => {
    expect(validateDraft(readJson("contract", "cli-current", captures[0]))).toBe(false);
  });

  it.each(drafts)("%s 의 정책별 요약이 팩의 모든 정책을 한 줄씩 담고 있다", (file) => {
    // 스키마의 약속이다(run.policies 는 팩의 모든 정책마다 한 줄). 화면은 이것을 믿고 v1 초안에서는 결과에 나온
    // 정책만 카드로 그린다(src/lib/report/view-model.ts). 예시의 팩 판은 이 사이트의 팩과 같다(아래에서 본다).
    const report = readJson("contract", "samples-v1-draft", file) as Report;
    expect(report.run.policies!.map((p) => p.policy).sort()).toEqual(packMeta.policies.map((p) => p.id).sort());
  });
});

describe("시험용 자료 (tests/fixtures: 손으로 만든 것과, CLI 출력에 엔진 오류를 흉내 낸 것)", () => {
  it.each(testData)("%s 가 cli-0.3 스키마를 통과하고 파서가 읽는다", (file) => {
    const data = readJson("tests", "fixtures", file);
    validateCurrent(data);
    expect(validateCurrent.errors ?? []).toEqual([]);
    expect(parseReport(data)).toMatchObject({ ok: true, contract: "cli-0.3" });
  });
});

describe("결과와 팩 메타데이터가 같은 팩 판에서 나왔다", () => {
  // 어긋나면 npm run capture 와 npm run pack-meta 를 같은 CLI 판으로 다시 돌린다.
  it.each(captures)("%s 의 pack_digest 가 data/pack-meta.json 과 같다", (file) => {
    const report = readJson("contract", "cli-current", file) as Report;
    expect(report.run.pack_digest).toBe(packMeta.pack.digest);
  });

  it.each(drafts)("v1 초안 예시 %s 의 pack_digest 도 같다", (file) => {
    // 초안 예시는 수집본에서 손으로 만든 것이라 다시 수집해도 따라오지 않는다. 어긋나면 예시를 다시 만든다.
    const report = readJson("contract", "samples-v1-draft", file) as Report;
    expect(report.run.pack_digest).toBe(packMeta.pack.digest);
  });

  it("발견에 나온 정책이 모두 팩 메타데이터에 있다", () => {
    const known = new Set(packMeta.policies.map((p) => p.id));
    for (const file of captures) {
      const report = readJson("contract", "cli-current", file) as Report;
      for (const finding of report.findings) {
        expect(known.has(finding.policy), `${file}: ${finding.policy}`).toBe(true);
      }
    }
  });

  it("조문 원문이 팩에 기록된 해시와 맞는다", () => {
    for (const policy of packMeta.policies) {
      for (const ref of policy.legal) {
        expect(ref.text_sha256_matches, `${policy.id}: ${ref.label}`).toBe(true);
      }
    }
  });
});

describe("파서가 거부하는 것", () => {
  const base = () => readJson("contract", "cli-current", "kids-signup.main.json") as Report;

  it("모르는 schema_version", () => {
    const result = parseReport({ ...base(), schema_version: "report/99" });
    expect(result.ok).toBe(false);
  });

  it("다른 도구의 SARIF", () => {
    // SARIF 는 받는다(위의 "현재 CLI 의 SARIF 출력"). 이 CLI 가 싣는 것(팩 판 등)이 없는 SARIF 는 받지 않는다.
    const other = {
      version: "2.1.0",
      runs: [{ tool: { driver: { name: "other-tool", version: "1.0.0", rules: [] } }, results: [] }],
    };
    const result = parseReport(other);
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("SARIF 로 보이지 않습니다");
      expect(result.errors[0]).toContain("packDigest");
    }
  });

  it("결과가 아닌 JSON 파일은 없는 필드를 늘어놓지 않고 한 줄로 알린다", () => {
    for (const data of [{}, { name: "my-app", version: "1.0.0", scripts: {} }, readJson("contract", "cli-current", "MANIFEST.json")]) {
      expect(parseReport(data)).toEqual({
        ok: false,
        errors: ["CLI 결과 파일의 모양이 아닙니다. tool, run, findings 가 모두 없습니다."],
      });
    }
    // 셋 가운데 하나라도 있으면 결과로 보고, 읽지 못한 곳을 하나씩 적는다.
    const partial = parseReport({ tool: { name: "policypack", version: "0.3.0.dev0" } });
    expect(partial).toEqual({ ok: false, errors: ["run 이 없습니다.", "findings 배열이 없습니다."] });
  });

  it("run 이 없는 객체", () => {
    const { tool, findings } = base();
    expect(parseReport({ tool, findings }).ok).toBe(false);
  });

  it("모르는 판정 값", () => {
    const data = base();
    const findings = data.findings.map((f) => ({ ...f, outcome: "something-else" }));
    expect(parseReport({ ...data, findings }).ok).toBe(false);
  });

  it("참·거짓이 아닌 top_level (스키마도 같게 본다)", () => {
    const data = base();
    const withTopLevel = (value: unknown) => ({ ...data, findings: data.findings.map((f) => ({ ...f, top_level: value })) });
    for (const value of ["true", 1, null]) {
      expect(parseReport(withTopLevel(value)).ok, String(value)).toBe(false);
      expect(validateCurrent(withTopLevel(value)), String(value)).toBe(false);
    }
    for (const value of [true, false]) {
      expect(parseReport(withTopLevel(value)).ok, String(value)).toBe(true);
      expect(validateCurrent(withTopLevel(value)), String(value)).toBe(true);
    }
    // 없는 것은 받아들인다. 화면은 판정 구역을 "알 수 없음"으로 보인다.
    const without = {
      ...data,
      findings: data.findings.map((f) => {
        const finding: Partial<typeof f> = { ...f };
        delete finding.top_level;
        return finding;
      }),
    };
    expect(without.findings.every((f) => !("top_level" in f))).toBe(true);
    expect(parseReport(without).ok).toBe(true);
    expect(validateCurrent(without)).toBe(true);
  });

  it("모양이 다른 ai_cleared", () => {
    const data = base();
    expect(parseReport({ ...data, run: { ...data.run, ai_cleared: [{ policy: 1 }] } }).ok).toBe(false);
    expect(parseReport({ ...data, run: { ...data.run, ai_cleared: "none" } }).ok).toBe(false);
  });

  it("판 번호 없는 결과에 엉뚱한 run.policies 가 있어도 화면 구조를 만들다 죽지 않는다", () => {
    const data = base();
    for (const policies of [{ a: 1 }, [null], "x"]) {
      const parsed = parseReport({ ...data, run: { ...data.run, policies } });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(() => buildReportView(parsed.report, parsed.contract, packMeta)).not.toThrow();
    }
  });

  it("객체가 아닌 입력", () => {
    expect(parseReport([]).ok).toBe(false);
    expect(parseReport(null).ok).toBe(false);
  });
});
