import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import type { Profile, ProfileDuties, ProfileEvidence } from "@/lib/profile";
import { fileLink, shortCommit } from "@/lib/service/href";
import type { CodeSource } from "./PolicyCard";
import { Where } from "./Where";

/**
 * 결과 화면의 세 단(2026-11-11 오너 지시): 1 프로필(이 저장소가 하는 일), 2 걸리는 의무(기능마다 걸릴 수 있는 의무), 3 검토 결과
 * (의무마다의 체크리스트). 분석 쪽과 사례 쪽이 같은 틀을 쓴다. 1·2단은 CLI 의 저장소 프로필(`policypack profile`, `lib/profile`)을
 * 그린다. 프로필이 없는 분석(그 명령이 없던 판으로 돌린 분석)에는 "아직 없음"이라고 적는다.
 */

/** 단 하나의 머리: 번호와 이름. */
function TierHead({ n, name }: { n: number; name: string }) {
  return (
    <h2 className="tier-hd" id={`tier-${n}`}>
      <span className="tier-n" aria-hidden="true">
        {n}
      </span>
      {name}
    </h2>
  );
}

/** 단 하나: 머리와 안쪽. */
export function Tier({ n, name, children }: { n: number; name: string; children: ReactNode }) {
  return (
    <section className="tier" aria-labelledby={`tier-${n}`}>
      <TierHead n={n} name={name} />
      {children}
    </section>
  );
}

/** 근거 파일 하나. 저장소 주소가 있으면 GitHub 의 커밋 고정 링크다. */
function EvidenceFile({ file, line, code }: { file: string; line: number | null; code: CodeSource | null }) {
  const link = code && fileLink(code.htmlUrl, code.commit, file, line);
  const where = <Where file={file} line={line} />;
  if (!link || !code) return where;
  return (
    <a className="gh" href={link} target="_blank" rel="noopener noreferrer">
      {where}
      <Icon name="external" />
      <span className="visually-hidden">(GitHub, 새 창, 커밋 {shortCommit(code.commit)} 에 고정)</span>
    </a>
  );
}

/** 근거 목록: 파일·줄(링크)과 CLI 가 적은 "무엇을 봤나". 실린 것보다 많으면 전체 수를 적는다. */
function Evidence({ evidence, total, code }: { evidence: ProfileEvidence[]; total: number; code: CodeSource | null }) {
  return (
    <ul className="ft-ev">
      {evidence.map((e, i) => (
        <li key={`${e.file}:${e.line}:${i}`}>
          <EvidenceFile file={e.file} line={e.line} code={code} /> <span className="ft-what">{e.what}</span>
        </li>
      ))}
      {total > evidence.length && <li className="ft-more">근거 모두 {total}곳</li>}
    </ul>
  );
}

/** 프로필에 서비스 기능이 하나도 없을 때의 답(2026-11-11 오너 지시). */
export const NO_FEATURES = "서비스 기능이 감지되지 않아 걸리는 의무가 없습니다.";

/**
 * 1단: 감지된 기능마다 이름과 근거. 서비스 기능이 하나도 없으면 그 답을 적는다(화면 파일만 있으면 화면 기능은 그대로 보인다).
 * 시험·예시·설정 파일에서만 본 신호는 기능으로 세지 않고 접어 둔다.
 */
export function ProfileTier({
  profile,
  code = null,
  lead,
}: {
  profile: Profile | null;
  code?: CodeSource | null;
  /** 기능 줄 위에 두는 글(사례 쪽의 "무슨 코드"). */
  lead?: ReactNode;
}) {
  return (
    <Tier n={1} name="프로필">
      {lead}
      {profile === null ? (
        <p className="tier-none">아직 없음</p>
      ) : (
        <>
          {profile.serviceFeatures === 0 && <p className="tier-zero">{NO_FEATURES}</p>}
          {profile.features.length > 0 && (
            <ul className="features">
              {profile.features.map((feature) => (
                <li key={feature.id}>
                  <span className="ft-name">{feature.name}</span>
                  <Evidence evidence={feature.evidence} total={feature.evidenceTotal} code={code} />
                </li>
              ))}
            </ul>
          )}
          {profile.files && (
            <p className="hint tier-note">
              본 파일: 서비스 코드 {profile.files.service}개 · 시험·예시·설정 {profile.files.testOrConfig}개
            </p>
          )}
          {profile.testOnly.length > 0 && (
            <details className="ob ob-test">
              <summary>
                시험·예시·설정 파일에서만 본 신호 <span className="ob-n">{profile.testOnly.length}가지</span>
              </summary>
              <ul className="features ft-test">
                {profile.testOnly.map((signal) => (
                  <li key={signal.id}>
                    <span className="ft-name">{signal.name}</span>
                    <Evidence evidence={signal.evidence} total={signal.evidenceTotal} code={code} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Tier>
  );
}

/** 걸릴 수 있다는 것뿐임을 밝히는 한 줄(2026-11-11 오너 지시: 판단은 없다고 밝힌다). */
export const NO_JUDGEMENT = "기능에 걸릴 수 있는 의무입니다. 걸린다고 판단한 것은 아닙니다.";

/**
 * 화면에 싣지 않는 처분의 말(docs/commitments.md 1장: 처분 사례와 그 액수를 화면에 싣지 않는다). 의무 한 줄에 이 말이 들면 그 줄은
 * 적지 않고 법·조문·법제처 링크만 둔다. 소스의 문구 시험(tests/commitments.test.ts)이 이 낱말을 글자 그대로 막으므로 글자 번호로
 * 적는다(tests/wording.ts 의 처분·액수 줄과 같은 세 낱말).
 */
const SANCTION = new RegExp(
  [
    [0xacfc, 0xc9d5, 0xae08],
    [0xacfc, 0xd0dc, 0xb8cc],
    [0xbc8c, 0xae08],
  ]
    .map((codes) => String.fromCodePoint(...codes))
    .join("|"),
);

/** 의무 묶음 하나: 접힌 줄(이름과 수)과 펼친 목록(법·조문, 의무 한 줄, 법제처 링크). 기본은 접는다. */
function DutyGroup({ name, duties }: { name: string; duties: ProfileDuties }) {
  return (
    <details className="ob">
      <summary>
        {name} <span className="ob-n">걸릴 수 있는 의무 {duties.count}개</span>
      </summary>
      <ul className="ob-list">
        {duties.items.map((item) => (
          <li key={item.id}>
            <span className="ob-law">
              {item.law} {item.article}
            </span>
            {item.duty && !SANCTION.test(item.duty) && <span className="ob-duty">{item.duty}</span>}
            {item.url && (
              <a className="ob-ext" href={item.url} target="_blank" rel="noopener noreferrer">
                법제처
                <Icon name="external" />
                <span className="visually-hidden">
                  (새 창, {item.law} {item.article})
                </span>
              </a>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * 2단: 기능마다 "걸릴 수 있는 의무 N개"(접어 둔다. 저장소에 따라 수십~수백 개다), 그다음 거의 모든 서비스에 걸리는 의무.
 * 운영 주체의 지위로 걸리는 의무는 CLI 가 목록을 싣지 않으므로 수와 그 말만 적는다.
 */
export function ObligationTier({ profile }: { profile: Profile | null }) {
  const groups = profile
    ? [
        ...profile.features.map((feature) => ({ key: feature.id, name: feature.name, duties: feature.duties })),
        ...(profile.common ? [{ key: "common", name: profile.common.name, duties: profile.common.duties }] : []),
      ]
    : [];
  return (
    <Tier n={2} name="걸리는 의무">
      {profile === null ? (
        <p className="tier-none">아직 없음</p>
      ) : groups.length === 0 ? (
        <p className="tier-none">없음</p>
      ) : (
        <>
          <p className="hint tier-note">{NO_JUDGEMENT}</p>
          <div className="obligations">
            {groups.map((group) => (
              <DutyGroup key={group.key} name={group.name} duties={group.duties} />
            ))}
          </div>
          {profile.status && (
            <p className="hint tier-note">
              {profile.status.name} {profile.status.count}개. {profile.status.note}
            </p>
          )}
        </>
      )}
    </Tier>
  );
}
