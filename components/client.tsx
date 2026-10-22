"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

export type Message = { kind: "success" | "error" | "info"; text: string };
export type ActionState = { messages: Message[] } | null;
export type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

const COLORS: Record<Message["kind"], string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

export function Messages({ messages }: { messages: Message[] }) {
  if (!messages.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {messages.map((m, i) => (
        <div key={i} className={`rounded-lg border px-3 py-2 text-sm ${COLORS[m.kind]}`}>{m.text}</div>
      ))}
    </div>
  );
}

/** A form whose server action returns messages, shown above the fields. */
export function ActionForm({ action, children, className }: { action: Action; children: React.ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      <Messages messages={state?.messages ?? []} />
      {children}
    </form>
  );
}

export function Submit({ children, className = "btn-primary", name, value, disabled, confirm }: {
  children: React.ReactNode; className?: string; name?: string; value?: string; disabled?: boolean; confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit" name={name} value={value} className={className} disabled={pending || disabled}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

export function MonthPicker({ periods, value, labels }: { periods: string[]; value: string; labels: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select
      className="input w-auto min-w-48" value={value} aria-label="Month"
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("m", e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      {periods.map((p) => <option key={p} value={p}>{labels[p]}</option>)}
    </select>
  );
}

/** Tick or untick every checkbox with this name inside the same form. */
export function ToggleAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox" aria-label="Select all" className="size-4 accent-brand-700"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((box) => {
          if (!box.disabled) box.checked = e.currentTarget.checked;
        });
      }}
    />
  );
}

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/month", label: "Close the month" },
  { href: "/invoices", label: "Invoices" },
  { href: "/clients", label: "Clients" },
  { href: "/contracts", label: "Contracts" },
  { href: "/settings", label: "Settings" },
];

export function Nav({ org, email, demo }: { org: string; email: string; demo: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const link = (item: (typeof NAV)[number]) => {
    const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
    return (
      <Link key={item.href} href={item.href} onClick={() => setOpen(false)}
            className={`block rounded-lg px-3 py-2 text-sm font-medium ${active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100"}`}>
        {item.label}
      </Link>
    );
  };
  return (
    <>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="font-semibold text-brand-800">Mato Facturatie</span>
        <button className="btn-secondary px-3 py-1.5" onClick={() => setOpen(!open)} aria-expanded={open}>Menu</button>
      </header>
      {open && <nav className="border-b border-slate-200 bg-white p-3 lg:hidden">{NAV.map(link)}</nav>}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        <div className="mb-6 px-3">
          <div className="text-lg font-semibold text-brand-800">Mato Facturatie</div>
          <div className="text-xs text-slate-500">{org}</div>
        </div>
        <nav className="space-y-1">{NAV.map(link)}</nav>
        <div className="mt-auto px-3 text-xs text-slate-500">
          {demo && <div className="mb-2 rounded bg-amber-100 px-2 py-1 font-medium text-amber-900">Demo · made-up data</div>}
          <div className="truncate">{email}</div>
          {!demo && (
            <form action="/auth/signout" method="post"><button className="mt-1 underline">Sign out</button></form>
          )}
        </div>
      </aside>
    </>
  );
}
