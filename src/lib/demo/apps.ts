import type { ReportView } from "@/lib/report/view-model";

/**
 * 데모의 판. `key` 는 폴더 이름이다(contract/fixtures/<앱>/<판>). 앞의 것이 고치기 전이다.
 *
 * `sign` 은 코드 상자에서 다른 판과 다른 줄 앞에 붙이는 표시이고(고치기 전에만 있는 줄은 −, 고친 뒤에만 있는 줄은 +),
 * `signMeans` 는 그 표시가 무엇인지 코드 상자 아래에 적는 말이다. 두 파일을 견준 것이라고만 적는다. 그 줄 때문에
 * 판정이 달라졌다고 적지 않는다. 어느 줄이 판정을 바꿨는지는 결과에 없다.
 */
export const DEMO_VARIANTS = [
  { key: "main", label: "고치기 전", sign: "−", signMeans: "고친 뒤의 파일과 견주어 빠졌거나 바뀐 줄입니다." },
  { key: "fixed", label: "고친 뒤", sign: "+", signMeans: "고치기 전의 파일과 견주어 더해졌거나 바뀐 줄입니다." },
] as const;

export type DemoVariantKey = (typeof DEMO_VARIANTS)[number]["key"];

export interface DemoAppInfo {
  /** 폴더 이름(contract/fixtures/<앱>)이자 수집본 이름의 앞부분(contract/cli-current/<앱>.<판>.json). */
  key: string;
  label: string;
  /** 이 코드가 무엇을 하는지. 두 판에 모두 맞는 말이다. */
  about: string;
  /** 고친 뒤 판에서 달라진 것. */
  fixed: string;
}

/**
 * 데모로 보이는 합성 코드. 고치기 전·후가 모두 있는 것만 싣는다.
 *
 * 설명에는 코드가 무엇을 하는지만 적는다. 코드에 적힌 것(함수, 문자열, 주소)을 그대로 옮기고, 법이 무엇을
 * 요구하는지나 결과가 어떻게 나오는지는 적지 않는다. 조문은 조문 도감에 원문으로 있고, 결과는 화면 아래에 CLI 가
 * 낸 대로 보인다. 코드(contract/fixtures)는 팩에 맞추려고 고치지 않으므로, 설명을 코드에 맞춘다
 * (`tests/demo.test.tsx` 가 설명에 든 코드 조각이 그 판의 코드에 있는지 본다).
 */
export const DEMO_APPS: readonly DemoAppInfo[] = [
  {
    key: "kids-signup",
    label: "아동 가입",
    about: "생년월일로 나이를 계산해 회원을 만드는 가입 함수입니다.",
    fixed: "고친 뒤에는 나이가 14 미만이면 회원을 만들지 않고 /signup/guardian-consent 로 보냅니다.",
  },
  {
    key: "night-push",
    label: "광고 푸시",
    about: "마케팅 수신자에게 주말 특가 푸시 알림을 보내는 함수입니다.",
    fixed:
      "고친 뒤에는 제목 앞에 (광고)를 붙이고 본문에 발신자 이름·전화번호와 수신거부 방법을 적습니다. " +
      "한국 시간 21시부터 8시 전까지는 nightAdConsent 값이 있는 수신자에게만 보냅니다.",
  },
  {
    key: "genai-chat",
    label: "생성형 AI 채팅",
    about: "useChat 으로 주고받은 메시지를 보여 주고 입력을 받는 채팅 화면입니다.",
    fixed:
      "고친 뒤에는 화면 맨 위에 '이 서비스는 생성형 인공지능을 이용해 답변합니다.'라는 문구를 두고, " +
      "assistant 의 메시지마다 'AI가 생성한 답변'이라는 표시를 붙입니다.",
  },
];

/** 코드 한 줄. */
export interface DemoLine {
  text: string;
  /** 다른 판의 같은 파일과 견주어 짝이 없는 줄(더해졌거나, 빠졌거나, 바뀌었다). 두 파일의 글자 차이다. */
  differs: boolean;
}

export interface DemoFile {
  /** 판의 폴더에서 본 경로. 결과의 `findings[].file` 과 같은 기준이다. */
  path: string;
  lines: DemoLine[];
}

export interface DemoVariant {
  key: DemoVariantKey;
  label: string;
  sign: string;
  signMeans: string;
  /** 이 판의 코드가 무엇을 하는지. */
  note: string;
  files: DemoFile[];
  /** 이 판을 검사한 CLI 출력(contract/cli-current)으로 만든 화면 구조. */
  view: ReportView;
}

export interface DemoApp {
  key: string;
  label: string;
  /** 고치기 전, 고친 뒤 순서다. */
  variants: DemoVariant[];
}
