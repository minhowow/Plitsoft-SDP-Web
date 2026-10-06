import { messaging } from "./firebase";
import { findMarketingSubscribers } from "./subscribers";

export async function sendWeekendSale() {
  const users = await findMarketingSubscribers();
  await messaging.sendEachForMulticast({
    tokens: users.map((u) => u.pushToken),
    notification: {
      title: "주말 특가 최대 50% 할인",
      body: "지금 앱에서 쿠폰을 받으세요.",
    },
  });
}
