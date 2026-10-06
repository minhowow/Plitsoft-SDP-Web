import { calcKoreanAge } from "./age";
import { db } from "./db";
import { redirect } from "./nav";

export async function signUp(form: SignupForm) {
  const age = calcKoreanAge(form.birthDate);
  if (age < 14) return redirect("/signup/guardian-consent");
  const user = await db.user.create({ data: { ...form, age } });
  return { ok: true, userId: user.id };
}
