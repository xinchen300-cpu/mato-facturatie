import { redirect } from "next/navigation";

import { signIn } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { DEMO, getStore } from "@/lib/store";

export const metadata = { title: "Sign in · Mato Facturatie" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (DEMO || (await (await getStore()).user())) redirect("/");
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <h1 className="text-xl font-semibold text-brand-800">Mato Facturatie</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Sign in with your MATO Info account.</p>
        <ActionForm action={signIn} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">E-mail</label>
            <input className="input" id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
          </div>
          <Submit className="btn-primary w-full">Sign in</Submit>
          <p className="text-xs text-slate-500">Forgot your password? Reset it in MATO Info: it is the same account.</p>
        </ActionForm>
      </div>
    </main>
  );
}
