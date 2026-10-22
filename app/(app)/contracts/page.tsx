import { deleteContract, saveContract } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { Badge, PageHeader, Section } from "@/components/ui";
import { addDays, todayIso } from "@/lib/belgium";
import { describePeriod, machineKey, summary } from "@/lib/contracts";
import { machineLabel } from "@/lib/month";
import { getStore } from "@/lib/store";
import type { Client, Contract } from "@/lib/types";

function ContractForm({ contract, clients, machines, clientId }: {
  contract?: Contract; clients: Client[]; machines: Map<number, [string, string][]>; clientId?: number;
}) {
  const owner = contract?.client_id ?? clientId;
  const options = owner ? machines.get(owner) ?? [] : [];
  const num = (name: keyof Contract, label: string, step = "0.01", hint?: string) => (
    <div>
      <label className="label" title={hint}>{label}</label>
      <input className="input" name={name} type="number" step={step} min="0" defaultValue={contract ? String(contract[name] ?? 0) : name === "sales_vat_pct" ? "6" : "0"} />
    </div>
  );
  return (
    <ActionForm action={saveContract} className="space-y-4">
      {contract && <input type="hidden" name="id" value={contract.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">Client</label>
          <select className="input" name="client_id" defaultValue={owner ?? ""} required>
            <option value="" disabled>Choose…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Contract name (optional)</label>
          <input className="input" name="name" defaultValue={contract?.name ?? ""} placeholder="e.g. Huur 2026" />
        </div>
        <div>
          <label className="label">From</label>
          <input className="input" name="starts_on" type="date" defaultValue={contract?.starts_on ?? todayIso().slice(0, 8) + "01"} required />
        </div>
        <div>
          <label className="label">Until (empty = running)</label>
          <input className="input" name="ends_on" type="date" defaultValue={contract?.ends_on ?? ""} />
        </div>
        {num("pct", "% of sales", "0.01")}
        <div>
          <label className="label">% on</label>
          <select className="input" name="base" defaultValue={contract?.base ?? "incl"}>
            <option value="incl">Sales incl. VAT</option>
            <option value="excl">Sales excl. VAT</option>
          </select>
        </div>
        {num("sales_vat_pct", "VAT inside the sales %", "1", "Only for '% on sales excl. VAT'")}
        {num("per_item", "€ per item sold")}
        {num("fixed_monthly", "€ fixed per month")}
        {num("minimum_monthly", "€ minimum per month")}
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="prorate" defaultChecked={contract ? contract.prorate : true} className="size-4 accent-brand-700" />
          Pro rata in a partial month
        </label>
      </div>
      {options.length > 1 && (
        <div>
          <label className="label">Only these machines (none ticked = all the client&apos;s sales)</label>
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="machines" value={key} defaultChecked={contract?.machines.includes(key)} className="size-4 accent-brand-700" />
                {label}
              </label>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="label">Notes</label>
        <input className="input" name="notes" defaultValue={contract?.notes ?? ""} />
      </div>
      <Submit>{contract ? "Save contract" : "Add contract"}</Submit>
    </ActionForm>
  );
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client: chosen } = await searchParams;
  const store = await getStore();
  const today = todayIso();
  const [clients, contracts, catalog, history] = await Promise.all([
    store.clients(), store.contracts(), store.catalog(), store.salesDaily(addDays(today, -365), today),
  ]);
  // The machines each client sold in during the last year, to limit a contract to some of them.
  const machines = new Map<number, [string, string][]>();
  for (const c of clients) {
    const keys = new Map<string, string>();
    for (const r of history) if (c.owners.includes(r.owner)) keys.set(machineKey(r), machineLabel(r.owner, r.machine_id, catalog));
    machines.set(c.id, [...keys.entries()].sort((a, b) => a[1].localeCompare(b[1])));
  }
  const running = (c: Contract) => !c.ends_on || c.ends_on >= today;

  return (
    <>
      <PageHeader title="Contracts" />
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-slate-600">
        What you charge each client. A contract can combine a <strong>%</strong> of sales, an amount <strong>per item</strong>,
        a <strong>fixed amount per month</strong> and a <strong>monthly minimum</strong>. When a deal changes, give the old
        contract an end date and add a new one: that month is split exactly at the date.
      </p>
      <Section title="Add a contract">
        <details open={Boolean(chosen)}>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">New contract</summary>
          <div className="mt-4"><ContractForm clients={clients} machines={machines} clientId={chosen ? Number(chosen) : undefined} /></div>
        </details>
      </Section>
      <div className="space-y-6">
        {clients.filter((c) => c.active).map((client) => {
          const own = contracts.filter((c) => c.client_id === client.id);
          return (
            <section key={client.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">{client.name}</h2>
                <a className="text-sm font-medium text-brand-700 underline" href={`/contracts?client=${client.id}`}>+ Contract</a>
              </div>
              {!own.length && <p className="text-sm text-amber-800">No contract yet: this client gets an afrekening but no invoice.</p>}
              <div className="space-y-2">
                {own.map((c) => (
                  <details key={c.id} className="rounded-lg border border-slate-200">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <span className="font-medium">{c.name || "Contract"}</span>
                      <span className="text-slate-500">{describePeriod(c)}</span>
                      <span>{summary(c)}</span>
                      {running(c) ? <Badge tone="green">running</Badge> : <Badge>ended</Badge>}
                    </summary>
                    <div className="border-t border-slate-100 p-3">
                      <ContractForm contract={c} clients={clients} machines={machines} />
                      <ActionForm action={deleteContract} className="mt-3">
                        <input type="hidden" name="id" value={c.id} />
                        <Submit className="text-xs text-red-700 underline" confirm="Delete this contract? (Better: give it an end date.)">Delete contract</Submit>
                      </ActionForm>
                    </div>
                  </details>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
