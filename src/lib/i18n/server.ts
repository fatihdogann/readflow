import { cookies } from "next/headers";
import { parseLocale, translator } from "./index";

export async function getLocale() {
  return parseLocale((await cookies()).get("readflow-language")?.value);
}

export async function getT() {
  return translator(await getLocale());
}
