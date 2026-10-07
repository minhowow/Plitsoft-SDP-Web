import type { Report } from "@/lib/report/types";

/**
 * 결과 JSON 을 CLI 가 SARIF 로 내는 방식대로 옮긴다. 시험에서만 쓰는 흉내다. 실제 CLI 출력이 아니다.
 *
 * 실제 SARIF 수집본은 `contract/cli-current/kids-signup.main.sarif` 하나뿐이다. 그 하나로는 볼 수 없는 모양(발견이
 * 여럿인 결과, 다 보지 못한 파일, 줄이 없는 발견, 함수 단위 판정, 판정자를 켠 결과)을 시험하려고, 결과 JSON 에서
 * SARIF 를 만들어 쓴다. 만드는 법은 CLI 소스 `report/sarif.py` 를 보고 맞췄다(커밋 `8ae72d8`).
 *
 * - 이 흉내가 실제 수집본과 어긋나지 않는지는 `tests/sarif.test.tsx` 가 본다(같은 검사의 JSON 수집본에서 만든 것이
 *   SARIF 수집본에 그대로 들어 있어야 한다).
 * - 다 보지 못한 파일의 알림, 엔진을 돌리지 않은 결과, 줄이 1행인 발견, 판단 보류 발견은 CLI 0.3.0.dev0 을 합성
 *   폴더에 돌려 낸 SARIF 와도 맞춰 봤다(2026-10-07. 그 출력은 저장소에 두지 않았다. `docs/architecture.md`).
 * - 줄이 없는 발견과 함수 단위 판정, 판정자를 켠 결과는 CLI 로 만들어 보지 못했다. 소스에서 읽은 대로다.
 *
 * 웹이 읽는 필드만 만든다. `rules[].help.markdown`(조문 원문과 팩 작성자 메모)처럼 읽지 않는 것은 만들지 않는다.
 */
export function toSarif(report: Report): Record<string, unknown> {
  const { run, findings } = report;

  // 발견을 낸 규칙만, 처음 나온 순서로 싣는다.
  const rules: { id: string; shortDescription: { text: string }; help: { text: string } }[] = [];
  const ruleIndex = new Map<string, number>();
  for (const f of findings) {
    const id = `${f.policy}/${f.rule}`;
    if (ruleIndex.has(id)) continue;
    ruleIndex.set(id, rules.length);
    // 질문이 없는 정책이면 CLI 는 제목을 대신 싣는다.
    rules.push({ id, shortDescription: { text: f.title }, help: { text: f.ask_developer || f.title } });
  }

  const gap = (kind: string, file: string) => ({
    level: "warning",
    descriptor: { id: `policypack/${kind}` },
    locations: [{ physicalLocation: { artifactLocation: { uri: file } } }],
  });
  const notifications: Record<string, unknown>[] = [
    ...run.unparsed.map((file) => gap("unparsed", file)),
    ...run.skipped.map((file) => gap("skipped", file)),
    ...run.incomplete.map((file) => gap("engine-incomplete", file)),
  ];
  if (run.ai_pending) notifications.push({ level: "note", descriptor: { id: "policypack/ai-pending" } });
  // 어느 파일인지 모르는 엔진 오류. 위치 없이 문장만 실린다.
  for (const text of run.engine_errors) {
    notifications.push({ level: "warning", descriptor: { id: "policypack/engine-error" }, message: { text } });
  }

  const results = findings.map((f) => {
    const id = `${f.policy}/${f.rule}`;
    // 줄이 없는 발견도 1행으로 실린다.
    const place: Record<string, unknown> = { artifactLocation: { uri: f.file }, region: { startLine: f.line || 1 } };
    // 판정 구역은 줄이 그 안에 있고 두 줄 이상인 구역일 때만 실린다.
    const region = f.region;
    if (region && f.line && region.start_line <= f.line && f.line <= region.end_line && region.start_line < region.end_line) {
      place.contextRegion = { startLine: region.start_line, endLine: region.end_line };
    }
    return {
      ruleId: id,
      ruleIndex: ruleIndex.get(id),
      level: f.outcome === "needs-review" ? "warning" : "note",
      locations: [{ physicalLocation: place }],
      partialFingerprints: { "policypack/v1": f.fingerprint },
      properties: {
        outcome: f.outcome,
        law: f.law,
        untestedReasons: f.untested_reasons,
        aiPending: f.ai_pending,
        decisionPath: f.decision_path,
        unsatisfiedAlternatives: f.unsatisfied_alternatives,
        scope: f.scope,
      },
    };
  });

  const engine = run.engine;
  return {
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: { name: report.tool.name, version: report.tool.version, rules },
          // 엔진을 돌리지 않았으면 extensions 가 없다. 엔진의 판을 모르면 version 이 없다.
          ...(engine ? { extensions: [{ name: engine.name, ...(engine.version ? { version: engine.version } : {}) }] } : {}),
        },
        invocations: [
          {
            executionSuccessful: true,
            toolExecutionNotifications: notifications,
            properties: {
              // 판정자가 꺼져 있으면 JSON 은 null, SARIF 는 "none" 이다.
              judge: run.judge ?? "none",
              aiPending: run.ai_pending,
              aiCleared: run.ai_cleared ?? [],
              aiDismissed: run.ai_dismissed ?? [],
              packDigest: run.pack_digest,
              coverageComplete: run.coverage_complete,
            },
          },
        ],
        results,
      },
    ],
  };
}
