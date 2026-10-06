import type { Contract, Report } from "./types";

export type ParseResult =
  | { ok: true; report: Report; contract: Contract }
  | { ok: false; errors: string[] };

const V1_DRAFT = "report/1-draft";
const OUTCOMES = new Set(["needs-review", "needs-review-uncertain"]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isNullOr = <T>(v: unknown, check: (x: unknown) => x is T): v is T | null => v === null || check(v);

/**
 * 결과 JSON 을 확인한다. 브라우저에서 돌기 때문에 스키마 검증기를 쓰지 않고 웹이 읽는 필드만 손으로 본다.
 * 스키마(contract/schema)와 어긋나지 않는지는 tests/contract.test.ts 가 맞춰 본다.
 */
export function parseReport(input: unknown): ParseResult {
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
    return ok;
  };

  if (!isObj(input)) {
    return { ok: false, errors: ["결과 JSON 의 최상위는 객체여야 합니다."] };
  }
  if (Array.isArray(input.runs)) {
    return {
      ok: false,
      errors: ["SARIF 파일로 보입니다. 지금은 JSON 형식(--output-format json)의 결과만 읽습니다."],
    };
  }

  let contract: Contract = "cli-0.3";
  if (input.schema_version !== undefined) {
    if (input.schema_version === V1_DRAFT) {
      contract = "v1-draft";
    } else {
      return {
        ok: false,
        errors: [`모르는 schema_version 입니다: ${String(input.schema_version)}. 이 뷰어가 아는 판은 ${V1_DRAFT} 입니다.`],
      };
    }
  }

  const tool = input.tool;
  need(isObj(tool) && isStr(tool.name) && isStr(tool.version), "tool.name, tool.version 이 없습니다.");

  const run = input.run;
  if (need(isObj(run), "run 이 없습니다.") && isObj(run)) {
    need(isNullOr(run.judge, isStr), "run.judge 는 문자열이거나 null 이어야 합니다.");
    need(isStr(run.pack_digest), "run.pack_digest 가 없습니다.");
    need(isInt(run.ai_pending), "run.ai_pending 이 없습니다.");
    need(isInt(run.units), "run.units 가 없습니다.");
    need(run.files === undefined || isInt(run.files), "run.files 는 정수여야 합니다.");
    need(
      run.engine === null || (isObj(run.engine) && isStr(run.engine.name) && isNullOr(run.engine.version, isStr)),
      "run.engine 모양이 다릅니다.",
    );
    for (const key of ["unparsed", "skipped", "incomplete"] as const) {
      need(isStrArr(run[key]), `run.${key} 는 문자열 배열이어야 합니다.`);
    }
    need(Array.isArray(run.engine_errors), "run.engine_errors 가 없습니다.");
    need(typeof run.coverage_complete === "boolean", "run.coverage_complete 가 없습니다.");
    // 판정자를 켠 결과에만 채워진다. 있으면 화면에 쓰는 필드만 본다.
    for (const key of ["ai_cleared", "ai_dismissed"] as const) {
      const list = run[key];
      need(
        list === undefined ||
          (Array.isArray(list) && list.every((x) => isObj(x) && isStr(x.policy) && isStr(x.rule) && isStr(x.file))),
        `run.${key} 모양이 다릅니다.`,
      );
    }
    need(
      !Array.isArray(run.ai_cleared) ||
        run.ai_cleared.every(
          (x) => isObj(x) && Array.isArray(x.alternatives) && x.alternatives.every((a) => isObj(a) && isStr(a.id)),
        ),
      "run.ai_cleared[].alternatives 모양이 다릅니다.",
    );

    if (contract === "v1-draft") {
      if (need(Array.isArray(run.policies), "run.policies 가 없습니다(v1 초안 필수).") && Array.isArray(run.policies)) {
        run.policies.forEach((p, i) => {
          const ok =
            isObj(p) &&
            isStr(p.policy) &&
            isInt(p.units) &&
            isInt(p.needs_review) &&
            isInt(p.uncertain) &&
            isInt(p.compliant) &&
            Array.isArray(p.evidence) &&
            p.evidence.every(
              (e) => isObj(e) && isStr(e.file) && isNullOr(e.line, isInt) && isStr(e.rule) && isStr(e.alternative),
            );
          need(ok, `run.policies[${i}] 모양이 다릅니다.`);
        });
      }
    }
  }

  const findings = input.findings;
  if (need(Array.isArray(findings), "findings 배열이 없습니다.") && Array.isArray(findings)) {
    findings.forEach((f, i) => {
      const at = `findings[${i}]`;
      if (!need(isObj(f), `${at} 는 객체여야 합니다.`) || !isObj(f)) return;
      for (const key of ["policy", "rule", "file", "title", "law", "ask_developer", "fingerprint"] as const) {
        need(isStr(f[key]), `${at}.${key} 가 없습니다.`);
      }
      need(isStr(f.outcome) && OUTCOMES.has(f.outcome), `${at}.outcome 이 모르는 값입니다: ${String(f.outcome)}`);
      need(isNullOr(f.line, isInt), `${at}.line 은 정수이거나 null 이어야 합니다.`);
      need(f.scope === "file" || f.scope === "anchor", `${at}.scope 가 모르는 값입니다.`);
      need(
        f.region === null || (isObj(f.region) && isInt(f.region.start_line) && isInt(f.region.end_line)),
        `${at}.region 모양이 다릅니다.`,
      );
      need(isStrArr(f.untested_reasons), `${at}.untested_reasons 는 문자열 배열이어야 합니다.`);
      need(isStrArr(f.ai_pending), `${at}.ai_pending 은 문자열 배열이어야 합니다.`);
      need(isStrArr(f.decision_path), `${at}.decision_path 는 문자열 배열이어야 합니다.`);
      need(
        Array.isArray(f.unsatisfied_alternatives) &&
          f.unsatisfied_alternatives.every(
            (a) =>
              isObj(a) &&
              isStr(a.id) &&
              isNullOr(a.message, isStr) &&
              isNullOr(a.ask_developer, isStr) &&
              isNullOr(a.remediation, isStr) &&
              isStr(a.value),
          ),
        `${at}.unsatisfied_alternatives 모양이 다릅니다.`,
      );
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: input as unknown as Report, contract };
}

/** 파일 내용(문자열)에서 바로 읽는다. JSON 이 아니면 그 사실을 알려 준다. */
export function parseReportText(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["JSON 으로 읽을 수 없습니다. CLI 의 JSON 출력(--output-format json)인지 확인하세요."] };
  }
  return parseReport(data);
}
