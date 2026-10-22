// Belgian formatting and validation: euro amounts, Dutch month names, VAT numbers, IBAN, OGM references.
// Money is rounded commercially (0,005 -> 0,01) on exact decimals, never on binary floats.

export const MONTHS_NL = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  const name = MONTHS_NL[Number(month) - 1];
  return name ? `${name} ${year}` : period;
}

export function previousPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function currentPeriod(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

export function lastCompletePeriod(today = new Date()): string {
  return previousPeriod(currentPeriod(today));
}

export function recentPeriods(count = 24, today = new Date()): string[] {
  const out: string[] = [];
  let period = currentPeriod(today);
  for (let i = 0; i < count; i++) {
    out.push(period);
    period = previousPeriod(period);
  }
  return out;
}

export function monthBounds(period: string): { first: string; last: string; days: number } {
  const [y, m] = period.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${period}-01`, last: `${period}-${String(days).padStart(2, "0")}`, days };
}

export function todayIso(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86400000);
}

// ---------------------------------------------------------------- exact money

const SCALE = 10n ** 10n;

/** A JS number as an exact decimal with 10 decimals (like Python's Decimal(str(x))). */
function scaled(value: number | string): bigint {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return 0n;
  const text = Number(n.toPrecision(15)).toFixed(10);
  const negative = text.startsWith("-");
  const [int, frac = ""] = text.replace("-", "").split(".");
  const big = BigInt(int) * SCALE + BigInt((frac + "0000000000").slice(0, 10));
  return negative ? -big : big;
}

/** Round an exact value with `decimals` implied decimals half away from zero to cents. */
function toCents(value: bigint, decimals: bigint): number {
  const unit = 10n ** (decimals - 2n);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  let cents = abs / unit;
  if ((abs % unit) * 2n >= unit) cents += 1n;
  return Number(negative ? -cents : cents) / 100;
}

export function roundMoney(value: number | string): number {
  return toCents(scaled(value), 10n);
}

/** pct % of amount, rounded to the cent. */
export function percentOf(amount: number, pct: number): number {
  return toCents((scaled(amount) * scaled(pct)) / 100n, 20n);
}

export function sumMoney(values: number[]): number {
  return toCents(values.reduce((acc, v) => acc + scaled(v), 0n), 10n);
}

// ---------------------------------------------------------------- formatting

export function fmtNum(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  const fixed = Math.abs(roundTo(value, decimals)).toFixed(decimals);
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${value < 0 && Number(fixed) !== 0 ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

function roundTo(value: number, decimals: number): number {
  return decimals === 2 ? roundMoney(value) : Number(value.toFixed(decimals));
}

export function fmtEur(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return value < 0 ? `€ -${fmtNum(-value)}` : `€ ${fmtNum(value)}`;
}

export function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (Number.isInteger(value)) return `${value}%`;
  return `${fmtNum(value, 2).replace(/0+$/, "").replace(/,$/, "")}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

// ---------------------------------------------------------------- validation

export function normalizeVat(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  if (/^\d{9,10}$/.test(text)) text = `BE${text}`;
  if (/^BE\d{9}$/.test(text)) text = `BE0${text.slice(2)}`;
  return text;
}

export function vatProblem(raw: string | null | undefined): string | null {
  const vat = normalizeVat(raw);
  if (!vat) return "VAT number missing";
  if (!vat.startsWith("BE")) return /^[A-Z]{2}[0-9A-Z]{2,13}$/.test(vat) ? null : "VAT number looks invalid";
  const digits = vat.slice(2);
  if (!/^[01]\d{9}$/.test(digits)) return "Belgian VAT number must be BE + 10 digits starting with 0 or 1";
  if (97 - (Number(digits.slice(0, 8)) % 97) !== Number(digits.slice(8))) return "VAT number checksum is wrong (typo?)";
  return null;
}

export function normalizeIban(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s/g, "").toUpperCase();
}

export function formatIban(raw: string | null | undefined): string {
  return normalizeIban(raw).replace(/(.{4})/g, "$1 ").trim();
}

export function ibanProblem(raw: string | null | undefined): string | null {
  const iban = normalizeIban(raw);
  if (!iban) return "IBAN missing";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban) || (iban.startsWith("BE") && iban.length !== 16)) {
    return "IBAN looks invalid";
  }
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  return BigInt(digits) % 97n === 1n ? null : "IBAN check digits are wrong (typo?)";
}

/** Belgian structured payment reference (gestructureerde mededeling). */
export function ogm(year: number, seq: number): string {
  const base = BigInt(year % 100) * 100000000n + BigInt(seq % 100000000);
  const check = Number(base % 97n) || 97;
  const digits = base.toString().padStart(10, "0") + String(check).padStart(2, "0");
  return `+++${digits.slice(0, 3)}/${digits.slice(3, 7)}/${digits.slice(7)}+++`;
}

export function splitStreet(street: string): [string, string] {
  const match = (street ?? "").trim().match(/^(.*?\D)\s*,?\s+(\d+\S*(?:\s*(?:bus|b|box)\s*\S+)?)\s*$/i);
  return match ? [match[1].trim().replace(/,$/, ""), match[2].trim()] : [(street ?? "").trim(), ""];
}
