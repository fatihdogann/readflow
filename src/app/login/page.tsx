import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Giriş · Readflow" };

export default function LoginPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Readflow</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
          Devam etmek için giriş yapın.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
