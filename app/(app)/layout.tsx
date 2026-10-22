import { redirect } from "next/navigation";

import { Nav } from "@/components/client";
import { DEMO, getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const store = await getStore();
  const user = await store.user();
  if (!user) redirect("/login");
  if (!(await store.isOwner())) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="card max-w-md text-sm">
          <h1 className="mb-2 text-lg font-semibold">No access</h1>
          <p className="text-slate-600">
            {user.email} is not an owner of this organisation in MATO Info. Sign in with the owner account.
          </p>
          <form action="/auth/signout" method="post" className="mt-4"><button className="btn-secondary">Sign out</button></form>
        </div>
      </main>
    );
  }
  const catalog = await store.catalog();
  return (
    <div className="min-h-dvh">
      <Nav org={catalog.org.name} email={user.email} demo={DEMO} />
      <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:ml-60 lg:p-8">{children}</main>
    </div>
  );
}
