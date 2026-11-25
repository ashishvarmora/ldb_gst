/**
 * The credits one WhatsApp alert may cost, as offered on Settings -> Tracking.
 *
 * A fixed list, not a free number box, because of how the amount is stored:
 * credit_rates.units_per_credit is numeric(10,2) and spend_credits() charges
 * ceil(1 / units * 100) / 100. Every amount here survives that round trip
 * exactly (0.2 -> 5 -> 0.2). A typed 0.3 would not: 1/0.3 stores as 3.33,
 * which charges 0.31 - not what the admin asked for.
 */
export const WHATSAPP_AMOUNTS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5] as const;

/** What units_per_credit has to hold for `amount` credits per message. */
export function unitsForAmount(amount: number): number {
  return Math.round((1 / amount) * 100) / 100;
}

/** What spend_credits() will actually charge for a stored units_per_credit. */
export function chargedFor(units: number): number {
  // The database does this in exact numeric; the inner round keeps binary
  // float noise (20.000000000000004) from tipping the ceil up a paisa.
  return Math.ceil(Math.round((100 / units) * 1e6) / 1e6) / 100;
}
