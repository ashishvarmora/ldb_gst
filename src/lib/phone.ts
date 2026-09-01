/**
 * Indian mobile numbers, stored one way.
 *
 * The number is how an officer is actually reached when something is wrong with
 * their account, so it is worth insisting on and worth storing unambiguously.
 * People type it six ways - 98765 43210, +91 9876543210, 09876543210,
 * 91-9876543210 - and all six are the same number. Normalising on the way in
 * means a support agent searching for one finds it, and the column never holds
 * two spellings of one phone.
 *
 * Deliberately India-only. Every officer using this is in India, and a
 * permissive international parser would accept a ten-digit number that is not a
 * mobile at all. If that changes, this is the one file to widen.
 */

/** Stored form. One shape, always: +91 then ten digits. */
export const PHONE_PREFIX = "+91";

/**
 * The ten digits of an Indian mobile, or null.
 *
 * Mobile ranges start 6, 7, 8 or 9 - a number beginning 0-5 is a landline or
 * not a phone, and neither can receive what we would send.
 */
export function indianMobileDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let digits = raw.replace(/\D/g, "");

  /*
   * Shed the prefixes outermost first: the international 00, then the country
   * code, then the trunk zero. Order is the whole trick - "0091 98765 43210"
   * carries all three, and stripping 91 before 00 leaves 0098765..., which
   * matches nothing.
   */
  if (digits.length > 12 && digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (!/^[6-9]\d{9}$/.test(digits)) return null;
  return digits;
}

/** `+919876543210`, or null when the input is not an Indian mobile. */
export function normaliseIndianMobile(raw: string | null | undefined): string | null {
  const digits = indianMobileDigits(raw);
  return digits === null ? null : `${PHONE_PREFIX}${digits}`;
}

/** `+91 98765 43210` - for reading, never for storing. */
export function formatIndianMobile(stored: string | null | undefined): string {
  const digits = indianMobileDigits(stored);
  if (digits === null) return stored ?? "";
  return `${PHONE_PREFIX} ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** The one refusal message, so every form says the same thing. */
export const PHONE_ERROR =
  "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.";
