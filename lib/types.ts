// Shapes shared by the store, the calculations and the screens.

export type Settings = {
  company_name: string;
  company_street: string;
  company_zipcode: string;
  company_city: string;
  company_country: string;
  company_vat: string;
  company_iban: string;
  company_bic: string;
  company_email: string;
  company_phone: string;
  company_website: string;
  accent_color: string;
  invoice_prefix: string;
  invoice_use_year: string;
  invoice_digits: string;
  invoice_next_number: string;
  invoice_counter_year: string;
  invoice_vat_pct: string;
  invoice_due_days: string;
  invoice_vat_note: string;
  invoice_footer: string;
  statement_list_sales: string;
  billit_env: string;
  billit_api_key: string;
  billit_party_id: string;
  billit_attach_pdf: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string;
  smtp_from_name: string;
  smtp_from_email: string;
  smtp_bcc_self: string;
  mail_subject: string;
  mail_body: string;
  /** Machines (ids, comma-separated) that are your own: no afrekening, not reported as missing. */
  own_machines: string;
};

export const DEFAULT_SETTINGS: Settings = {
  company_name: "",
  company_street: "",
  company_zipcode: "",
  company_city: "",
  company_country: "BE",
  company_vat: "",
  company_iban: "",
  company_bic: "",
  company_email: "",
  company_phone: "",
  company_website: "",
  accent_color: "#0F766E",
  invoice_prefix: "",
  invoice_use_year: "1",
  invoice_digits: "4",
  invoice_next_number: "1",
  invoice_counter_year: "",
  invoice_vat_pct: "21",
  invoice_due_days: "30",
  invoice_vat_note: "",
  invoice_footer: "",
  statement_list_sales: "1",
  billit_env: "sandbox",
  billit_api_key: "",
  billit_party_id: "",
  billit_attach_pdf: "0",
  smtp_host: "",
  smtp_port: "587",
  smtp_user: "",
  smtp_password: "",
  smtp_from_name: "",
  smtp_from_email: "",
  smtp_bcc_self: "1",
  mail_subject: "Afrekening {maand} - {klant}",
  mail_body:
    "Beste {klant},\n\n" +
    "In bijlage vindt u de afrekening van uw verkopen in {maand}.\n\n" +
    "Omzet {maand}: {omzet} ({verkopen} verkopen). Dit bedrag storten wij volledig aan u door.\n\n" +
    "{factuur_zin}" +
    "Met vriendelijke groeten,\n" +
    "{bedrijf}",
  own_machines: "",
};

export type Catalog = {
  org: { id: string; name: string; timezone: string | null };
  businesses: { id: string; name: string; address: string | null; email: string | null; contact_name: string | null }[];
  machines: {
    id: string; name: string; business_id: string | null; shared_business_id: string | null;
    /** Payter terminal serial number, e.g. APO20252200880 (Apollo) or P6X… (P66). */
    serial: string | null; terminal_model?: string | null;
  }[];
  partners: { key: string; name: string }[];
};

export type Client = {
  id: number;
  name: string;
  owners: string[];
  vat_number: string;
  street: string;
  zipcode: string;
  city: string;
  country: string;
  email: string;
  cc_email: string;
  iban: string;
  active: boolean;
  notes: string;
};

export type Contract = {
  id: number;
  client_id: number;
  name: string;
  starts_on: string;
  ends_on: string | null;
  pct: number;
  base: "incl" | "excl";
  sales_vat_pct: number;
  per_item: number;
  fixed_monthly: number;
  minimum_monthly: number;
  prorate: boolean;
  machines: string[];
  notes: string;
};

/** A client's sales for one month typed in by hand (e.g. from Televend); replaces the MATO Info sales. */
export type ManualSales = { id: number; client_id: number; period: string; amount: number; items: number; note: string };

/** Sales per owner, machine and day (from MATO Info). */
export type DailyRow = { owner: string; machine_id: string; day: string; items: number; revenue: number };

/** One sale, for the afrekening. */
export type DetailRow = {
  owner: string;
  machine_id: string;
  at: string;
  slot: string | null;
  product: string | null;
  units: number;
  amount: number;
};

export type InvoiceLine = {
  description: string;
  detail: string;
  quantity: number;
  unit_price: number;
  vat_pct?: number;
  kind?: string;
};

export type Invoice = {
  id: number;
  client_id: number;
  period: string;
  number: string;
  seq: number;
  year: number;
  invoice_date: string;
  due_date: string;
  lines: InvoiceLine[];
  snapshot: { client: Client; company: Partial<Settings>; calc: Calc };
  sales_total: number;
  items: number;
  subtotal: number;
  vat_pct: number;
  vat_amount: number;
  total: number;
  payment_ref: string;
  billit_order_id: string;
  peppol_status: string;
  peppol_message: string;
  peppol_at: string | null;
  email_status: string;
  email_message: string;
  emailed_at: string | null;
  paid: boolean;
  paid_on: string | null;
};

export type StatementSnapshot = {
  client: Client;
  company: Partial<Settings>;
  calc: Calc;
  machines: { label: string; terminal?: string; items: number; revenue: number }[];
  /** Set when the sales were typed in by hand instead of read from MATO Info. */
  manual?: { note: string } | null;
  products: { product: string; items: number; revenue: number }[];
  daily: { day: string; revenue: number }[];
  sales: { at: string; machine: string; slot: string; product: string; amount: number }[] | null;
  invoice: { number: string; total: number; due_date: string; payment_ref: string } | null;
};

export type Statement = {
  id: number;
  client_id: number;
  period: string;
  made_on: string;
  sales_total: number;
  items: number;
  payout: number;
  invoice_id: number | null;
  snapshot: StatementSnapshot;
  email_status: string;
  email_message: string;
  emailed_at: string | null;
  paid_out: boolean;
  paid_out_on: string | null;
};

export type ContractResult = {
  contract_id: number;
  name: string;
  from: string;
  to: string;
  sales_total: number;
  items: number;
  base_kind: "incl" | "excl";
  base: number;
  pct: number;
  pct_amount: number;
  per_item: number;
  item_amount: number;
  fixed: number;
  minimum: number;
  topup: number;
  summary: string;
};

export type Calc = {
  period: string;
  sales_total: number;
  items: number;
  lines: InvoiceLine[];
  subtotal: number;
  contracts: ContractResult[];
  uncovered_total: number;
  uncovered_items: number;
  deal: string;
};
