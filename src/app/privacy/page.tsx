import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, Callout, ContentPage, Section } from "@/components/ContentPage";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Privacy policy — ${brandName}`,
    description:
      "What we collect, why, who it is shared with, how long it is kept, and the rights you have over it.",
  };
}

/**
 * Privacy policy.
 *
 * Written against what this codebase actually does rather than from a template:
 * the categories below are the tables that exist, the processors named are the
 * ones the app really calls, and the retention section points at the per-table
 * rules an admin sets instead of inventing a number this deployment does not
 * honour. A policy that describes a different product is worse than none - it
 * is a promise nobody kept.
 */
export default async function PrivacyPage() {
  const [settings, action] = await Promise.all([publicSettings(), publicHeaderAction()]);
  const { brandName, supportEmail } = settings;
  const contact = supportEmail ? (
    <a href={`mailto:${supportEmail}`} className="font-medium text-brand-500 hover:underline">
      {supportEmail}
    </a>
  ) : (
    <Link href="/contact" className="font-medium text-brand-500 hover:underline">
      the contact page
    </Link>
  );

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title="Privacy policy"
        updated="1 September 2026"
        intro={`This explains what ${brandName} collects about you and the vehicles you enquire about, why, who else sees it, and what you can ask us to do with it.`}
      >
        <Section id="who" title="1. Who is responsible">
          <p>
            {brandName} operates this platform and decides how the information described here is
            handled. Any question about this policy, or any request under section 8, should go to{" "}
            {contact}.
          </p>
        </Section>

        <Section id="collect" title="2. What we collect">
          <p>
            <strong className="text-ink">Account details you give us.</strong> Your name, email
            address, and optionally a phone number, designation, office, district and state. Your
            email address is also your sign-in name.
          </p>
          <p>
            <strong className="text-ink">What you do here.</strong> The vehicle numbers you enquire
            about, when you enquired, the vehicles you have added for watching and their settings,
            and the alerts generated for you. Every chargeable action is recorded against your
            account so your balance can be explained back to you.
          </p>
          <p>
            <strong className="text-ink">Vehicle movement records.</strong> Crossing records
            obtained for the vehicles you enquire about, described in full under{" "}
            <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
              where the data comes from
            </Link>
            . These identify a vehicle, not a person.
          </p>
          <p>
            <strong className="text-ink">Payment records.</strong> What you bought, when, for how
            much, and the reference our payment provider returns. We never see or store your card,
            UPI or bank details — those are handled entirely by the payment provider.
          </p>
          <p>
            <strong className="text-ink">Delivery settings.</strong> If you connect Telegram, the
            chat identifier needed to send you alerts. If you connect a spreadsheet for exports, its
            identifier.
          </p>
          <p>
            <strong className="text-ink">Technical records.</strong> A session cookie that keeps you
            signed in, and ordinary server logs including error diagnostics. We do not run
            advertising or third-party analytics trackers.
          </p>
        </Section>

        <Section id="why" title="3. Why we hold it">
          <Bullets
            items={[
              "To give you the service you signed up for: running your enquiries, watching the vehicles you chose, and sending the alerts you asked for.",
              "To keep your account secure and let you back in when you forget your password.",
              "To bill correctly, to show you where your credits went, and to keep the financial records the law requires us to keep.",
              "To keep the platform working — diagnosing faults, preventing abuse, and enforcing our terms.",
              "To comply with a legal obligation, or to respond to a lawful request from an authority entitled to make one.",
            ]}
          />
          <p>
            We do not sell your information, and we do not use it to build advertising profiles.
          </p>
        </Section>

        <Section id="shared" title="4. Who else sees it">
          <p>
            Only the providers we need to run the service, and only what each one needs:
          </p>
          <Bullets
            items={[
              <>
                <strong className="text-ink">Our hosting and database provider</strong>, which
                stores the data and runs the application.
              </>,
              <>
                <strong className="text-ink">Our payment provider</strong>, which takes the payment
                and returns a reference. Your card and bank details go to them, not to us.
              </>,
              <>
                <strong className="text-ink">The upstream data infrastructure</strong>, which
                receives the vehicle number being enquired about in order to return records for it.
              </>,
              <>
                <strong className="text-ink">Telegram</strong>, but only if you connect it, and only
                to deliver the alerts you configured.
              </>,
              <>
                <strong className="text-ink">Your own spreadsheet provider</strong>, if you have
                configured an export destination of your own.
              </>,
              <>
                <strong className="text-ink">The administrator of your organisation&rsquo;s
                account</strong>, where your account was created or is managed by one.
              </>,
            ]}
          />
          <p>
            We may also disclose information where we are required to by law, or where it is
            necessary to establish, exercise or defend a legal claim.
          </p>
        </Section>

        <Section id="keep" title="5. How long we keep it">
          <p>
            Operational records — crossing records, enquiry logs and alert history — are kept for a
            limited period and then deleted automatically. The exact period is set per record type
            by the administrator, and where an export destination is configured, records are copied
            out before deletion so your own copy survives.
          </p>
          <p>
            Account details are kept while your account exists. Financial records — payments,
            credit movements and balances — are kept for as long as tax and accounting law requires,
            which is longer than the rest, and are not deleted on request while that obligation
            stands.
          </p>
        </Section>

        <Section id="security" title="6. How it is protected">
          <p>
            Access is restricted to your own account: the database enforces, at row level, that one
            account cannot read another&rsquo;s data. Traffic is encrypted in transit. Passwords are
            stored only as salted hashes by our authentication provider — we never see them, and
            nobody here can tell you your password or will ever ask for it.
          </p>
          <Callout tone="warn">
            No system is perfectly secure. If we discover a breach affecting your information we
            will tell you and the relevant authority as required by law.
          </Callout>
        </Section>

        <Section id="rights" title="7. Vehicle data and individuals">
          <p>
            Vehicle movement records relate to vehicles. They may nonetheless become personal
            information in your hands — for example where a vehicle is operated by an identifiable
            individual. Where that is so, you are responsible for handling it lawfully, for having a
            lawful basis for your enquiry, and for complying with data protection law in your own
            use of it. Our terms require it and our logs record who enquired about what.
          </p>
        </Section>

        <Section id="your-rights" title="8. Your rights">
          <p>
            Subject to the exceptions the law allows, you may ask us to: give you a copy of the
            information we hold about you; correct it where it is wrong or incomplete; delete it
            where we no longer have a reason to keep it; or tell you who we have shared it with.
          </p>
          <p>
            Write to {contact} saying which of these you want. We will verify that the request comes
            from you — we will not act on a request we cannot tie to the account — and answer within
            the period the law allows. There is no charge for a reasonable request.
          </p>
          <p>
            If you are not satisfied with how we have handled a request, you may complain to the
            data protection authority with jurisdiction over you.
          </p>
        </Section>

        <Section id="children" title="9. Children">
          <p>
            This is a business platform and is not intended for anyone under 18. We do not knowingly
            create accounts for children, and will delete any we find.
          </p>
        </Section>

        <Section id="changes" title="10. Changes to this policy">
          <p>
            We may update this policy as the service changes. The date at the top always reflects
            the current version. Where a change materially affects how we handle your information,
            we will tell account holders directly rather than relying on you to re-read this page.
          </p>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
