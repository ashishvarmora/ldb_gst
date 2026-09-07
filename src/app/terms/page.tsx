import type { Metadata } from "next";
import Link from "next/link";

import { Bullets, Callout, ContentPage, Section } from "@/components/ContentPage";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Terms of use — ${brandName}`,
    description:
      "The agreement between you and us: what you may use this for, what you may not, what we promise, and what we do not.",
  };
}

/**
 * Terms of use.
 *
 * The two clauses that matter most here are not the usual ones. Section 4 says
 * you must have a lawful basis for every vehicle you enquire about, because
 * this platform can be misused for exactly one thing - following somebody - and
 * saying so plainly is both the honest position and the defensible one.
 * Section 7 says findings are not proof, which is the misunderstanding most
 * likely to cause real harm to a real person.
 */
export default async function TermsPage() {
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
        title="Terms of use"
        updated="1 September 2026"
        intro={`These terms govern your use of ${brandName}. By creating an account or using the platform, you agree to them.`}
      >
        <Section id="who" title="1. Who may use this">
          <p>
            You must be at least 18 and able to enter a binding contract. If you are using{" "}
            {brandName} for an organisation, you confirm you are authorised to accept these terms on
            its behalf, and &ldquo;you&rdquo; means both you and that organisation.
          </p>
        </Section>

        <Section id="account" title="2. Your account">
          <p>
            Keep your password to yourself. Everything done through your account is treated as done
            by you, and every enquiry is logged against it. Tell us at once through {contact} if you
            think somebody else has access.
          </p>
          <p>
            Give us accurate details and keep them current. We may suspend an account whose details
            we cannot rely on.
          </p>
        </Section>

        <Section id="plans" title="3. Plans, credits and payment">
          <Bullets
            items={[
              "A plan sets how many vehicles you may watch at the same time, and for how long. Credits pay for each check of a vehicle at the published rate, whether that check was run automatically for a tracked vehicle or by you as a lookup.",
              "Automatic checking of a tracked vehicle draws on your credits every time it runs, at the interval you chose. With no credits available, automatic checking stops until you top up. Pausing a vehicle stops its checks and the credits they would have spent.",
              "Topping up credits does not renew, extend or change your plan. The two are separate and are billed separately.",
              "Prices, credit rates and what each action costs are published before you buy, and may change. A change never alters the price of something you have already paid for.",
              "Credits are a prepaid entitlement to use this service. They have no cash value, cannot be transferred between accounts, and cannot be exchanged for money.",
              "Payments are taken by our payment provider. We do not receive or store your card or bank details.",
              "Unused credits do not expire and remain available while your account is in good standing, whether or not you hold a current plan. We will give reasonable notice before any change that would cause credits to lapse.",
            ]}
          />
          <p>
            If you believe you have been charged incorrectly, write to {contact} with the payment
            reference and we will investigate. Refunds, where due, are returned by the same method
            you paid with.
          </p>
        </Section>

        <Section id="lawful" title="4. Lawful use — the core condition">
          <Callout tone="warn" title="This is the condition we enforce most strictly">
            You may only enquire about a vehicle where you have a lawful basis to do so. You must
            not use {brandName} to monitor, locate, follow or build a picture of the movements of
            any individual.
          </Callout>
          <p>You must not:</p>
          <Bullets
            items={[
              "Enquire about a vehicle you have no lawful reason to enquire about.",
              "Use the platform for surveillance of a person, for stalking, harassment, intimidation, or to facilitate any of these by someone else.",
              "Use it to enable an offence, or to cause loss, distress or harm to any person.",
              "Resell, redistribute, publish or systematically extract the data obtained through the platform, or make it available to anyone who is not an authorised user of your account.",
              "Automate access, scrape, or attempt to bypass rate limits, credit accounting or access controls.",
              "Attempt to access another account's data, probe the platform's security, or interfere with its operation.",
              "Present anything obtained here as an official, certified or government record.",
            ]}
          />
          <p>
            We log every enquiry with the account, the vehicle number and the time. Where we are
            lawfully required to disclose those logs, we will. Breach of this section may end your
            account immediately and without refund, and may be reported to the appropriate
            authority.
          </p>
        </Section>

        <Section id="data" title="5. The data, and where it comes from">
          <p>
            {brandName} does not observe vehicles. It presents movement records obtained from
            India&rsquo;s logistics and tolling data infrastructure.{" "}
            <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
              Where the data comes from
            </Link>{" "}
            forms part of these terms and sets out the origin of the records and their limits.
          </p>
          <p>
            {brandName} is independent. It is not operated by, affiliated with, or endorsed by any
            government department, agency or programme, and nothing on it is an official record.
          </p>
        </Section>

        <Section id="availability" title="6. Availability">
          <p>
            We aim to keep the platform running but do not guarantee uninterrupted or error-free
            service. It depends on upstream systems we do not control, and their coverage,
            behaviour and availability may change or be withdrawn without notice to us. We may
            suspend the service for maintenance, and will give notice where we reasonably can.
          </p>
        </Section>

        <Section id="reliance" title="7. No warranty, and no reliance as proof">
          <p>
            The platform and everything obtained through it are provided{" "}
            <strong className="text-ink">&ldquo;as is&rdquo;</strong>. To the fullest extent the law
            allows, we give no warranty of accuracy, completeness, timeliness or fitness for a
            particular purpose.
          </p>
          <Callout tone="warn">
            Records may be delayed, incomplete or absent. An absence of records is not evidence that
            a vehicle did not travel. Nothing obtained here is sole or conclusive proof of the
            movement, location, delay or conduct of any vehicle, consignment or person, and it must
            be independently verified before being relied on in any legal, regulatory,
            disciplinary, contractual or enforcement context.
          </Callout>
          <p>
            Any decision you take on the basis of what you see here is yours, and you are
            responsible for it.
          </p>
        </Section>

        <Section id="liability" title="8. Limitation of liability">
          <p>
            To the fullest extent permitted by law, we are not liable for indirect or consequential
            loss, loss of profit, business, goodwill, or data, or for any loss arising from a
            decision taken in reliance on information obtained through the platform.
          </p>
          <p>
            Where we are found liable despite the above, our total liability for all claims in any
            twelve-month period is limited to the amount you paid us in that period.
          </p>
          <p>
            Nothing in these terms excludes liability that cannot lawfully be excluded, including
            for fraud or for death or personal injury caused by negligence.
          </p>
        </Section>

        <Section id="indemnity" title="9. Your responsibility to us">
          <p>
            You will indemnify us against claims, losses and reasonable costs arising from your use
            of the platform in breach of these terms — in particular from an enquiry made without a
            lawful basis, or from a decision you took in reliance on records that these terms told
            you not to rely on alone.
          </p>
        </Section>

        <Section id="ending" title="10. Ending the agreement">
          <p>
            You may close your account at any time by writing to {contact}. We may suspend or end
            your access if you breach these terms, if payment fails, or if we are required to by
            law. Where we end it without cause, we will refund credits you have paid for and not
            used.
          </p>
          <p>
            On closure, data is handled as set out in the{" "}
            <Link href="/privacy" className="font-medium text-brand-500 hover:underline">
              privacy policy
            </Link>
            . Export anything you need first.
          </p>
        </Section>

        <Section id="changes" title="11. Changes to these terms">
          <p>
            We may change these terms as the service changes. The date at the top reflects the
            current version, and we will notify account holders of material changes. Continuing to
            use the platform after a change means you accept it; if you do not, close your account
            and we will refund unused credits.
          </p>
        </Section>

        <Section id="law" title="12. Governing law">
          <p>
            These terms are governed by the laws of India, and the courts of India have exclusive
            jurisdiction over any dispute arising from them.
          </p>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
