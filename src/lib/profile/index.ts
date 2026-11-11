/**
 * 저장소 프로필: `policypack profile <폴더>` 의 JSON(CLI fe98fb7 부터, `profile_version: 1`). 결과 화면의 1단(감지된 기능과 그
 * 근거)과 2단(기능마다 걸릴 수 있는 의무)이 이것을 그린다(2026-11-11 오너 지시). 모델 호출 없이 CLI 가 코드의 신호(패키지·import·
 * 호출·경로·화면 파일)로 고른 것이고, 판단은 하지 않는다(목록 층).
 *
 * 화면이 쓰는 필드만 읽는다. 판 번호가 1 이 아니거나 모양이 다르면 읽지 않는다(null). CLI 는 판 안에서 키를 더하기만 한다(그 CLI 의
 * docs/output.md). 모르는 키는 버리지 않고 그대로 두지만 화면은 쓰지 않는다.
 */

/** 기능의 근거 하나: 파일, 줄(모르면 null), 신호 종류, CLI 가 적은 "무엇을 봤나". */
export interface ProfileEvidence {
  file: string;
  line: number | null;
  signal: string;
  what: string;
}

/** 걸릴 수 있는 의무 하나: 법, 조문, 의무 한 줄, 법제처 링크. CLI 의 기능–의무 표에서 온 글 그대로다. */
export interface ProfileDuty {
  id: string;
  law: string;
  article: string;
  duty: string;
  url: string | null;
}

/** 의무 묶음: 수와 목록. */
export interface ProfileDuties {
  count: number;
  items: ProfileDuty[];
}

export interface ProfileFeature {
  id: string;
  name: string;
  /** 앞의 몇 개만 실린다(CLI 는 5개). 전체 수는 `evidenceTotal`. */
  evidence: ProfileEvidence[];
  evidenceTotal: number;
  duties: ProfileDuties;
}

export interface Profile {
  features: ProfileFeature[];
  /** 화면·앱(web-ui·mobile-app)을 뺀 기능 수. */
  serviceFeatures: number;
  /** 서비스 기능이 없을 때 CLI 가 적은 말. */
  note: string | null;
  /** 거의 모든 서비스에 걸리는 의무(서비스 기능이 하나라도 있을 때만). */
  common: { name: string; duties: ProfileDuties } | null;
  /** 운영 주체의 지위로 걸리는 의무의 수와 그 말(목록은 없다). */
  status: { name: string; count: number; note: string } | null;
  /** 시험·픽스처·설정 파일에서만 본 기능 신호. 기능으로 세지 않는다. */
  testOnly: { id: string; name: string; evidence: ProfileEvidence[]; evidenceTotal: number }[];
  files: { service: number; testOrConfig: number } | null;
  totals: { features: number; duties: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function evidenceOf(v: unknown): ProfileEvidence[] | null {
  if (!Array.isArray(v)) return null;
  const out: ProfileEvidence[] = [];
  for (const e of v) {
    if (!isObj(e) || str(e.file) === null) return null;
    out.push({ file: e.file as string, line: num(e.line), signal: str(e.signal) ?? "", what: str(e.what) ?? "" });
  }
  return out;
}

function dutiesOf(v: unknown): ProfileDuties | null {
  if (!isObj(v) || num(v.count) === null || !Array.isArray(v.items)) return null;
  const items: ProfileDuty[] = [];
  for (const it of v.items) {
    if (!isObj(it) || str(it.id) === null || str(it.law) === null || str(it.article) === null) return null;
    items.push({ id: it.id as string, law: it.law as string, article: it.article as string, duty: str(it.duty) ?? "", url: str(it.url) });
  }
  return { count: v.count as number, items };
}

/** 프로필 JSON 을 읽는다. 판이 1 이 아니거나 화면이 쓰는 필드의 모양이 다르면 null. */
export function parseProfile(data: unknown): Profile | null {
  if (!isObj(data) || data.profile_version !== 1 || !Array.isArray(data.features)) return null;
  const features: ProfileFeature[] = [];
  for (const f of data.features) {
    if (!isObj(f) || str(f.id) === null || str(f.name) === null) return null;
    const evidence = evidenceOf(f.evidence);
    const duties = dutiesOf(f.duties);
    if (!evidence || !duties) return null;
    features.push({ id: f.id as string, name: f.name as string, evidence, evidenceTotal: num(f.evidence_total) ?? evidence.length, duties });
  }
  const common = isObj(data.common) && dutiesOf(data.common.duties) ? { name: str(data.common.name) ?? "", duties: dutiesOf(data.common.duties)! } : null;
  const status =
    isObj(data.status) && num(data.status.count) !== null
      ? { name: str(data.status.name) ?? "", count: data.status.count as number, note: str(data.status.note) ?? "" }
      : null;
  const testOnly = (Array.isArray(data.test_only) ? data.test_only : []).flatMap((t) => {
    if (!isObj(t) || str(t.id) === null || str(t.name) === null) return [];
    const evidence = evidenceOf(t.evidence) ?? [];
    return [{ id: t.id as string, name: t.name as string, evidence, evidenceTotal: num(t.evidence_total) ?? evidence.length }];
  });
  const files =
    isObj(data.files) && num(data.files.service) !== null && num(data.files.test_or_config) !== null
      ? { service: data.files.service as number, testOrConfig: data.files.test_or_config as number }
      : null;
  const totals = isObj(data.totals) ? data.totals : {};
  const dutyTotal = features.reduce((sum, f) => sum + f.duties.count, 0) + (common?.duties.count ?? 0);
  return {
    features,
    serviceFeatures: num(data.service_features) ?? features.length,
    note: str(data.note),
    common,
    status,
    testOnly,
    files,
    totals: { features: num(totals.features) ?? features.length, duties: num(totals.duties) ?? dutyTotal },
  };
}

/** 프로필 JSON 글을 읽는다(DB·실행기 콜백에 글로 실린다). 읽지 못하면 null. */
export function parseProfileText(text: string | null | undefined): Profile | null {
  if (!text) return null;
  try {
    return parseProfile(JSON.parse(text));
  } catch {
    return null;
  }
}

/** 목록 줄에 짧게 싣는 기능 이름(감지된 순서). 화면·앱 기능은 서비스 기능 뒤에 둔다. */
export function featureNames(profile: Profile): string[] {
  const screen = new Set(["web-ui", "mobile-app"]);
  return [...profile.features.filter((f) => !screen.has(f.id)), ...profile.features.filter((f) => screen.has(f.id))].map((f) => f.name);
}
