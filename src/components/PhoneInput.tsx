import { Field, Input } from "@/components/form";
import { PHONE_PREFIX, indianMobileDigits } from "@/lib/phone";

/**
 * The one mobile-number field, everywhere a number is asked for.
 *
 * Three forms collect a phone - sign-up, an officer's own profile, and the
 * admin creating an account - and they had drifted into three different
 * questions. Sign-up and the admin form asked for ten digits behind fixed +91
 * furniture; the profile form asked for a free-text `maxLength={20}` box with
 * "+91 98250 00000" as its placeholder and accepted anything vaguely
 * phone-shaped, optional. So the same column was being filled from two
 * incompatible questions, and the profile form was the one that let a landline
 * or a five-digit number in.
 *
 * WHY +91 IS FURNITURE AND NOT A FIELD
 *
 * Every account on this platform is an Indian mobile - see phone.ts, which is
 * deliberately India-only - so a country-code box has exactly one right answer
 * and a hundred wrong ones. Rendering it as an inert prefix means it cannot be
 * changed, cannot be cleared, and cannot be submitted as part of the value.
 * The prefix itself is aria-hidden - hearing "plus nine one" as a stray
 * unlabelled node before the input is noise - and the country is carried
 * instead by an sr-only description tied to the input, so it is announced as
 * part of the field rather than as furniture beside it.
 *
 * A pasted number still works. `pattern` rejects "+91 98765 43210" in the
 * browser, which is why the hint says ten digits - but if it does reach the
 * server, normaliseIndianMobile() sheds 00, 91 and a trunk zero before
 * validating, so a paste is never silently mangled into a different number.
 *
 * type="tel" rather than "number": a spinner on a phone number is nonsense, and
 * inputMode="numeric" already brings up the digit keypad.
 */
export function PhoneField({
  /** Shown above the field. Differs by audience: "your" number or "their" number. */
  label = "Mobile number",
  hint,
  /** A stored `+91XXXXXXXXXX`, shown as the ten digits the input expects. */
  value,
  name = "phone",
  /**
   * Compulsory by default, because the number is how somebody is reached when
   * their account is broken - the moment they cannot use the app to ask.
   */
  required = true,
  className,
}: {
  label?: string;
  hint?: string;
  value?: string | null;
  name?: string;
  required?: boolean;
  className?: string;
}) {
  /*
   * Stored form in, ten digits out. indianMobileDigits rather than a
   * replace(/^\+?91/): a legacy row may hold "09876543210" or "91 98765 43210"
   * from before this column was normalised, and a naive prefix strip turns
   * those into a number one digit too long that the pattern then refuses,
   * leaving somebody unable to save a form over a value they never typed.
   */
  const digits = indianMobileDigits(value);

  /* Derived from the name rather than useId(): this stays a Server Component,
     and a name is already unique within the form that carries it. */
  const countryId = `${name}-country`;

  return (
    <Field
      label={label}
      name={name}
      hint={hint ?? "10 digits, no country code."}
      required={required}
      className={className}
    >
      <div className="flex">
        <span
          aria-hidden
          className="inline-flex shrink-0 items-center rounded-l-lg border border-r-0 border-line bg-raised px-3 font-mono text-sm text-muted"
        >
          {PHONE_PREFIX}
        </span>
        <Input
          name={name}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          required={required}
          maxLength={10}
          pattern="[6-9][0-9]{9}"
          title="Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9."
          defaultValue={digits ?? ""}
          placeholder="9876543210"
          aria-describedby={countryId}
          className="rounded-l-none font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal"
        />
      </div>
      <span id={countryId} className="sr-only">
        Indian mobile number, country code plus 91
      </span>
    </Field>
  );
}
