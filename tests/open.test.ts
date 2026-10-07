import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_FILE_BYTES, NOT_UTF8, readResultFile } from "@/lib/report/open";
import { parseReportText } from "@/lib/report/parse";
import { SITE } from "@/lib/site";
import { readJson, root } from "./helpers";
import { BANNED_WORDING } from "./wording";

// `/view` 에 잘못된 파일을 넣었을 때의 안내. 파일을 읽어 결과로 바꾸는 데까지를 본다(src/lib/report/open.ts, parse.ts).
// 화면에 그 안내가 실제로 뜨는지, 그 뒤에 다른 파일을 열 수 있는지는 브라우저 시험이 본다(tests/browser/view.test.ts).

const text = (...parts: string[]) => readFileSync(path.join(root, ...parts), "utf8");
const fileOf = (content: string, name = "result.json") => new File([content], name);
const errorsOf = async (content: string) => {
  const result = await readResultFile(fileOf(content));
  if (result.ok) throw new Error("읽혔습니다");
  return result.errors;
};

const EMPTY = "빈 파일입니다. CLI 가 결과를 내지 못하고 끝났다면 터미널에 남은 오류를 확인하세요.";
const NOT_JSON =
  "JSON 으로 읽을 수 없습니다. 출력 형식을 주지 않은 글 출력이거나, 터미널의 다른 글이 함께 적힌 파일일 수 있습니다.";
const NOT_RESULT = "CLI 결과 파일의 모양이 아닙니다. tool, run, findings 가 모두 없습니다.";

describe("결과 파일을 읽는다", () => {
  it("결과 JSON, v1 초안, SARIF 를 연다", async () => {
    for (const [parts, contract] of [
      [["contract", "cli-current", "kids-signup.main.json"], "cli-0.3"],
      [["contract", "samples-v1-draft", "kids-signup.main.json"], "v1-draft"],
      [["contract", "cli-current", "kids-signup.main.sarif"], "sarif"],
    ] as const) {
      expect(await readResultFile(fileOf(text(...parts))), parts.join("/")).toMatchObject({ ok: true, contract });
    }
  });

  it("글자 순서 표시(BOM)가 붙은 UTF-8 파일도 연다", async () => {
    const withBom = new File([new Uint8Array([0xef, 0xbb, 0xbf]), text("contract", "cli-current", "plain.main.json")], "result.json");
    expect(await readResultFile(withBom)).toMatchObject({ ok: true, contract: "cli-0.3" });
  });

  it("글자 순서 표시(BOM)가 붙은 UTF-16 파일도 연다. 글자가 UTF-8 파일을 연 것과 같다", async () => {
    const json = text("contract", "cli-current", "kids-signup.main.json");
    const expected = await readResultFile(fileOf(json));
    const units = Uint16Array.from(json, (char) => char.charCodeAt(0));
    const little = new Uint8Array(units.length * 2);
    const big = new Uint8Array(units.length * 2);
    units.forEach((unit, i) => {
      little.set([unit & 0xff, unit >> 8], i * 2);
      big.set([unit >> 8, unit & 0xff], i * 2);
    });
    expect(await readResultFile(new File([new Uint8Array([0xff, 0xfe]), little], "le.json"))).toEqual(expected);
    expect(await readResultFile(new File([new Uint8Array([0xfe, 0xff]), big], "be.json"))).toEqual(expected);
  });

  it("깨진 글자 표시(U+FFFD)가 실제로 들어 있는 UTF-8 파일은 그대로 연다", async () => {
    // 풀지 못한 것과, 풀었더니 그 글자가 있는 것은 다르다. 검사한 코드의 경로에 그 글자가 있을 수 있다.
    const report = readJson("contract", "cli-current", "kids-signup.main.json") as { findings: { file: string }[] };
    report.findings[0].file = "src/\uFFFD.ts";
    const result = await readResultFile(fileOf(JSON.stringify(report)));
    expect(result).toMatchObject({ ok: true, report: { findings: [{ file: "src/\uFFFD.ts" }] } });
  });
});

describe("잘못된 파일을 넣었을 때의 안내", () => {
  it("UTF-8 이 아닌 파일: 깨진 글자로 그리지 않고, 읽을 수 없다고 알린다", async () => {
    // 한글을 CP949 로 적은 결과 파일의 모양이다. "가" 는 CP949 로 B0 A1 이고, UTF-8 로는 풀리지 않는다.
    const json = text("contract", "cli-current", "plain.main.json");
    const cp949 = new File([json.trimEnd().slice(0, -1), ', "x": "', new Uint8Array([0xb0, 0xa1]), '"}'], "result.json");
    // 느슨하게 풀면 깨진 글자가 든 채로 결과로 읽힌다. 그래서 풀 때 가려야 한다.
    expect(parseReportText(await cp949.text())).toMatchObject({ ok: true });
    expect(await cp949.text()).toContain("\uFFFD");
    expect(await readResultFile(cp949)).toEqual({ ok: false, errors: [NOT_UTF8] });
    // 글자 순서 표시가 없는 UTF-16 도 짐작해 풀지 않는다. 표시가 UTF-16 인데 바이트가 홀수로 끝난 파일도 풀지 않는다.
    expect(await readResultFile(new File([new Uint8Array([0x7b, 0x00, 0xd8, 0x00, 0x7d, 0x00, 0xff])], "x.json"))).toEqual({
      ok: false,
      errors: [NOT_UTF8],
    });
    expect(await readResultFile(new File([new Uint8Array([0xff, 0xfe, 0x7b, 0x00, 0x7d])], "odd.json"))).toEqual({
      ok: false,
      errors: [NOT_UTF8],
    });
  });

  it("빈 파일: CLI 가 결과를 내지 못했을 수 있다고 알린다", async () => {
    // CLI 는 결과를 표준 출력으로만 낸다. 오류로 끝나면(종료 코드 2) 받아 적은 파일이 비어 있다.
    for (const content of ["", "\n", "  \n\t\n"]) expect(await errorsOf(content), JSON.stringify(content)).toEqual([EMPTY]);
  });

  it("JSON 이 아닌 파일: 글 출력이거나 다른 글이 섞였을 수 있다고 알린다", async () => {
    const json = text("contract", "cli-current", "plain.main.json");
    for (const content of [
      // 출력 형식을 주지 않으면 사람이 읽는 글이 나온다(CLI 0.3.0.dev0 이 낸 글의 첫머리).
      "\nsrc/auth/signup.ts:5  검토 필요  만 14세 미만 아동의 개인정보 처리\n    근거  개인정보 보호법 제22조의2 제1항\n",
      // 표준 오류까지 함께 받아 적은 파일(2>&1). 안내 문장이 JSON 앞에 섞인다.
      `스테이징된 파일 1개를 검사합니다.\n${json}`,
      // 끝이 잘린 파일.
      json.slice(0, json.length / 2),
      "<!doctype html><html></html>",
      "\u0000\u0001PNG",
    ]) {
      expect(await errorsOf(content), content.slice(0, 30)).toEqual([NOT_JSON]);
    }
    // parseReportText 도 같은 말을 낸다(예시와 시험이 쓰는 길).
    expect(parseReportText("not json")).toEqual({ ok: false, errors: [NOT_JSON] });
  });

  it("JSON 이지만 결과가 아닌 파일: 무엇이 없는지 한 줄로 알린다", async () => {
    for (const content of ["[]", "[1, 2]", "42", '"result"', "null", "true"]) {
      expect(await errorsOf(content), content).toEqual(["결과 JSON 의 최상위는 객체여야 합니다."]);
    }
    expect(await errorsOf(text("package.json"))).toEqual([NOT_RESULT]);
    expect(await errorsOf(text("tsconfig.json"))).toEqual([NOT_RESULT]);
    expect(await errorsOf(text("data", "pack-meta.json"))).toEqual([NOT_RESULT]);
    expect(await errorsOf(text("contract", "schema", "report.cli-0.3.schema.json"))).toEqual([NOT_RESULT]);
  });

  it("결과로 보이지만 읽지 못한 곳이 있는 파일: 어느 필드인지 적는다", async () => {
    const data = readJson("contract", "cli-current", "kids-signup.main.json") as { findings: Record<string, unknown>[] };
    const [finding] = data.findings;
    const broken = { ...data, findings: [{ ...finding, outcome: "compliant" }, { ...finding, fingerprint: undefined }] };
    expect(await errorsOf(JSON.stringify(broken))).toEqual([
      "findings[0].outcome 이 모르는 값입니다: compliant",
      "findings[1].fingerprint 가 없습니다.",
    ]);
    expect(await errorsOf(JSON.stringify({ ...data, schema_version: "report/99" }))).toEqual([
      "모르는 schema_version 입니다: report/99. 이 뷰어가 아는 판은 report/1-draft 입니다.",
    ]);
  });

  it("다른 도구의 SARIF: 읽지 않는다고 알린다", async () => {
    const other = { version: "2.1.0", runs: [{ tool: { driver: { name: "eslint", rules: [] } }, results: [] }] };
    // CLI 의 이름은 바뀔 수 있다. 이름에 조사를 바로 붙이지 않는다(받침에 따라 달라진다). 필드 경로는 맨 끝에 따로 둔다.
    expect(await errorsOf(JSON.stringify(other))).toEqual([
      `이 CLI(${SITE.cli})가 낸 SARIF 로 보이지 않습니다. 다른 도구의 SARIF 는 읽지 않습니다. 팩 판이 실려 있지 않습니다: runs[0].invocations[0].properties.packDigest`,
    ]);
    expect(await errorsOf(JSON.stringify({ version: "2.0.0", runs: [] }))).toEqual([
      "SARIF 판(version)이 2.1.0 이 아닙니다: 2.0.0. 이 뷰어가 아는 판은 2.1.0 입니다.",
    ]);
    expect(await errorsOf(JSON.stringify({ version: "2.1.0", runs: [] }))).toEqual([
      "runs 가 하나인 SARIF 만 읽습니다. 이 파일에는 0개 있습니다.",
    ]);
    expect(await errorsOf(JSON.stringify({ version: "2.1.0", runs: [other.runs[0], other.runs[0]] }))).toEqual([
      "runs 가 하나인 SARIF 만 읽습니다. 이 파일에는 2개 있습니다.",
    ]);
    // 하나이긴 한데 객체가 아닌 것(손으로 만들었거나 깨진 파일). "1개 있습니다"라고 하면 까닭이 되지 않는다.
    for (const run of [null, 1, "run", [other.runs[0]]]) {
      expect(await errorsOf(JSON.stringify({ version: "2.1.0", runs: [run] })), JSON.stringify(run)).toEqual([
        "runs[0] 이 객체가 아닙니다.",
      ]);
    }
  });

  it("한도보다 큰 파일: 읽지 않고 크기와 한도를 알린다", async () => {
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
    let read = 0;
    const sized = (size: number) => ({
      size,
      arrayBuffer: async () => {
        read += 1;
        return new TextEncoder().encode("{}").buffer as ArrayBuffer;
      },
    });
    // 내용을 메모리에 읽기 전에 크기만 보고 돌려보낸다.
    expect(await readResultFile(sized(MAX_FILE_BYTES + 1))).toEqual({
      ok: false,
      errors: ["파일이 너무 큽니다(10.1MB). 이 뷰어는 10MB 까지만 엽니다."],
    });
    expect(await readResultFile(sized(1536 * 1024 * 1024))).toEqual({
      ok: false,
      errors: ["파일이 너무 큽니다(1536.0MB). 이 뷰어는 10MB 까지만 엽니다."],
    });
    expect(read).toBe(0);
    // 한도와 같은 크기까지는 읽는다.
    expect(await readResultFile(sized(MAX_FILE_BYTES))).toEqual({ ok: false, errors: [NOT_RESULT] });
    expect(read).toBe(1);
  });

  it("읽을 수 없는 것(폴더 등): 읽지 못했다고 알린다", async () => {
    // 폴더를 끌어다 놓으면 브라우저는 파일처럼 넘겨주지만 읽기는 실패한다(Chrome 에서 확인).
    const folder = { size: 96, arrayBuffer: () => Promise.reject(new DOMException("A requested file or directory could not be found", "NotFoundError")) };
    expect(await readResultFile(folder)).toEqual({
      ok: false,
      errors: ["파일을 읽지 못했습니다. 폴더가 아닌 파일인지, 파일이 그 자리에 있는지 확인하세요."],
    });
  });

  it("안내에 쓰지 않는 말이 없다", async () => {
    const shown = [
      EMPTY,
      NOT_JSON,
      NOT_RESULT,
      SITE.scanExample,
      ...(await errorsOf("[]")),
      ...(await errorsOf(JSON.stringify({ version: "2.1.0", runs: [{}] }))),
      ...((await readResultFile({ size: MAX_FILE_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) })) as { errors: string[] }).errors,
      NOT_UTF8,
    ];
    for (const sentence of shown) {
      for (const [pattern, why] of BANNED_WORDING) expect(pattern.test(sentence), `${sentence} — ${why}`).toBe(false);
    }
  });

  it("안내에 적는 명령의 예는 수집에 쓰는 명령과 같은 모양이다", () => {
    // CLI 는 결과를 표준 출력으로 낸다. 예는 그것을 파일로 받아 적는 모양이다. CLI 이름은 바뀔 수 있어 SITE 에서 가져온다.
    expect(SITE.scanExample).toBe(`${SITE.cli} scan src/ --output-format json > result.json`);
    const manifest = readJson("contract", "cli-current", "MANIFEST.json") as { command: string };
    expect(manifest.command.startsWith(SITE.scanExample.split(" > ")[0])).toBe(true);
  });
});
