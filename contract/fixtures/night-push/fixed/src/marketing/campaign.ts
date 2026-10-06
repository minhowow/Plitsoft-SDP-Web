import { messaging } from "./firebase";
import { findMarketingSubscribers } from "./subscribers";

function isNightInKorea(now: Date): boolean {
  const hour = (now.getUTCHours() + 9) % 24;
  return hour >= 21 || hour < 8;
}

export async function sendWeekendSale(now = new Date()) {
  const users = await findMarketingSubscribers();
  const targets = isNightInKorea(now) ? users.filter((u) => u.nightAdConsent) : users;
  await messaging.sendEachForMulticast({
    tokens: targets.map((u) => u.pushToken),
    notification: {
      title: "(광고) 주말 특가 최대 50% 할인",
      body: "지금 앱에서 쿠폰을 받으세요. 발신: 데모상점 02-000-0000 · 수신거부: 설정 > 알림에서 무료로 끌 수 있습니다.",
    },
  });
}
