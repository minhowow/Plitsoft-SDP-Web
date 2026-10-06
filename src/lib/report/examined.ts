import { SITE } from "@/lib/site";
import { GAPS_TITLE } from "./coverage";
import { STATUS_LABEL } from "./status";
import { CONTRACT_LABEL, type ReportView } from "./view-model";

/**
 * 빈 결과 화면(발견이 0인 결과)의 "검사한 것"에 적는 글.
 *
 * 값은 결과에 실린 수를 그대로 옮긴다. 설명은 그 수가 무엇이고 무엇이 아닌지다. 결과에 없는 것은 없다고 적고,
 * 다른 수에서 짐작해 채우지 않는다. 낱말의 뜻은 CLI 가 정한 대로다(`contract/schema/` 의 설명, CLI README 의
 * "써 보기", CLI 소스 `evaluate/engine.py` 의 evaluate 와 `discover.py` 의 admit).
 *
 * 설명은 같은 화면의 다른 글과 맞아야 한다. 화면의 다른 곳을 가리킬 때("위의 …", "아래 …")는 그곳의 이름을 그대로
 * 부르고, 그곳이 접혀 있으면 펼치라고 적는다. 아래 카드나 목록에 보이는 것과 부딪치는 말을 쓰지 않는다.
 */
export interface ExaminedFact {
  label: string;
  value: string;
  note: string;
  /** 발견이 없는 까닭이 "보지 못해서"일 수 있는 줄. 화면에서 눈에 띄게 한다. */
  warn: boolean;
}

/**
 * 판정 단위가 무엇인지. 규칙의 적용 조건이 거짓이면 단위가 생기지 않는다.
 * v1 초안 스키마가 정책별 수(`run.policies[].units`)를 설명하는 말과 같다.
 */
export const UNIT_GLOSS =
  "판정 단위는 규칙의 적용 조건이 참이거나 모름이어서 판정한 곳입니다. 규칙 하나 × 파일 하나(함수 단위 규칙이면 함수 하나)가 한 단위입니다.";

/**
 * 결과에는 검사한 파일의 수(`run.files`)만 있다. 목록도, 어느 범위를 검사했는지도 없다(`docs/cli-requests.md` 의 R14).
 *
 * 범위를 좁혀 돌린 결과(스테이징된 파일만, 기준 커밋과 갈라진 뒤 바뀐 파일만, 일부 경로만)는 전체를 검사한 결과와
 * 모양이 같고, 그 밖의 파일은 `run.skipped` 에도 실리지 않는다(CLI 를 돌려 확인했다. `docs/architecture.md` 의
 * "빈 결과 화면"). 그 수가 전체를 본 수처럼 읽히지 않게, 수 옆에 목록과 범위가 결과에 없다고 적는다. 어느 범위였는지
 * 짐작해 적지 않는다.
 *
 * "어느 파일인지 모른다"고 적지 않는다. 데모는 검사한 파일을 바로 위에 보여 주고, 충족 근거 위치(v1 초안)에도 파일
 * 이름이 나온다. 결과에 없는 것은 목록과 범위다.
 */
function filesFact(files: number | null): ExaminedFact {
  const label = "검사한 파일";
  if (files === null) {
    return { label, value: "알 수 없음", note: "파일 수가 결과에 실려 있지 않습니다.", warn: false };
  }
  if (files === 0) {
    return { label, value: "0개", note: "검사한 파일이 없어서 발견도 없습니다.", warn: true };
  }
  return {
    label,
    value: `${files}개`,
    note: "결과에는 검사한 파일의 수만 실려 있고, 목록과 검사한 범위(저장소 전체인지, 바뀐 파일이나 일부 경로만인지)는 없습니다.",
    warn: false,
  };
}

/** 정책별 요약 없이 그려진 카드의 수. v1 초안에서 요약에 없는데 발견이나 AI 가 푼 경고에만 나온 정책이다. */
function unsummarized(view: ReportView): number {
  return view.policies.filter((policy) => policy.units === null).length;
}

/**
 * CLI 0.3 의 `run.units` 는 모든 정책을 합친 수다. 정책별 수는 없다. 발견 없이 끝난 단위가 어느 정책의 것인지는
 * AI 가 푼 경고(`run.ai_cleared`)에 실린 것만 알 수 있다. 정적 조건으로 풀린 단위는 어디에도 나오지 않는다
 * (`docs/cli-requests.md` 의 R1). 그래서 정책 카드는 모두 "발견 없음"으로 같고, 결과마다 다른 것은 이 수뿐이다.
 *
 * - 수가 0이면 정책별 수도 모두 0이다. "정책별 수가 없다"는 한계가 아니므로 그렇게 적지 않고, 어느 정책에서도
 *   판정한 곳이 없다고 적는다. 그래도 카드는 "발견 없음"(충족인지 미적용인지 구분할 수 없다)으로 보이므로, 카드의
 *   설명이 판정 단위가 있는 결과와 같다는 것을 함께 적는다. 카드의 상태를 바꾸지는 않는다(관문 G1 의 일이다).
 * - AI 가 적용되지 않는다고 답해 빠진 판정(`run.ai_dismissed`)은 이 수에 들어 있지 않다. CLI 는 적용 조건이
 *   '모름'일 때만 AI 에게 적용 여부를 묻고, '아니오'를 받은 단위를 뺀 뒤에 센다(CLI 소스 `evaluate/engine.py` 의
 *   evaluate, `evaluate/planner.py`). 그 단위는 위 풀이대로라면 "모름이어서 판정한 곳"인데 수에는 없으므로, 빠진
 *   판정이 있으면 그 사실과 목록의 자리를 적는다. 그때는 수가 0이어도 판정한 곳이 없다고 적지 않는다. 빠진 판정이
 *   있었는지 모를 때(판정자를 켠 결과인데 그 목록이 실려 있지 않다)도 적지 않는다.
 */
function unitsFact(view: ReportView): ExaminedFact {
  const units = view.coverage.units;
  const dismissed = view.aiDismissed.length;
  const notes = ["모든 정책을 합친 수입니다."];

  if (view.contract === "v1-draft") {
    if (view.policyCount === 0) notes.push("결과의 정책별 요약이 비어 있어 정책별 수가 없습니다.");
    else if (unsummarized(view) > 0) notes.push("정책별 수는 아래에서 요약이 실린 정책에만 적었습니다.");
    else notes.push("정책별 수는 아래 정책마다 적었습니다.");
  } else {
    // 결과 머리의 "출력 형식"에 적힌 이름과 같게 부른다.
    const format = `이 출력 형식(${CONTRACT_LABEL[view.contract]})`;
    if (view.aiCleared.length > 0) {
      notes.push(`${format}에는 정책별 수가 없어서, 어느 정책의 것인지는 아래 'AI 가 푼 경고'에 실린 것만 알 수 있습니다.`);
    } else if (units !== 0) {
      notes.push(`${format}에는 정책별 수가 없어서, 어느 정책에서 적용 신호를 봤는지 알 수 없습니다.`);
    } else if (dismissed === 0 && view.aiDismissedKnown) {
      notes.push("0이므로 어느 정책에서도 판정한 곳이 없습니다.");
      // 아래 카드가 "발견 없음"일 때만 덧붙인다. 다른 판의 팩이면 카드는 "알 수 없음"이고, 팩 메타데이터가 없으면 카드가 없다.
      if (view.policies.some((policy) => policy.status === "not-reported")) {
        // 카드에 적힌 상태 이름 그대로 부른다.
        const shown = STATUS_LABEL["not-reported"];
        notes.push(`다만 ${format}에는 정책별 요약이 없어, 아래 정책 카드는 판정 단위가 있는 결과와 같은 설명('${shown}')으로 보입니다.`);
      }
    }
  }

  if (dismissed > 0) {
    notes.push(
      `AI 가 적용되지 않는다고 답해 빠진 판정 ${dismissed}건은 이 수에 들어 있지 않습니다. 아래 'AI 가 적용되지 않는다고 답해 빠진 판정'에서 확인하세요.`,
    );
  }
  return { label: "판정 단위", value: `${units}개`, note: notes.join(" "), warn: false };
}

/**
 * `run.skipped` 에는 CLI 가 이름을 적어 알리는 파일만 실린다(1MB 초과, 축소·번들, 읽을 수 없음, 엔진이 읽지 못하는
 * 확장자, UTF-8 아님). 대상 언어가 아닌 파일, 생성물 폴더 아래 파일, git 이 무시하는 파일, 하위 모듈처럼 저장소
 * 안에 따로 든 다른 git 저장소의 파일, 심볼릭 링크, 읽을 권한이 없는 폴더 아래 파일은 실리지 않는다. 범위를 좁혀
 * 돌렸을 때(바뀐 파일만, 일부 경로만) 그 범위 밖의 파일도 실리지 않는다. 목록이 비었다고 다 본 것이 아니므로
 * "없음"이 무엇이 없다는 뜻인지 적고, 이름 없이 빠지는 파일을 적은 곳("이 도구가 보지 못하는 것", `SITE.notSeen`)을
 * 가리킨다. 이 줄이 가리키기 때문에 그곳의 목록은 빠짐없는 것으로 읽힌다. 그곳에 없는 것이 이렇게 빠진다는 것을
 * 알게 되면 그곳에 더한다.
 *
 * 파일 목록은 이 구역 위의 "다 보지 못한 것" 표에 있다(`components/result/Coverage.tsx`). 표의 이름을 적어 가리킨다.
 * 표는 앞의 몇 곳만 먼저 보이고 나머지를 접으므로 "펼치면"이라고는 적지 않는다.
 */
function skippedFact(skipped: number): ExaminedFact {
  const label = "검사하지 않은 파일";
  if (skipped === 0) {
    return {
      label,
      value: "없음",
      note:
        "크기·인코딩 같은 까닭으로 건너뛰었다고 결과에 이름이 실린 파일이 없습니다. " +
        `이름이 실리지 않고 빠지는 파일은 아래 '${SITE.notSeen.title}'에 있습니다.`,
      warn: false,
    };
  }
  return {
    label,
    value: `${skipped}개`,
    note: `위 '${GAPS_TITLE}' 표에 목록이 있습니다. 이 파일들의 코드는 보지 못했습니다.`,
    warn: true,
  };
}

/**
 * 정책의 수와, 아래 정책 카드가 어디서 온 것인지.
 *
 * CLI 0.3 결과에는 정책 목록이 없다. 팩 판이 같은 이 사이트의 팩에서 가져온 것임을 밝힌다. v1 초안은 결과에 실린
 * 정책별 요약의 수다. 카드도 결과에 나온 정책만 그리므로(`view-model.ts`) 수와 카드가 맞는다. 맞지 않는 경우는
 * 손으로 만든 결과에서만 생긴다: 요약이 비어 있거나, 요약에 없는 정책이 AI 가 푼 경고에만 나온다. 그때는 그렇다고
 * 적는다.
 */
function policiesFact(view: ReportView): ExaminedFact {
  const label = "정책";
  if (view.policyCount === null) {
    return {
      label,
      value: "알 수 없음",
      note:
        view.packMatches === false
          ? "결과에는 정책 목록이 없고, 팩 판이 이 사이트에 실린 팩과 달라 어떤 정책으로 검사했는지 알 수 없습니다."
          : "결과에는 정책 목록이 없어 어떤 정책으로 검사했는지 알 수 없습니다.",
      warn: false,
    };
  }
  const value = `${view.policyCount}개`;
  if (view.contract !== "v1-draft") {
    return {
      label,
      value,
      note: "결과에는 정책 목록이 없어, 팩 판이 같은 이 사이트의 팩에서 가져와 아래에 적었습니다.",
      warn: false,
    };
  }
  const extra = unsummarized(view);
  const others = extra > 0 ? ` 요약에 없는 정책 ${extra}개도 아래에 있습니다. 결과의 다른 곳에만 나온 정책이라 정책별 수가 없습니다.` : "";
  if (view.policyCount === 0) {
    return {
      label,
      value,
      note: `결과의 정책별 요약이 비어 있습니다.${others || " 아래에 적을 정책이 없습니다."}`,
      warn: true,
    };
  }
  return { label, value, note: `결과에 정책별 요약이 실려 있어, 아래에 정책마다 적었습니다.${others}`, warn: false };
}

/** 파일 수, 판정 단위 수, 검사하지 않은 파일, 정책. 이 순서로 보인다. */
export function examinedFacts(view: ReportView): ExaminedFact[] {
  return [
    filesFact(view.coverage.files),
    unitsFact(view),
    skippedFact(view.coverage.skipped.length),
    policiesFact(view),
  ];
}
