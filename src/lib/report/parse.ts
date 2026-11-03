import {
  haveAlternativeIds,
  isAiRecords,
  isInt,
  isNullOr,
  isObj,
  isOutcome,
  isScope,
  isStr,
  isStaticCleared,
  isStrArr,
  isUnsatisfiedAlternatives,
} from "./guards";
import { parseSarif } from "./sarif";
import type { Contract, Report } from "./types";

export type ParseResult =
  | { ok: true; report: Report; contract: Contract }
  | { ok: false; errors: string[] };

/** 웹이 만든 v1 초안 예시의 판. CLI 가 내는 판이 아니다(`contract/samples-v1-draft/`). */
const V1_DRAFT = "report/1-draft";
/**
 * CLI 가 실제로 내는 결과의 판(CLI `e1e46a9` 부터, 실행기가 설치하는 `7300205` 도 같다). 정수다. 판 번호 없는 출력에
 * 키를 더한 것이라 같은 계약(`cli-0.3`)으로 읽는다. CLI 는 있던 키가 없어지거나 뜻이 바뀔 때 이 수를 올린다. 그때는
 * 모르는 판으로 거부한다.
 */
const CLI_SCHEMA_VERSION = 1;

/**
 * 결과를 확인한다. 브라우저에서 돌기 때문에 스키마 검증기를 쓰지 않고 웹이 읽는 필드만 손으로 본다.
 * 스키마(contract/schema)와 어긋나지 않는지는 tests/contract.test.ts 가 맞춰 본다.
 *
 * 결과 JSON(`--output-format json`)은 여기서 본다. SARIF(`--output-format sarif`)는 `runs` 배열로 알아보고
 * `sarif.ts` 에 넘긴다. 거기서 같은 모양(`Report`)으로 옮겨 돌려준다.
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
  if (Array.isArray(input.runs)) return parseSarif(input);
  // 결과가 아닌 JSON(설정 파일 등)이다. 없는 필드를 줄줄이 늘어놓지 않고 한 줄로 알린다.
  if (input.tool === undefined && input.run === undefined && input.findings === undefined) {
    return { ok: false, errors: ["CLI 결과 파일의 모양이 아닙니다. tool, run, findings 가 모두 없습니다."] };
  }

  let contract: Contract = "cli-0.3";
  if (input.schema_version !== undefined) {
    if (input.schema_version === V1_DRAFT) {
      contract = "v1-draft";
    } else if (input.schema_version !== CLI_SCHEMA_VERSION) {
      return {
        ok: false,
        errors: [
          `모르는 schema_version 입니다: ${String(input.schema_version)}. 이 뷰어가 아는 판은 ${CLI_SCHEMA_VERSION}(CLI 결과)과 ${V1_DRAFT}(v1 초안 예시)입니다.`,
        ],
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
      need(run[key] === undefined || isAiRecords(run[key]), `run.${key} 모양이 다릅니다.`);
    }
    need(
      !Array.isArray(run.ai_cleared) || haveAlternativeIds(run.ai_cleared),
      "run.ai_cleared[].alternatives 모양이 다릅니다.",
    );
    // CLI 결과 판 1 부터 실리는 키. 없어도 읽는다(판 번호 없는 출력). 있으면 화면에 쓰는 모양인지 본다.
    need(run.static_cleared === undefined || isStaticCleared(run.static_cleared), "run.static_cleared 모양이 다릅니다.");
    need(run.fingerprint_version === undefined || isStr(run.fingerprint_version), "run.fingerprint_version 은 문자열이어야 합니다.");
    for (const key of ["questions_asked", "ai_answered", "questions_sent", "questions_skipped"] as const) {
      need(run[key] === undefined || isInt(run[key]), `run.${key} 는 정수여야 합니다.`);
    }

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
      need(isOutcome(f.outcome), `${at}.outcome 이 모르는 값입니다: ${String(f.outcome)}`);
      need(isNullOr(f.line, isInt), `${at}.line 은 정수이거나 null 이어야 합니다.`);
      need(isScope(f.scope), `${at}.scope 가 모르는 값입니다.`);
      need(
        f.region === null || (isObj(f.region) && isInt(f.region.start_line) && isInt(f.region.end_line)),
        `${at}.region 모양이 다릅니다.`,
      );
      need(f.top_level === undefined || typeof f.top_level === "boolean", `${at}.top_level 은 참·거짓이어야 합니다.`);
      need(isStrArr(f.untested_reasons), `${at}.untested_reasons 는 문자열 배열이어야 합니다.`);
      need(isStrArr(f.ai_pending), `${at}.ai_pending 은 문자열 배열이어야 합니다.`);
      need(isStrArr(f.decision_path), `${at}.decision_path 는 문자열 배열이어야 합니다.`);
      need(isUnsatisfiedAlternatives(f.unsatisfied_alternatives), `${at}.unsatisfied_alternatives 모양이 다릅니다.`);
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: input as unknown as Report, contract };
}

/**
 * 파일 내용(문자열)에서 바로 읽는다. JSON 이 아니면 그 사실과, 그렇게 되는 흔한 까닭을 알려 준다.
 *
 * CLI 는 결과를 표준 출력으로만 낸다. 그래서 결과 파일은 사용자가 출력을 파일로 돌려 저장한 것이고, 그러다 생기는
 * 잘못이 그대로 들어온다: 출력 형식을 주지 않은 글 출력, 안내 문장(표준 오류)이 함께 적힌 파일, CLI 가 오류로 끝나
 * 비어 있는 파일.
 */
export function parseReportText(text: string): ParseResult {
  if (text.trim() === "") {
    return {
      ok: false,
      errors: ["빈 파일입니다. CLI 가 결과를 내지 못하고 끝났다면 터미널에 남은 오류를 확인하세요."],
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      errors: [
        "JSON 으로 읽을 수 없습니다. 출력 형식을 주지 않은 글 출력이거나, 터미널의 다른 글이 함께 적힌 파일일 수 있습니다.",
      ],
    };
  }
  return parseReport(data);
}
