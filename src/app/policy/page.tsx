import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { NotSeenList } from "@/components/result/Coverage";
import { StatusChip } from "@/components/result/StatusChip";
import { keepArticle } from "@/components/text";
import { packMeta, policyHref, primaryLaw } from "@/lib/pack";
import { NOT_IN_PACK } from "@/lib/pack/guide";
import { SCOPE_LEGEND } from "@/lib/report/scope";
import { STATUS_LEGEND, STATUS_ORDER } from "@/lib/report/status";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "조문 도감" };

/**
 * 조문 도감 목록(목업 policy-index, docs/redesign.md 3장). 빌드할 때 그린다.
 *
 * - 메타 한 줄: 이 도감을 만든 팩, 팩 판, 정책의 수(팩 메타데이터에서 센다).
 * - 정책마다 한 줄: 제목, 대표 조문, 규칙의 수. 줄 전체가 그 정책 쪽으로 가는 링크다.
 * - `#status` 상태의 뜻: 상태 7개(`STATUS_LEGEND`)와 판정 범위(`SCOPE_LEGEND`). 결과 화면의 곁칸과 데모의 표가 이리로 잇는다.
 * - `#scope` 검사에 들지 않는 파일과 정보(`SITE.notSeen`). 발견이 있는 결과의 검사 정보가 이리로 잇는다.
 */
export default function PolicyIndexPage() {
  const { pack, policies } = packMeta;
  return (
    <>
      {/* data-page: 머리글이 지금 쪽(조문 도감)을 표시하는 데 쓴다(CSS :has. 머리글의 HTML 은 모든 쪽에서 같다). */}
      <h1 data-page="policy">조문 도감</h1>
      <p className="pi-meta">
        <span>
          팩 {pack.id ? <code translate="no">{pack.id}</code> : NOT_IN_PACK}
        </span>{" "}
        <span>
          판 <code translate="no">{pack.digest}</code>
        </span>{" "}
        <span>정책 {policies.length}</span>
      </p>

      <ul className="policy-index">
        {policies.map((policy) => (
          <li key={policy.id}>
            <Link href={policyHref(policy.id)} className="pi-row">
              <span className="pi-title">{policy.title}</span>
              <span className="pi-law">{keepArticle(primaryLaw(policy))}</span>
              <span className="pi-n">규칙 {policy.rules.length}</span>
              <Icon name="chevron-right" />
            </Link>
          </li>
        ))}
      </ul>

      <section className="pi-sec" id="status" aria-labelledby="status-title">
        <h2 className="sec-h" id="status-title">
          상태의 뜻
        </h2>
        <dl className="box rows defs">
          {STATUS_ORDER.map((status) => (
            <div key={status}>
              <dt>
                <StatusChip status={status} />
              </dt>
              <dd>{STATUS_LEGEND[status]}</dd>
            </div>
          ))}
          {SCOPE_LEGEND.map((scope) => (
            <div key={scope.label}>
              <dt>{scope.label}</dt>
              <dd>{scope.note}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="pi-sec" id="scope" aria-labelledby="scope-title">
        <h2 className="sec-h" id="scope-title">
          {SITE.notSeen.title}
        </h2>
        <div className="box not-seen-box">
          <p className="hint">{SITE.notSeen.bookLead}</p>
          <NotSeenList />
        </div>
      </section>
    </>
  );
}
