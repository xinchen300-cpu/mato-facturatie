"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState, Message } from "@/components/client";
import { ibanProblem, normalizeIban, normalizeVat, periodLabel, todayIso, vatProblem } from "@/lib/belgium";
import { BillitClient } from "@/lib/billit";
import { closeMonth, deleteInvoice, sendMonthEmail, sendPeppol } from "@/lib/invoicing";
import { sendMail } from "@/lib/mailer";
import { DEMO, getStore } from "@/lib/store";
import { supabaseServer } from "@/lib/store/supabase";
import type { Contract, Settings } from "@/lib/types";

const ok = (text: string): Message => ({ kind: "success", text });
const fail = (text: string): Message => ({ kind: "error", text });
const info = (text: string): Message => ({ kind: "info", text });
const str = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const numOf = (form: FormData, key: string) => {
  const value = Number(str(form, key).replace(",", "."));
  return Number.isFinite(value) ? value : 0;
};

async function ownerStore() {
  const store = await getStore();
  if (!(await store.isOwner())) throw new Error("Not allowed.");
  return store;
}

async function guard(run: () => Promise<Message[]>, paths: string[] = ["/"]): Promise<ActionState> {
  try {
    const messages = await run();
    paths.forEach((p) => revalidatePath(p, "layout"));
    return { messages };
  } catch (error) {
    return { messages: [fail((error as Error).message)] };
  }
}

// ---------------------------------------------------------------- auth

export async function signIn(_: ActionState, form: FormData): Promise<ActionState> {
  if (DEMO) redirect("/");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email: str(form, "email"), password: String(form.get("password") ?? "") });
  if (error) return { messages: [fail(error.message === "Invalid login credentials" ? "E-mail or password is wrong." : error.message)] };
  redirect("/");
}

// ---------------------------------------------------------------- settings

const SECTIONS: Record<string, { fields: (keyof Settings)[]; checkboxes?: (keyof Settings)[] }> = {
  company: { fields: ["company_name", "company_vat", "company_street", "company_zipcode", "company_city", "company_country",
                      "company_iban", "company_bic", "company_email", "company_phone", "company_website", "accent_color"] },
  invoices: { fields: ["invoice_prefix", "invoice_digits", "invoice_next_number", "invoice_vat_pct", "invoice_due_days",
                       "invoice_vat_note", "invoice_footer"], checkboxes: ["invoice_use_year", "statement_list_sales"] },
  billit: { fields: ["billit_env", "billit_api_key", "billit_party_id"], checkboxes: ["billit_attach_pdf"] },
  email: { fields: ["smtp_host", "smtp_port", "smtp_user", "smtp_password", "smtp_from_name", "smtp_from_email",
                    "mail_subject", "mail_body"], checkboxes: ["smtp_bcc_self"] },
};

export async function saveSettings(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const section = SECTIONS[str(form, "section")];
    if (!section) throw new Error("Unknown settings section.");
    const patch: Partial<Settings> = {};
    for (const key of section.fields) {
      if (!form.has(key)) continue;
      // Secrets are only replaced when something new is typed.
      if ((key === "billit_api_key" || key === "smtp_password") && !str(form, key)) continue;
      patch[key] = key === "mail_body" ? String(form.get(key) ?? "") : str(form, key);
    }
    for (const key of section.checkboxes ?? []) patch[key] = form.has(key) ? "1" : "0";
    if (patch.company_vat !== undefined) patch.company_vat = normalizeVat(patch.company_vat);
    if (patch.company_iban !== undefined) patch.company_iban = normalizeIban(patch.company_iban);
    if (patch.company_country !== undefined) patch.company_country = (patch.company_country || "BE").toUpperCase();
    await store.saveSettings(patch);
    const warnings = [patch.company_vat !== undefined && vatProblem(patch.company_vat),
                      patch.company_iban !== undefined && ibanProblem(patch.company_iban)].filter(Boolean) as string[];
    return [ok("Saved."), ...warnings.map((w) => info(w))];
  }, ["/settings"]);
}

export async function testBillit(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const settings = await (await ownerStore()).settings();
    const data = (await new BillitClient(settings.billit_api_key, settings.billit_party_id, settings.billit_env).accountInfo()) as Record<string, unknown> | null;
    const companies = (data?.Companies ?? data?.companies) as { Name?: string }[] | undefined;
    const name = (data?.CompanyName ?? data?.Name ?? companies?.[0]?.Name ?? "") as string;
    return [ok(`Connected to Billit (${settings.billit_env})${name ? `: ${name}` : ""}.`)];
  }, []);
}

export async function testEmail(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const settings = await (await ownerStore()).settings();
    const me = settings.smtp_from_email || settings.smtp_user;
    await sendMail(settings, { to: [me], subject: "Test - Mato Facturatie", text: "This is a test e-mail. E-mail sending works!" });
    return [ok(`Test e-mail sent to ${me}.`)];
  }, []);
}

// ---------------------------------------------------------------- clients

export async function saveClient(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const id = Number(str(form, "id")) || null;
    const name = str(form, "name");
    if (!name) throw new Error("A client needs a name.");
    const values = {
      name, owners: form.getAll("owners").map(String), vat_number: normalizeVat(str(form, "vat_number")),
      street: str(form, "street"), zipcode: str(form, "zipcode"), city: str(form, "city"),
      country: (str(form, "country") || "BE").toUpperCase(), email: str(form, "email"), cc_email: str(form, "cc_email"),
      iban: normalizeIban(str(form, "iban")), active: form.has("active"), notes: str(form, "notes"),
    };
    // An owner (business / partner) counts for one client only.
    const others = (await store.clients()).filter((c) => c.id !== id);
    for (const other of others) {
      const left = other.owners.filter((o) => !values.owners.includes(o));
      if (left.length !== other.owners.length) await store.updateClient(other.id, { owners: left });
    }
    if (id) await store.updateClient(id, values);
    else await store.insertClient(values);
    const warnings = [values.vat_number && vatProblem(values.vat_number), values.iban && ibanProblem(values.iban)].filter(Boolean) as string[];
    return [ok(`${name} saved.`), ...warnings.map((w) => info(w))];
  }, ["/clients", "/", "/month"]);
}

export async function deleteClient(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const id = Number(str(form, "id"));
    const [invoices, statements] = await Promise.all([store.invoices({ clientId: id }), store.statements({ clientId: id })]);
    if (invoices.length || statements.length) throw new Error("This client has invoices or afrekeningen: untick Active instead.");
    await store.deleteClient(id);
    return [ok("Client deleted.")];
  }, ["/clients"]);
}

// ---------------------------------------------------------------- contracts

export async function saveContract(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const id = Number(str(form, "id")) || null;
    const clientId = Number(str(form, "client_id"));
    const startsOn = str(form, "starts_on");
    const endsOn = str(form, "ends_on") || null;
    if (!clientId) throw new Error("Choose a client.");
    if (!startsOn) throw new Error("Fill in the start date.");
    if (endsOn && endsOn < startsOn) throw new Error("The end date is before the start date.");
    const values: Omit<Contract, "id"> = {
      client_id: clientId, name: str(form, "name"), starts_on: startsOn, ends_on: endsOn,
      pct: numOf(form, "pct"), base: str(form, "base") === "excl" ? "excl" : "incl", sales_vat_pct: numOf(form, "sales_vat_pct") || 6,
      per_item: numOf(form, "per_item"), fixed_monthly: numOf(form, "fixed_monthly"), minimum_monthly: numOf(form, "minimum_monthly"),
      prorate: form.has("prorate"), machines: form.getAll("machines").map(String), notes: str(form, "notes"),
    };
    if (values.pct < 0 || values.pct > 100) throw new Error("The % must be between 0 and 100.");
    if (id) await store.updateContract(id, values);
    else await store.insertContract(values);
    return [ok("Contract saved.")];
  }, ["/contracts", "/", "/month"]);
}

export async function deleteContract(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    await (await ownerStore()).deleteContract(Number(str(form, "id")));
    return [ok("Contract deleted.")];
  }, ["/contracts"]);
}

// ---------------------------------------------------------------- the month

export async function makeDocuments(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const period = str(form, "period");
    const ids = form.getAll("client").map(Number);
    if (!ids.length) return [info("Tick at least one client.")];
    const { made, errors } = await closeMonth(store, period, ids, str(form, "date") || todayIso());
    const invoices = made.map((m) => m.invoice).filter(Boolean);
    const statements = made.filter((m) => m.statement).length;
    return [
      ok(`${statements} afrekening(en) and ${invoices.length} invoice(s) made for ${periodLabel(period)}` +
         (invoices.length ? ` (${invoices.join(", ")})` : "") + ". Check them below, then send."),
      ...errors.map(fail),
    ];
  }, ["/month", "/", "/invoices"]);
}

export async function sendDocuments(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const period = str(form, "period");
    const intent = str(form, "intent");
    const resend = form.has("resend");
    const ids = form.getAll("client").map(Number);
    if (!ids.length) return [info("Tick at least one client.")];
    const [settings, invoices, statements, clients] = await Promise.all([
      store.settings(), store.invoices({ period }), store.statements({ period }), store.clients(),
    ]);
    const errors: Message[] = [];
    const peppol: string[] = [];
    const mailed: string[] = [];
    for (const id of ids) {
      const name = clients.find((c) => c.id === id)?.name ?? String(id);
      const invoice = invoices.find((i) => i.client_id === id);
      const statement = statements.find((s) => s.client_id === id);
      if ((intent === "both" || intent === "peppol") && invoice && (resend || invoice.peppol_status !== "sent")) {
        try {
          await sendPeppol(store, invoice.id);
          peppol.push(name);
        } catch (error) {
          errors.push(fail(`${name} · Peppol: ${(error as Error).message}`));
        }
      }
      const emailed = (statement ?? invoice)?.email_status === "sent";
      if ((intent === "both" || intent === "email") && (resend || !emailed)) {
        try {
          await sendMonthEmail(store, id, period);
          mailed.push(name);
        } catch (error) {
          errors.push(fail(`${name} · E-mail: ${(error as Error).message}`));
        }
      }
    }
    const messages: Message[] = [];
    if (peppol.length) {
      messages.push(settings.billit_env === "production"
        ? ok(`Sent via Peppol (${peppol.length}): ${peppol.join(", ")}`)
        : info(`Sent in the Billit SANDBOX, not delivered to clients (${peppol.length}): ${peppol.join(", ")}`));
    }
    if (mailed.length) messages.push(ok(`E-mailed (${mailed.length}): ${mailed.join(", ")}`));
    messages.push(...errors);
    return messages.length ? messages : [info("Nothing to send: everything ticked was already sent.")];
  }, ["/month", "/invoices"]);
}

export async function setPaidOut(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const value = str(form, "value") === "1";
    await (await ownerStore()).updateStatement(Number(str(form, "id")), { paid_out: value, paid_out_on: value ? todayIso() : null });
    return [];
  }, ["/month"]);
}

export async function setPaid(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const value = str(form, "value") === "1";
    await (await ownerStore()).updateInvoice(Number(str(form, "id")), { paid: value, paid_on: value ? todayIso() : null });
    return [];
  }, ["/invoices", "/"]);
}

export async function removeInvoice(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const invoice = await store.invoice(Number(str(form, "id")));
    await deleteInvoice(store, Number(str(form, "id")));
    return [ok(`Invoice ${invoice?.number} deleted; the number will be used again.`)];
  }, ["/invoices", "/month"]);
}

export async function sendTestEmail(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const store = await ownerStore();
    const settings = await store.settings();
    const me = settings.smtp_from_email || settings.smtp_user;
    return [ok(await sendMonthEmail(store, Number(str(form, "client")), str(form, "period"), me))];
  }, []);
}
