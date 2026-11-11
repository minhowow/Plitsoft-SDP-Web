import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import { packMeta, policyHref } from "@/lib/pack";
import type { ExampleProfile } from "@/lib/profile";
import { fileLink, shortCommit } from "@/lib/service/href";
import type { CodeSource } from "./PolicyCard";
import { Where } from "./Where";

/**
 * 결과 화면의 세 단(2026-11-11 오너 지시): 1 프로필(이 저장소가 하는 일), 2 걸리는 의무(기능마다 걸릴 수 있는 의무), 3 검토 결과
 * (의무마다의 체크리스트). 분석 쪽과 사례 쪽이 같은 틀을 쓴다. 1·2단의 자료는 아직 손으로 만든 예시뿐이라(`lib/profile`) 늘
 * "예시"라고 밝히고, 예시가 없는 분석(실제 저장소)에는 "아직 없음"이라고 적는다. 서버 부품이다(팩 메타데이터를 읽는다).
 */

/** 단 하나의 머리: 번호와 이름, 예시면 그 이름표. */
function TierHead({ n, name, example }: { n: number; name: string; example: boolean }) {
  return (
    <h2 className="tier-hd" id={`tier-${n}`}>
      <span className="tier-n" aria-hidden="true">
        {n}
      </span>
      {name}
      {example && <span className="tag">예시</span>}
    </h2>
  );
}

/** 단 하나: 머리와 안쪽. */
export function Tier({ n, name, example = false, children }: { n: number; name: string; example?: boolean; children: ReactNode }) {
  return (
    <section className="tier" aria-labelledby={`tier-${n}`}>
      <TierHead n={n} name={name} example={example} />
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

/** 프로필에 기능이 하나도 없을 때의 답. */
export const NO_FEATURES = "서비스 기능이 감지되지 않아 걸리는 의무가 없습니다.";

/** 1단: 감지된 기능마다 한 줄과 근거 파일. */
export function ProfileTier({
  profile,
  code = null,
  lead,
}: {
  profile: ExampleProfile | null;
  code?: CodeSource | null;
  /** 기능 줄 위에 두는 글(사례 쪽의 "무슨 코드"). */
  lead?: ReactNode;
}) {
  return (
    <Tier n={1} name="프로필" example={profile !== null}>
      {lead}
      {profile === null ? (
        <p className="tier-none">아직 없음</p>
      ) : profile.features.length === 0 ? (
        <p className="tier-zero">{NO_FEATURES}</p>
      ) : (
        <ul className="features">
          {profile.features.map((feature) => (
            <li key={feature.name}>
              <span className="ft-name">{feature.name}</span>
              <span className="ft-files">
                {feature.evidence.map((e, i) => (
                  <span key={`${e.file}:${e.line}:${i}`}>
                    <EvidenceFile file={e.file} line={e.line} code={code} />
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tier>
  );
}

/** 걸릴 수 있다는 것뿐임을 밝히는 한 줄(2026-11-11 오너 지시: 판단은 없다고 밝힌다). */
export const NO_JUDGEMENT = "기능에 걸릴 수 있는 의무입니다. 걸린다고 판단한 것은 아닙니다.";

/**
 * 2단: 기능마다 "걸릴 수 있는 의무 N개". 펼치면 의무마다 법·조문(팩의 대표 조문), 의무 이름(팩의 정책 이름, 조문 도감으로 잇는다),
 * 법제처 링크(팩에 실린 주소). 팩에 없는 정책 id 는 건너뛴다.
 */
export function ObligationTier({ profile }: { profile: ExampleProfile | null }) {
  const policies = new Map(packMeta.policies.map((policy) => [policy.id, policy]));
  return (
    <Tier n={2} name="걸리는 의무" example={profile !== null}>
      {profile === null ? (
        <p className="tier-none">아직 없음</p>
      ) : profile.features.length === 0 ? (
        <p className="tier-none">없음</p>
      ) : (
        <>
          <p className="hint tier-note">{NO_JUDGEMENT}</p>
          <div className="obligations">
            {profile.features.map((feature) => {
              const found = feature.policies.flatMap((id) => {
                const policy = policies.get(id);
                return policy ? [policy] : [];
              });
              return (
                <details key={feature.name} className="ob">
                  <summary>
                    {feature.name} <span className="ob-n">걸릴 수 있는 의무 {found.length}개</span>
                  </summary>
                  <ul className="ob-list">
                    {found.map((policy) => {
                      const legal = policy.legal[0];
                      return (
                        <li key={policy.id}>
                          {legal && <span className="ob-law">{legal.label}</span>}
                          <Link href={policyHref(policy.id)} prefetch={false} className="ob-title">
                            {policy.title}
                          </Link>
                          {legal?.url && (
                            <a className="ob-ext" href={legal.url} target="_blank" rel="noopener noreferrer">
                              법제처
                              <Icon name="external" />
                              <span className="visually-hidden">(새 창)</span>
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </Tier>
  );
}
