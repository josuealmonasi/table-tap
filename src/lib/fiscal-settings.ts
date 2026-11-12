/** Private ticket identity. Kept separate from the public Restaurant row. */
export const TAX_REGIMES = [
  "601", "603", "605", "606", "607", "608", "610", "611", "612", "614",
  "615", "616", "620", "621", "622", "623", "624", "625", "626",
] as const;

export const MEXICAN_STATES = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche",
  "Coahuila de Zaragoza", "Colima", "Chiapas", "Chihuahua", "Ciudad de México",
  "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "México",
  "Michoacán de Ocampo", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla",
  "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora",
  "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz de Ignacio de la Llave",
  "Yucatán", "Zacatecas",
] as const;

export const RFC_PATTERN = "^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$";
export const POSTAL_CODE_PATTERN = "^[0-9]{5}$";
export const TICKET_PHONE_PATTERN = "^[0-9 +()-]{7,20}$";

// Order keeps the postal code ahead of the locality fields for future autofill.
export const FISCAL_FIELDS = {
  legal_name: { max: 254 },
  rfc: { max: 13 },
  tax_regime: { max: 3 },
  address_street: { max: 160 },
  address_ext_number: { max: 20 },
  address_int_number: { max: 20 },
  address_postal_code: { max: 5 },
  address_colonia: { max: 120 },
  address_municipality: { max: 120 },
  address_state: { max: 60 },
  ticket_phone: { max: 20 },
} as const;

export type FiscalField = keyof typeof FISCAL_FIELDS;
export type FiscalSettings = Record<FiscalField, string | null>;
export const FISCAL_KEYS = Object.keys(FISCAL_FIELDS) as FiscalField[];
export const FISCAL_COLUMNS = FISCAL_KEYS.join(", ");

export function isFiscalField(key: string): key is FiscalField {
  return Object.hasOwn(FISCAL_FIELDS, key);
}

/** Called with trimmed values; empty fields are optional. Matches schema limits. */
export function validFiscalValue(field: FiscalField, value: string): boolean {
  if (!value) return true;
  if ([...value].length > FISCAL_FIELDS[field].max) return false;
  switch (field) {
    case "rfc": return new RegExp(RFC_PATTERN).test(value);
    case "tax_regime": return TAX_REGIMES.some(code => code === value);
    case "address_postal_code": return new RegExp(POSTAL_CODE_PATTERN).test(value);
    case "address_state": return MEXICAN_STATES.some(state => state === value);
    case "ticket_phone": return new RegExp(TICKET_PHONE_PATTERN).test(value);
    default: return true;
  }
}

/** Mutates only submitted fiscal fields. Returns the specific localized error key. */
export function normalizeFiscalSettings(update: Record<string, unknown>): string | null {
  for (const field of FISCAL_KEYS) {
    if (!(field in update)) continue;
    const raw = update[field];
    if (raw !== null && typeof raw !== "string") return `fiscal.errors.${field}`;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!validFiscalValue(field, value)) return `fiscal.errors.${field}`;
    update[field] = value || null;
  }
  return null;
}
