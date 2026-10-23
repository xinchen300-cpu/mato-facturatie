import { deleteClient, saveClient } from "@/app/actions";
import { ActionForm, Submit } from "@/components/client";
import { Badge, PageHeader, Section } from "@/components/ui";
import { addDays, formatIban, ibanProblem, todayIso, vatProblem } from "@/lib/belgium";
import { clientTerminals, ownerNames } from "@/lib/month";
import { getStore } from "@/lib/store";
import type { Client } from "@/lib/types";

function ClientForm({ client, owners, taken }: { client?: Client; owners: [string, string][]; taken: Map<string, string> }) {
  const field = (name: keyof Client, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" name={name} defaultValue={client ? String(client[name] ?? "") : name === "country" ? "BE" : ""} {...props} />
    </div>
  );
  return (
    <ActionForm action={saveClient} className="space-y-4">
      {client && <input type="hidden" name="id" value={client.id} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("name", "Name", { required: true })}
        {field("vat_number", "VAT number", { placeholder: "BE0123456789" })}
        {field("iban", "IBAN (payout)", { placeholder: "BE68 5390 0754 7034" })}
        {field("street", "Street + number")}
        {field("zipcode", "Postcode")}
        {field("city", "City")}
        {field("country", "Country", { maxLength: 2 })}
        {field("email", "Invoice e-mail", { placeholder: "boekhouding@...", type: "text" })}
        {field("cc_email", "CC e-mail")}
      </div>
      <div>
        <label className="label">Sales from MATO Info that count for this client</label>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {owners.map(([key, name]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="owners" value={key} defaultChecked={client?.owners.includes(key)} className="size-4 accent-brand-700" />
              {name}
              {taken.get(key) && taken.get(key) !== client?.name && <span className="text-xs text-slate-400">(now: {taken.get(key)})</span>}
            </label>
          ))}
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="own_terminal" defaultChecked={client?.own_terminal} className="mt-0.5 size-4 accent-brand-700" />
        <span>
          Own payment terminal
          <span className="block text-xs text-slate-500">
            They receive the money of their sales themselves: no payout. Type in their sales each month under Close the month →
            Own sales figures, for the commission.
          </span>
        </span>
      </label>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="label">Notes</label>
          <input className="input" name="notes" defaultValue={client?.notes ?? ""} />
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={client ? client.active : true} className="size-4 accent-brand-700" /> Active
        </label>
      </div>
      <Submit>{client ? "Save" : "Add client"}</Submit>
    </ActionForm>
  );
}

export default async function ClientsPage() {
  const store = await getStore();
  const today = todayIso();
  const [clients, catalog, history] = await Promise.all([store.clients(), store.catalog(), store.salesDaily(addDays(today, -365), today)]);
  const names = ownerNames(catalog);
  const owners = Object.entries(names).filter(([key]) => key !== "business:none").sort((a, b) => a[1].localeCompare(b[1]));
  const taken = new Map(clients.flatMap((c) => c.owners.map((o) => [o, c.name] as const)));

  return (
    <>
      <PageHeader title="Clients" />
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-slate-600">
        The businesses whose sales you pay out and invoice commission to. A client is created automatically for every business and
        partner with sales in MATO Info. Fill in their VAT number, address, e-mail and IBAN. If two MATO Info names are the same
        business (e.g. SFERIO and Sferio), tick both on one client. Next to each client are the Payter terminals (Apollo) their
        sales come through, from MATO Info.
      </p>
      <Section title="Add a client">
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">New client</summary>
          <div className="mt-4"><ClientForm owners={owners} taken={taken} /></div>
        </details>
      </Section>
      <div className="space-y-3">
        {clients.map((client) => {
          const issues = [vatProblem(client.vat_number), client.email ? null : "no e-mail", client.own_terminal ? null : ibanProblem(client.iban),
                          client.street && client.city ? null : "address incomplete",
                          client.owners.length || client.own_terminal ? null : "no MATO Info sales linked"]
            .filter(Boolean) as string[];
          const terminals = clientTerminals(client, catalog, history);
          return (
            <details key={client.id} className="card !p-0">
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 sm:px-6">
                <span className="font-medium">{client.name}</span>
                {!client.active && <Badge>inactive</Badge>}
                {client.own_terminal && <Badge tone="sky">own terminal</Badge>}
                <span className="text-sm text-slate-500">{client.email}</span>
                <span className="font-mono text-xs text-slate-500">{formatIban(client.iban)}</span>
                {terminals.length > 0 && (
                  <span className="font-mono text-xs text-slate-500" title="Payter terminal(s)">
                    {terminals.map((t) => t.serial).join(", ")}
                  </span>
                )}
                {issues.length > 0 && client.active && <Badge tone="amber">{issues.length} to check</Badge>}
              </summary>
              <div className="border-t border-slate-100 p-4 sm:p-6">
                {issues.length > 0 && <p className="mb-4 text-xs text-amber-800">{issues.join(" · ")}</p>}
                <p className="mb-4 text-sm text-slate-600">
                  <span className="font-medium">Terminals: </span>
                  {terminals.length
                    ? terminals.map((t, i) => (
                        <span key={t.serial}>{i > 0 && ", "}{t.name} <span className="font-mono text-xs">{t.serial}</span></span>
                      ))
                    : <span className="text-slate-400">{client.own_terminal ? "their own" : "none linked in MATO Info"}</span>}
                </p>
                <ClientForm client={client} owners={owners} taken={taken} />
                <ActionForm action={deleteClient} className="mt-3">
                  <input type="hidden" name="id" value={client.id} />
                  <Submit className="text-xs text-red-700 underline" confirm={`Delete ${client.name}?`}>Delete client</Submit>
                </ActionForm>
              </div>
            </details>
          );
        })}
      </div>
    </>
  );
}
