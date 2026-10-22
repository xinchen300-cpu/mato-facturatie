import Link from "next/link";

export function PageHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card !p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Section({ title, step, children, aside }: { title: string; step?: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="card mb-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {step && <span className="mr-2 text-brand-700">{step}</span>}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "warning" | "error" | "success"; children: React.ReactNode }) {
  const color = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind];
  return <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${color}`}>{children}</div>;
}

export function Badge({ tone = "slate", children }: { tone?: "slate" | "green" | "amber" | "red" | "sky"; children: React.ReactNode }) {
  const color = {
    slate: "bg-slate-100 text-slate-700", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-800", sky: "bg-sky-100 text-sky-800",
  }[tone];
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{children}</span>;
}

export function Status({ value, kind }: { value: string; kind: "peppol" | "email" }) {
  if (value === "sent") return <Badge tone="green">Sent</Badge>;
  if (value === "test") return <Badge tone="sky">Sandbox</Badge>;
  if (value === "error") return <Badge tone="red">Error</Badge>;
  return <span className="text-slate-400">{kind === "peppol" ? "—" : "—"}</span>;
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 overflow-x-auto sm:mx-0">{children}</div>;
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="font-medium text-brand-700 underline-offset-2 hover:underline">{children}</Link>;
}
