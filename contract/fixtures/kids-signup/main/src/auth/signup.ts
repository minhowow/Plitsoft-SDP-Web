import { calcKoreanAge } from "./age";
import { db } from "./db";
import { redirect } from "./nav";

export async function signUp(form: SignupForm) {
  const age = calcKoreanAge(form.birthDate);
  const user = await db.user.create({ data: { ...form, age } });
  return { ok: true, userId: user.id };
}
