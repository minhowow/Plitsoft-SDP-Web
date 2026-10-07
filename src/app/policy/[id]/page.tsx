import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PolicyDetail } from "@/components/policy/PolicyDetail";
import { findPolicyBySlug, packMeta, policySlug } from "@/lib/pack";

type Params = { params: Promise<{ id: string }> };

// 정적 내보내기에서는 빌드 때 아는 정책만 페이지가 된다.
// 주소의 [id] 자리에는 정책 id 의 점을 빼기표로 바꾼 이름이 온다(policySlug).
export const dynamicParams = false;

export function generateStaticParams() {
  return packMeta.policies.map((policy) => ({ id: policySlug(policy.id) }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const policy = findPolicyBySlug(id);
  return { title: policy ? policy.title : "조문 도감" };
}

export default async function PolicyPage({ params }: Params) {
  const { id } = await params;
  const policy = findPolicyBySlug(id);
  if (!policy) notFound();

  // 빌드할 때 팩 메타데이터를 읽어 그린다. 그리는 것은 서버 부품이라, 팩 메타데이터가 브라우저로 통째로 가지 않는다.
  // 팩의 작성자 메모는 싣지 않는다. 조문이 아닌 글에 처분·액수 같은 법 관련 주장이 들어 있을 수 있다.
  // 실을지는 사람이 정한다(docs/ROADMAP.md "사람 결정이 필요한 것").
  return <PolicyDetail policy={policy} pack={packMeta.pack} />;
}
