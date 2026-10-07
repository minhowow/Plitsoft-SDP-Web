import { SITE } from "@/lib/site";
import {
  haveAlternativeIds,
  isAiRecords,
  isInt,
  isObj,
  isOutcome,
  isScope,
  isStr,
  isStrArr,
  isUnsatisfiedAlternatives,
  type Obj,
} from "./guards";
import type { ParseResult } from "./parse";
import type { AiCleared, AiDismissed, Finding, Outcome, Report, UnsatisfiedAlternative } from "./types";

/**
 * CLI 의 SARIF 출력(`scan --output-format sarif`, SARIF 2.1.0)을 결과 JSON 과 같은 모양(`Report`)으로 옮긴다.
 * `contract/schema/sarif.cli-0.3.schema.json` 과 짝이다. 읽는 필드를 더하거나 뺄 때는 스키마와
 * tests/contract.test.ts 를 함께 고친다.
 *
 * SARIF 에 실린 것은 JSON 과 같게 옮기고, 실리지 않은 것은 채우지 않는다. 화면은 그것을 "알 수 없음"으로 보인다.
 * 어디에 무엇이 실리는지는 CLI 소스 `report/sarif.py` 에서 확인했고, CLI 0.3.0.dev0 을 합성 폴더에 돌려 JSON 출력과
 * 맞춰 봤다(`docs/architecture.md` 의 "SARIF 에 있는 것과 없는 것").
 *
 * | 결과 JSON | SARIF 의 자리 |
 * |---|---|
 * | `tool` | `tool.driver.name`, `version` |
 * | `run.engine` | `tool.extensions[0]`. 엔진을 돌리지 않았으면 `extensions` 가 없다 |
 * | `run.judge` | `invocations[0].properties.judge`. 꺼져 있으면 JSON 은 null, SARIF 는 "none" 이다 |
 * | `run.pack_digest`, `ai_pending`, `ai_cleared`, `ai_dismissed`, `coverage_complete` | `invocations[0].properties` |
 * | `run.unparsed`, `skipped`, `incomplete`, `engine_errors` | `invocations[0].toolExecutionNotifications` |
 * | `run.units`, `run.files` | **없다** |
 * | 발견의 `policy`, `rule` | `ruleId` ("정책/규칙". CLI 는 두 id 에 "/" 를 받지 않는다) |
 * | 발견의 `title`, `ask_developer` | `tool.driver.rules` 에서 `ruleId` 가 같은 규칙의 `shortDescription`, `help.text` |
 * | 발견의 `file`, `line` | `locations[0].physicalLocation` 의 `artifactLocation.uri`, `region.startLine` |
 * | 발견의 `region` | `contextRegion`. 일부에만 실린다(아래) |
 * | 발견의 `top_level` | **없다** |
 * | 발견의 `fingerprint` | `partialFingerprints["policypack/v1"]` |
 * | 발견의 나머지(`outcome`, `law`, `scope`, 대안, 판정 경로, 이유) | `results[].properties` |
 *
 * JSON 과 같게 옮길 수 없는 곳(`docs/cli-requests.md` 의 R11):
 * - 줄이 없는 발견도 `startLine: 1` 로 실린다. 그래서 옮긴 결과의 1행은 실제 1행일 수도, 줄이 없는 발견일 수도 있다.
 *   1행으로 옮기고, 화면이 그렇게 알린다(`view-model.ts` 의 `LocationView.lineUnsure`).
 * - 판정 구역(`contextRegion`)은 줄이 그 안에 있고 두 줄 이상인 구역일 때만 실린다. 없으면 구역이 없는 것인지 싣지
 *   않은 것인지 알 수 없다. `top_level` 도 없어서, 함수 단위인데 구역이 없는 발견은 "판정 구역 알 수 없음"이 된다
 *   (`scope.ts`). 파일 단위 발견은 `scope` 만으로 파일 전체 판정임을 안다.
 *
 * 화면에 옮기지 않는 것: `rules[].fullDescription` 과 `rules[].help.markdown` 에는 팩 작성자 메모가 들어 있다
 * (`docs/commitments.md`). 읽지 않는다.
 */

/**
 * 지문이 실린 열쇠. CLI 소스 `report/fingerprint.py` 의 VERSION 이다. 이 값과 아래 알림의 id 는 CLI 가 출력에 적는
 * 그대로다(화면에 보이는 이름이 아니다). CLI 의 이름이 들어 있어서, 이름이 바뀌면 스키마와 함께 고쳐야 할 수 있다.
 */
const FINGERPRINT_KEY = "policypack/v1";

/** 다 보지 못한 파일을 알리는 알림의 `descriptor.id` 와, 그 파일이 들어가는 결과 JSON 의 목록. */
const GAP_LIST = new Map<string, "unparsed" | "skipped" | "incomplete">([
  ["policypack/unparsed", "unparsed"],
  ["policypack/skipped", "skipped"],
  ["policypack/engine-incomplete", "incomplete"],
]);

/** 어느 파일인지 모르는 엔진 오류를 알리는 알림. 위치 없이 문장만 실린다. */
const ENGINE_ERROR = "policypack/engine-error";

interface SarifPlace {
  artifactLocation: { uri: string };
  region: { startLine: number };
  contextRegion?: { startLine: number; endLine: number };
}

interface SarifRule {
  id: string;
  shortDescription: { text: string };
  help: { text: string };
}

interface SarifResult {
  ruleId: string;
  locations: { physicalLocation: SarifPlace }[];
  partialFingerprints: Record<string, string>;
  properties: {
    outcome: Outcome;
    law: string;
    untestedReasons: string[];
    aiPending: string[];
    decisionPath: string[];
    unsatisfiedAlternatives: UnsatisfiedAlternative[];
    scope: "file" | "anchor";
  };
}

interface SarifNotification {
  descriptor: { id: string };
  message?: { text?: string };
  locations?: { physicalLocation: { artifactLocation: { uri: string } } }[];
}

/** CLI 0.3 의 SARIF 출력 가운데 웹이 읽는 것. */
export interface SarifLog {
  version: "2.1.0";
  runs: {
    tool: {
      driver: { name: string; version: string; rules: SarifRule[] };
      extensions?: { name: string; version?: string }[];
    };
    invocations: {
      toolExecutionNotifications: SarifNotification[];
      properties: {
        judge: string;
        aiPending: number;
        aiCleared?: AiCleared[];
        aiDismissed?: AiDismissed[];
        packDigest: string;
        coverageComplete: boolean;
      };
    }[];
    results: SarifResult[];
  }[];
}

/** 위치 하나(`locations[]` 의 항목)에 실린 파일 경로. 없으면 undefined. */
const uriOf = (location: unknown): unknown =>
  isObj(location) && isObj(location.physicalLocation) && isObj(location.physicalLocation.artifactLocation)
    ? location.physicalLocation.artifactLocation.uri
    : undefined;

/** "정책/규칙" 을 둘로 나눈다. 그 모양이 아니면 null. */
function splitRuleId(ruleId: string): [policy: string, rule: string] | null {
  const parts = ruleId.split("/");
  return parts.length === 2 && parts[0] !== "" && parts[1] !== "" ? [parts[0], parts[1]] : null;
}

/** 웹이 읽는 필드를 손으로 본다. 오류가 없으면 `SarifLog` 로 읽어도 된다. */
function check(input: Obj): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
    return ok;
  };

  if (input.version !== "2.1.0") {
    return [`SARIF 판(version)이 2.1.0 이 아닙니다: ${String(input.version)}. 이 뷰어가 아는 판은 2.1.0 입니다.`];
  }
  const runs = input.runs;
  if (!Array.isArray(runs) || runs.length !== 1) {
    const count = Array.isArray(runs) ? runs.length : 0;
    return [`runs 가 하나인 SARIF 만 읽습니다. 이 파일에는 ${count}개 있습니다.`];
  }
  const run: unknown = runs[0];
  // 하나이긴 한데 객체가 아니다(손으로 만들었거나 깨진 파일). 수가 맞지 않는다고 알리면 틀린 말이 된다.
  if (!isObj(run)) return ["runs[0] 이 객체가 아닙니다."];

  // 다른 도구의 SARIF 를 먼저 가린다. 아래의 확인이 줄줄이 실패해 안내가 묻히지 않게 한다.
  // CLI 의 이름은 바뀔 수 있다. 이름에 조사를 바로 붙이지 않는다(받침에 따라 조사가 달라진다). 필드 경로는 맨 끝에 따로
  // 둔다. 긴 경로에 낱말이 붙어 있으면 좁은 화면에서 줄이 어색하게 끊긴다.
  const invocation = Array.isArray(run.invocations) ? run.invocations[0] : undefined;
  const props = isObj(invocation) ? invocation.properties : undefined;
  if (!isObj(invocation) || !isObj(props) || !isStr(props.packDigest)) {
    return [
      `이 CLI(${SITE.cli})가 낸 SARIF 로 보이지 않습니다. 다른 도구의 SARIF 는 읽지 않습니다. ` +
        "팩 판이 실려 있지 않습니다: runs[0].invocations[0].properties.packDigest",
    ];
  }

  const at = "runs[0]";
  const driver = isObj(run.tool) ? run.tool.driver : undefined;
  need(
    isObj(driver) && isStr(driver.name) && isStr(driver.version),
    `${at}.tool.driver.name, version 이 없습니다.`,
  );
  const rules = isObj(driver) && Array.isArray(driver.rules) ? driver.rules : null;
  need(rules !== null, `${at}.tool.driver.rules 배열이 없습니다.`);
  const ruleIds = new Set<string>();
  rules?.forEach((rule, i) => {
    const ok =
      isObj(rule) &&
      isStr(rule.id) &&
      isObj(rule.shortDescription) &&
      isStr(rule.shortDescription.text) &&
      isObj(rule.help) &&
      isStr(rule.help.text);
    if (need(ok, `${at}.tool.driver.rules[${i}] 모양이 다릅니다.`) && isObj(rule) && isStr(rule.id)) ruleIds.add(rule.id);
  });
  const extensions = isObj(run.tool) ? run.tool.extensions : undefined;
  need(
    extensions === undefined ||
      (Array.isArray(extensions) &&
        extensions.length > 0 &&
        isObj(extensions[0]) &&
        isStr(extensions[0].name) &&
        (extensions[0].version === undefined || isStr(extensions[0].version))),
    `${at}.tool.extensions 모양이 다릅니다.`,
  );

  const inv = `${at}.invocations[0]`;
  need(isStr(props.judge), `${inv}.properties.judge 가 없습니다.`);
  need(isInt(props.aiPending), `${inv}.properties.aiPending 이 없습니다.`);
  need(typeof props.coverageComplete === "boolean", `${inv}.properties.coverageComplete 가 없습니다.`);
  // 판정자를 켠 결과에만 채워진다. 있으면 화면에 쓰는 필드만 본다(결과 JSON 의 ai_cleared, ai_dismissed 와 같은 모양이다).
  for (const key of ["aiCleared", "aiDismissed"] as const) {
    need(props[key] === undefined || isAiRecords(props[key]), `${inv}.properties.${key} 모양이 다릅니다.`);
  }
  need(
    !Array.isArray(props.aiCleared) || haveAlternativeIds(props.aiCleared),
    `${inv}.properties.aiCleared[].alternatives 모양이 다릅니다.`,
  );
  const notifications = invocation.toolExecutionNotifications;
  if (need(Array.isArray(notifications), `${inv}.toolExecutionNotifications 배열이 없습니다.`) && Array.isArray(notifications)) {
    notifications.forEach((n, i) => {
      const where = `${inv}.toolExecutionNotifications[${i}]`;
      const id = isObj(n) && isObj(n.descriptor) ? n.descriptor.id : undefined;
      if (!need(isStr(id), `${where}.descriptor.id 가 없습니다.`) || !isObj(n) || !isStr(id)) return;
      // 다 보지 못한 파일의 알림에는 파일이, 엔진 오류의 알림에는 문장이 있어야 한다. 그 밖의 알림은 읽지 않는다.
      if (GAP_LIST.has(id)) {
        need(Array.isArray(n.locations) && isStr(uriOf(n.locations[0])), `${where} 에 파일(locations[0])이 없습니다.`);
      } else if (id === ENGINE_ERROR) {
        need(isObj(n.message) && isStr(n.message.text), `${where}.message.text 가 없습니다.`);
      }
    });
  }

  const results = run.results;
  if (need(Array.isArray(results), `${at}.results 배열이 없습니다.`) && Array.isArray(results)) {
    results.forEach((r, i) => {
      const where = `${at}.results[${i}]`;
      if (!need(isObj(r), `${where} 는 객체여야 합니다.`) || !isObj(r)) return;
      const ruleId = r.ruleId;
      const shaped = isStr(ruleId) && splitRuleId(ruleId) !== null;
      if (need(shaped, `${where}.ruleId 가 '정책/규칙' 모양이 아닙니다.`) && isStr(ruleId)) {
        // 제목과 질문은 규칙 목록에서 가져온다. 규칙이 없으면 지어낼 수 없다.
        need(ruleIds.has(ruleId), `${where}.ruleId 와 같은 규칙이 tool.driver.rules 에 없습니다.`);
      }
      const location: unknown = Array.isArray(r.locations) ? r.locations[0] : undefined;
      const place = isObj(location) ? location.physicalLocation : undefined;
      if (need(isStr(uriOf(location)), `${where} 에 파일(locations[0])이 없습니다.`) && isObj(place)) {
        need(
          isObj(place.region) && isInt(place.region.startLine),
          `${where} 에 줄(locations[0].physicalLocation.region.startLine)이 없습니다.`,
        );
        const context = place.contextRegion;
        need(
          context === undefined || (isObj(context) && isInt(context.startLine) && isInt(context.endLine)),
          `${where} 의 contextRegion 모양이 다릅니다.`,
        );
      }
      need(
        isObj(r.partialFingerprints) && isStr(r.partialFingerprints[FINGERPRINT_KEY]),
        `${where}.partialFingerprints 에 ${FINGERPRINT_KEY} 가 없습니다.`,
      );
      const p = r.properties;
      if (!need(isObj(p), `${where}.properties 가 없습니다.`) || !isObj(p)) return;
      need(isOutcome(p.outcome), `${where}.properties.outcome 이 모르는 값입니다: ${String(p.outcome)}`);
      need(isStr(p.law), `${where}.properties.law 가 없습니다.`);
      need(isScope(p.scope), `${where}.properties.scope 가 모르는 값입니다.`);
      for (const key of ["untestedReasons", "aiPending", "decisionPath"] as const) {
        need(isStrArr(p[key]), `${where}.properties.${key} 는 문자열 배열이어야 합니다.`);
      }
      need(
        isUnsatisfiedAlternatives(p.unsatisfiedAlternatives),
        `${where}.properties.unsatisfiedAlternatives 모양이 다릅니다.`,
      );
    });
  }
  return errors;
}

function findingOf(result: SarifResult, rules: Map<string, SarifRule>): Finding {
  const [policy, rule] = splitRuleId(result.ruleId)!;
  const described = rules.get(result.ruleId)!;
  const title = described.shortDescription.text;
  const place = result.locations[0].physicalLocation;
  const p = result.properties;
  return {
    policy,
    rule,
    outcome: p.outcome,
    file: place.artifactLocation.uri,
    // 줄이 없는 발견도 1행으로 실린다. 1행인 채로 옮긴다(위 설명).
    line: place.region.startLine,
    title,
    law: p.law,
    // 질문이 없는 정책이면 CLI 가 이 자리에 제목을 대신 싣는다. 제목을 질문으로 보이지 않게, 같으면 빈 것으로 둔다.
    ask_developer: described.help.text === title ? "" : described.help.text,
    untested_reasons: p.untestedReasons,
    ai_pending: p.aiPending,
    fingerprint: result.partialFingerprints[FINGERPRINT_KEY],
    scope: p.scope,
    region: place.contextRegion
      ? { start_line: place.contextRegion.startLine, end_line: place.contextRegion.endLine }
      : null,
    // top_level 은 SARIF 에 없다. 싣지 않는다.
    unsatisfied_alternatives: p.unsatisfiedAlternatives,
    decision_path: p.decisionPath,
  };
}

function reportOf(log: SarifLog): Report {
  const [run] = log.runs;
  const [invocation] = run.invocations;
  const props = invocation.properties;
  const engine = run.tool.extensions?.[0];

  const gaps = { unparsed: [] as string[], skipped: [] as string[], incomplete: [] as string[] };
  const engineErrors: string[] = [];
  for (const notification of invocation.toolExecutionNotifications) {
    const { id } = notification.descriptor;
    const list = GAP_LIST.get(id);
    if (list) gaps[list].push(notification.locations![0].physicalLocation.artifactLocation.uri);
    else if (id === ENGINE_ERROR) engineErrors.push(notification.message!.text!);
  }

  const rules = new Map(run.tool.driver.rules.map((rule) => [rule.id, rule]));
  return {
    tool: { name: run.tool.driver.name, version: run.tool.driver.version },
    run: {
      judge: props.judge === "none" ? null : props.judge,
      pack_digest: props.packDigest,
      ai_pending: props.aiPending,
      ...(props.aiCleared ? { ai_cleared: props.aiCleared } : {}),
      ...(props.aiDismissed ? { ai_dismissed: props.aiDismissed } : {}),
      engine: engine ? { name: engine.name, version: engine.version ?? null } : null,
      // 판정 단위 수와 검사한 파일 수는 SARIF 에 없다. 채우지 않는다.
      units: null,
      ...gaps,
      engine_errors: engineErrors,
      coverage_complete: props.coverageComplete,
    },
    findings: run.results.map((result) => findingOf(result, rules)),
  };
}

/** SARIF 를 확인하고 결과 JSON 의 모양으로 옮긴다. `parseReport` 가 `runs` 배열이 있는 입력을 여기로 넘긴다. */
export function parseSarif(input: Obj): ParseResult {
  const errors = check(input);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, report: reportOf(input as unknown as SarifLog), contract: "sarif" };
}
