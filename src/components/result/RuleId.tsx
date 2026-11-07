import Link from "next/link";
import { policyHref } from "@/lib/pack/href";

/**
 * 규칙 id. 이 사이트의 팩에 있는 규칙이면 조문 도감의 그 정책 쪽으로 잇고(`policyHref`), 없으면(다른 판의 팩, 손으로 만든
 * 파일) 글로만 적는다. 프리페치는 끈다(연 파일의 내용에 따라 달라지는 요청이 나가지 않게).
 */
export function RuleId({ policy, rule, inPack }: { policy: string; rule: string; inPack: boolean }) {
  const id = <code translate="no">{rule}</code>;
  return inPack ? (
    <Link href={policyHref(policy)} prefetch={false}>
      {id}
    </Link>
  ) : (
    id
  );
}
