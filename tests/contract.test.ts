import { existsSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { packMeta } from "@/lib/pack";
import { parseReport } from "@/lib/report/parse";
import type { Report } from "@/lib/report/types";
import { buildReportView } from "@/lib/report/view-model";
import { jsonFiles, readJson, root } from "./helpers";

// CLI 와 웹 사이의 이음매를 지킨다.
// 실패하면: CLI 출력이 바뀌었거나(npm run capture 뒤라면), 스키마·타입·파서 가운데 하나만 고친 것이다.

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(readJson("contract", "schema", "report.cli-0.3.schema.json") as object);
const validateCurrent = ajv.getSchema("report.cli-0.3.schema.json")!;
const validateDraft = ajv.compile(readJson("contract", "schema", "report.v1-draft.schema.json") as object);

const captures = jsonFiles("contract", "cli-current");
const drafts = jsonFiles("contract", "samples-v1-draft");
// 손으로 만든 시험용 자료(판정자를 켠 결과 등). 실제 CLI 출력이 아니지만 같은 스키마를 통과해야 한다.
const handmade = jsonFiles("tests", "fixtures");

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
});

describe("손으로 만든 시험용 자료 (tests/fixtures)", () => {
  it.each(handmade)("%s 가 cli-0.3 스키마를 통과하고 파서가 읽는다", (file) => {
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

  it("SARIF 파일", () => {
    const result = parseReport(readJson("contract", "cli-current", "kids-signup.main.sarif"));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors[0]).toContain("SARIF");
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
