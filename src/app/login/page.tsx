import { getT } from "@/lib/i18n/server";
import { LoginForm } from "@/components/LoginForm";

export async function generateMetadata() {
  const t = await getT();
  return { title: t("Giriş · Readflow") };
}

export default async function LoginPage() {
  const t = await getT();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Readflow</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          {t("Devam etmek için giriş yapın.")}</p>
      </div>
      <LoginForm />
    </div>
  );
}
