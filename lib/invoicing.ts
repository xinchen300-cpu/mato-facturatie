// Month closing per client: the commission invoice and the afrekening, and sending them via Billit and e-mail.
// You receive the card payments, pay each business its full sales, and charge commission on a separate invoice.

import { fmtDate, fmtEur, monthBounds, normalizeVat, periodLabel, roundMoney, sumMoney } from "./belgium";
import { BillitClient, BillitError, buildOrderPayload } from "./billit";
import { applyManual, compute, machineKey, ownersOf } from "./contracts";
import { render, sendMail, splitAddresses } from "./mailer";
import { machineLabel, machineSerial } from "./month";
import { invoicePdf, statementPdf } from "./pdf";
import type { Store } from "./store/types";
import type { Calc, Client, Invoice, Settings, Statement, StatementSnapshot } from "./types";

export function companyOf(settings: Settings): Partial<Settings> {
  const keys = Object.keys(settings).filter((k) => k.startsWith("company_") || ["accent_color", "invoice_vat_note", "invoice_footer"].includes(k));
  return Object.fromEntries(keys.map((k) => [k, settings[k as keyof Settings]]));
}

function clientCopy(client: Client): Client {
  return { ...client, vat_number: normalizeVat(client.vat_number) };
}

async function context(store: Store, period: string) {
  const { first, last } = monthBounds(period);
  const [settings, catalog, clients, contracts, terminalSales, manual] = await Promise.all([
    store.settings(), store.catalog(), store.clients(), store.contracts(), store.salesDaily(first, last), store.manualSales(period),
  ]);
  const daily = applyManual(terminalSales, clients, manual, period);
  return { settings, catalog, clients, contracts, daily, manual, first, last };
}

type Ctx = Awaited<ReturnType<typeof context>>;

async function createInvoice(store: Store, ctx: Ctx, client: Client, period: string, calc: Calc, invoiceDate: string) {
  const vatPct = Number(ctx.settings.invoice_vat_pct || 0);
  return store.createInvoice({
    clientId: client.id, period, invoiceDate, dueDays: Number(ctx.settings.invoice_due_days || 30),
    lines: calc.lines.map((l) => ({ ...l, vat_pct: vatPct })),
    snapshot: { client: clientCopy(client), company: companyOf(ctx.settings), calc },
    salesTotal: calc.sales_total, items: calc.items, subtotal: calc.subtotal, vatPct,
  });
}

async function statementSnapshot(store: Store, ctx: Ctx, client: Client, calc: Calc, invoice: Invoice | null): Promise<StatementSnapshot> {
  const own = ownersOf(client);
  const rows = ctx.daily.filter((r) => own.has(r.owner));
  // Typed in by hand (e.g. from Televend): one total, no days, products or single sales.
  const typed = ctx.manual.find((m) => m.client_id === client.id) ?? null;
  const typedLabel = typed ? `Eigen opgave${typed.note ? ` (${typed.note})` : ""}` : "";
  const machines = new Map<string, { label: string; terminal: string; items: number; revenue: number }>();
  const days = new Map<string, number>();
  for (const r of rows) {
    const key = machineKey(r);
    const m = machines.get(key) ?? {
      label: typed ? typedLabel : machineLabel(r.owner, r.machine_id, ctx.catalog),
      terminal: machineSerial(r.machine_id, ctx.catalog), items: 0, revenue: 0,
    };
    m.items += Number(r.items);
    m.revenue = roundMoney(m.revenue + Number(r.revenue));
    machines.set(key, m);
    if (!typed) days.set(r.day, roundMoney((days.get(r.day) ?? 0) + Number(r.revenue)));
  }
  const detail = client.owners.length && !typed ? await store.salesDetail(ctx.first, ctx.last, client.owners) : [];
  const products = new Map<string, { product: string; items: number; revenue: number }>();
  for (const s of detail) {
    if (!s.product) continue;
    const p = products.get(s.product) ?? { product: s.product, items: 0, revenue: 0 };
    p.items += Number(s.units);
    p.revenue = roundMoney(p.revenue + Number(s.amount));
    products.set(s.product, p);
  }
  return {
    client: clientCopy(client),
    company: companyOf(ctx.settings),
    calc,
    machines: [...machines.values()].sort((a, b) => b.revenue - a.revenue),
    products: [...products.values()].sort((a, b) => b.revenue - a.revenue),
    daily: [...days.entries()].sort().map(([day, revenue]) => ({ day, revenue })),
    sales: ctx.settings.statement_list_sales === "1"
      ? detail.map((s) => ({ at: s.at.replace(" ", "T"), machine: machineLabel(s.owner, s.machine_id, ctx.catalog),
                             slot: s.slot ?? "", product: s.product ?? "", amount: Number(s.amount) }))
      : null,
    invoice: invoice ? { number: invoice.number, total: invoice.total, due_date: invoice.due_date, payment_ref: invoice.payment_ref } : null,
    manual: typed ? { note: typed.note } : null,
  };
}

export type Made = { client: string; invoice: string | null; statement: "made" | "rebuilt" | null };

/** Invoice (when the contracts charge something) and afrekening for some clients of a month. */
export async function closeMonth(store: Store, period: string, clientIds: number[], docDate: string): Promise<{ made: Made[]; errors: string[] }> {
  const ctx = await context(store, period);
  const [invoices, statements] = await Promise.all([store.invoices({ period }), store.statements({ period })]);
  const made: Made[] = [];
  const errors: string[] = [];
  for (const id of clientIds) {
    const client = ctx.clients.find((c) => c.id === id);
    if (!client) continue;
    try {
      const calc = compute(client, period, ctx.daily, ctx.contracts);
      let invoice = invoices.find((i) => i.client_id === id) ?? null;
      const result: Made = { client: client.name, invoice: null, statement: null };
      if (calc.subtotal > 0 && !invoice) {
        invoice = await createInvoice(store, ctx, client, period, calc, docDate);
        result.invoice = invoice.number;
      }
      const existing = statements.find((s) => s.client_id === id) ?? null;
      if ((calc.sales_total || calc.subtotal) && existing?.email_status !== "sent") {
        await store.saveStatement({
          client_id: id, period, made_on: docDate, sales_total: calc.sales_total, items: calc.items,
          payout: calc.payout, invoice_id: invoice?.id ?? null,
          snapshot: await statementSnapshot(store, ctx, client, calc, invoice),
        }, existing?.id);
        result.statement = existing ? "rebuilt" : "made";
      }
      made.push(result);
    } catch (error) {
      errors.push(`${client.name}: ${(error as Error).message}`);
    }
  }
  return { made, errors };
}

/** Delete an unsent invoice (only the most recent of its year) and its unsent afrekening; the number is reused. */
export async function deleteInvoice(store: Store, invoiceId: number) {
  const invoice = await store.invoice(invoiceId);
  if (!invoice) throw new Error("Invoice not found.");
  if (invoice.peppol_status === "sent" || invoice.email_status === "sent") {
    throw new Error("Sent invoices cannot be deleted. Make a credit note in Billit instead.");
  }
  const all = await store.invoices();
  if (all.some((i) => i.year === invoice.year && i.seq > invoice.seq)) {
    throw new Error("Only the most recent invoice can be deleted (Belgian invoice numbers may not have gaps).");
  }
  const statements = await store.statements({ period: invoice.period, clientId: invoice.client_id });
  for (const s of statements) {
    if (s.email_status !== "sent") await store.deleteStatement(s.id);
    else await store.updateStatement(s.id, { invoice_id: null });
  }
  await store.deleteInvoice(invoice.id);
  await store.saveSettings({ invoice_next_number: String(invoice.seq), invoice_counter_year: String(invoice.year) });
}

// ---------------------------------------------------------------- sending

export async function sendPeppol(store: Store, invoiceId: number): Promise<string> {
  const [invoice, settings, clients] = await Promise.all([store.invoice(invoiceId), store.settings(), store.clients()]);
  if (!invoice) throw new Error("Invoice not found.");
  const env = settings.billit_env || "sandbox";
  try {
    const billit = new BillitClient(settings.billit_api_key, settings.billit_party_id, env);
    let [storedEnv, orderId] = invoice.billit_order_id ? invoice.billit_order_id.split(":") : ["", ""];
    if (!orderId || storedEnv !== env) {
      const client = clients.find((c) => c.id === invoice.client_id) ?? invoice.snapshot.client;
      const pdf = settings.billit_attach_pdf === "1" ? await invoicePdf(invoice, invoice.snapshot.company, invoice.snapshot.client) : undefined;
      orderId = await billit.createOrder(buildOrderPayload(invoice, client, pdf));
      storedEnv = env;
      await store.updateInvoice(invoice.id, { billit_order_id: `${env}:${orderId}` });
    }
    await billit.sendOrders([orderId], "Peppol");
  } catch (error) {
    if (error instanceof BillitError) {
      await store.updateInvoice(invoice.id, { peppol_status: "error", peppol_message: error.message });
    }
    throw error;
  }
  const status = env === "production" ? "sent" : "test";
  const message = env === "production" ? "Sent via Peppol" : "Sent in the Billit SANDBOX (test) - not delivered to the client";
  await store.updateInvoice(invoice.id, { peppol_status: status, peppol_message: message, peppol_at: new Date().toISOString() });
  return message;
}

export function mailValues(client: Client, period: string, statement: Statement | null, invoice: Invoice | null, settings: Settings) {
  const maand = periodLabel(period);
  const sales = statement?.sales_total ?? invoice?.sales_total ?? 0;
  const payout = statement?.payout ?? sales;
  const deducted = roundMoney(sales - payout);
  const values: Record<string, string | number> = {
    klant: client.name, maand, omzet: fmtEur(sales), verkopen: statement?.items ?? invoice?.items ?? 0,
    uitbetaling: fmtEur(payout), bedrijf: settings.company_name, factuurnummer: "", bedrag: "", vervaldatum: "",
    commissie: "", mededeling: "", factuur_zin: "",
    aftrek_zin: deducted > 0 ? ` (na aftrek van ${fmtEur(deducted)} transactiekosten)` : "",
  };
  if (invoice) {
    Object.assign(values, {
      factuurnummer: invoice.number, bedrag: fmtEur(invoice.total), vervaldatum: fmtDate(invoice.due_date),
      commissie: fmtEur(invoice.subtotal), mededeling: invoice.payment_ref,
    });
    const peppol = invoice.peppol_status === "sent" ? " De factuur werd ook via Peppol verstuurd." : "";
    values.factuur_zin =
      `Onze commissie voor ${maand} staat op factuur ${invoice.number} (in bijlage): ${fmtEur(invoice.total)} incl. btw, ` +
      `te betalen vóór ${fmtDate(invoice.due_date)} met gestructureerde mededeling ${invoice.payment_ref}.${peppol}\n\n`;
  }
  return values;
}

/** One e-mail with the afrekening and (if any) the commission invoice. */
export async function sendMonthEmail(store: Store, clientId: number, period: string, toOverride?: string): Promise<string> {
  const [settings, clients, statements, invoices] = await Promise.all([
    store.settings(), store.clients(), store.statements({ period, clientId }), store.invoices({ period, clientId }),
  ]);
  const client = clients.find((c) => c.id === clientId);
  if (!client) throw new Error("Client not found.");
  const statement = statements[0] ?? null;
  const invoice = invoices[0] ?? null;
  if (!statement && !invoice) throw new Error(`Nothing to send for ${client.name} (${periodLabel(period)}).`);
  const to = splitAddresses(toOverride || client.email);
  const cc = toOverride ? [] : splitAddresses(client.cc_email);
  const bcc = settings.smtp_bcc_self === "1" && !toOverride ? splitAddresses(settings.smtp_from_email || settings.smtp_user) : [];
  const values = mailValues(client, period, statement, invoice, settings);
  const attachments: { filename: string; content: Buffer }[] = [];
  if (statement) {
    attachments.push({ filename: `Afrekening ${period} ${client.name}.pdf`, content: await statementPdf(statement, statement.snapshot.company) });
  }
  if (invoice) {
    attachments.push({ filename: `Factuur ${invoice.number}.pdf`, content: await invoicePdf(invoice, invoice.snapshot.company, invoice.snapshot.client) });
  }
  try {
    await sendMail(settings, { to, cc, bcc, subject: render(settings.mail_subject, values), text: render(settings.mail_body, values), attachments });
  } catch (error) {
    if (!toOverride) await markEmail(store, statement, invoice, "error", (error as Error).message);
    throw error;
  }
  if (toOverride) return `Test e-mail sent to ${to.join(", ")}`;
  await markEmail(store, statement, invoice, "sent", `Sent to ${[...to, ...cc].join(", ")}`);
  return `E-mailed to ${[...to, ...cc].join(", ")}`;
}

async function markEmail(store: Store, statement: Statement | null, invoice: Invoice | null, status: string, message: string) {
  const emailed_at = status === "sent" ? new Date().toISOString() : null;
  if (statement) await store.updateStatement(statement.id, { email_status: status, email_message: message, emailed_at });
  if (invoice) await store.updateInvoice(invoice.id, { email_status: status, email_message: message, emailed_at });
}

export function nextNumberPreview(settings: Settings, date: string): string {
  const year = Number(date.slice(0, 4));
  let seq = Number(settings.invoice_next_number || 1);
  if (settings.invoice_use_year === "1" && settings.invoice_counter_year && year > Number(settings.invoice_counter_year)) seq = 1;
  const body = String(seq).padStart(Number(settings.invoice_digits || 4), "0");
  return `${settings.invoice_prefix}${settings.invoice_use_year === "1" ? `${year}-` : ""}${body}`;
}

export function payoutTotal(statements: Statement[]): number {
  return sumMoney(statements.map((s) => Number(s.payout)));
}


