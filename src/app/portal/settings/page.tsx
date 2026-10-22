import Link from "next/link";
import {
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MessageCircle,
  Send,
} from "lucide-react";

import { CopyAddress } from "./CopyAddress";
import { PushSetup } from "./PushSetup";
import { saveMySheet, saveMyTelegram, testMyTelegram, updateMyProfile } from "./actions";
import { ActionForm, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { AppDownload } from "@/components/AppDownload";
import { Disclosure, HelpNote } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, FormGrid, Input } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { PhoneField } from "@/components/PhoneInput";
import { publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdHelp } from "@/components/TelegramChatIdInfo";
import { Badge, DescRow, Mono, PageHeader, Panel } from "@/components/ui";
import { env, integrationHealth } from "@/lib/env";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { SHEET_TABS } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ALERT_BOT_START_URL, ALERT_BOT_USERNAME } from "@/lib/telegram-bot";
import type { GoogleSheetConfig, TelegramConfig } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Settings — ${brandName}` };
}

/**
 * Three things and nothing else: where alerts go, who you are, and where your
 * history is kept.
 *
 * WHY THIS PAGE READ AS TWO PAGES, WHICH IS WHAT IT WAS ACTUALLY ASKED TO FIX
 *
 * The owner asked for /portal/settings and /portal/settings#profile to be
 * "merged". They are one route and always were - #profile is an anchor into it
 * - so there was nothing to merge. The finding is that they believed otherwise,
 * and three things told them so:
 *
 *   1. A jump row of three pills - Profile / Alerts / Backup - sat under the
 *      h1, styled exactly like a tab bar: bordered, panel-coloured, min-h-9,
 *      equal thirds. Tapping one changed the address bar and moved the content.
 *      That is a tab bar in every respect a reader can observe.
 *   2. Three sibling Panels of identical weight underneath it. One h1 at
 *      text-xl over three h2s at text-sm, each in its own bordered card, each
 *      the same size, none subordinate to another. Nothing on the screen said
 *      these three belonged to one page rather than being three pages' worth of
 *      card that happened to be stacked.
 *   3. The account menu listed "My profile" -> #profile AND "Settings" -> the
 *      same route, as two destinations with two icons and two descriptions.
 *      That is where the two URLs in the owner's message came from; it is fixed
 *      at the source in AccountMenu.tsx, which now lists one.
 *
 * So the jump row is gone - it was the tab bar - and the three equals are now
 * one primary, one secondary and one folded extra:
 *
 *   ALERTS first and at full weight, carrying the only live status on the page.
 *   It is the section that can be broken while looking fine, it is the only one
 *   that costs money when it is (see AlertDeliveryBanner, which is site-wide
 *   and links to #alerts), and it is where two other screens deep-link to.
 *   Whoever arrives here overwhelmingly arrives to fix alerts. It also matches
 *   what the desktop already did: profile carried lg:order-2 and this column
 *   lg:order-1, so the wide layout put alerts first and the phone put profile
 *   first, and the two viewports disagreed about the page's own subject. They
 *   agree now, in the direction the desktop had already chosen, and the order
 *   classes are gone with the disagreement.
 *
 *   MY PROFILE second, keeping its name so the owner's own word for this page
 *   still appears on it.
 *
 *   BACKUP folded into a Disclosure. It is optional, most accounts never set it
 *   up, and it was 567px of open form saying so. Shut it still reports its own
 *   state on the summary row, and it opens itself when it is broken.
 *
 * And nothing on it explains itself in prose any more. The rule, unchanged: a
 * task nobody can do without being told how goes behind a labelled dropdown, a
 * detail one reader in a hundred wants goes behind an (i), and anything that
 * only restated a label or reassured is gone.
 */
export default async function PortalSettingsPage() {
  const { overview, email, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ supportEmail }, { data: telegram }, { data: sheet }, { count: pushDevices }] =
    await Promise.all([
      publicSettings(),
      admin
        .from("telegram_configs")
        .select("*")
        .eq("user_id", overview.id)
        .maybeSingle<TelegramConfig>(),
      admin
        .from("google_sheet_configs")
        .select("*")
        .eq("user_id", overview.id)
        .maybeSingle<GoogleSheetConfig>(),
      /* A count, not the rows. The panel only needs to say how many devices are
         set up, and an endpoint is a credential for that phone's notifications -
         there is no reason for one to be sent to a browser. */
      admin
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", overview.id),
    ]);

  const connected = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);

  const sheetId = sheet?.spreadsheet_id ?? null;
  const sheetOn = Boolean(sheetId) && (sheet?.is_enabled ?? false);
  /**
   * Whether copying to sheets works at all. Without it there is no address to
   * share and nothing is written anywhere, which is worth saying rather than
   * showing a form that quietly does nothing.
   */
  const sheetsReady = integrationHealth().googleSheets && Boolean(env.googleServiceAccountEmail);

  return (
    <>
      {/*
        The subtitle is back, and for the opposite reason it was removed. It went
        because it listed the three sections "which the jump row below and the
        three panel titles already are" - and the jump row is now gone,
        deliberately, because it was the thing impersonating a set of tabs. One
        line naming all three parts is what is left to say "this one page holds
        these three things", which is precisely the sentence the owner needed and
        did not get.
      */}
      <PageHeader
        title="Settings"
        subtitle="Where alerts are sent, your own details, and where your history is kept."
      />

      {/*
        Two panels side by side on a wide screen with the folded extra spanning
        beneath them, and the same three in the same order stacked on a phone.
        No order classes: DOM order is now the reading order on both, so there
        is one answer to "what is this page about" instead of two.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        {/* ================= where alerts go ================= */}
        {/*
          No `actions` badge on the header, which is not a demotion - the status
          moved into the body and got more room. Panel gives its actions slot
          `w-full sm:w-auto`, so on a phone the badge always dropped to a second
          line of its own and every panel with one wore an 83px header instead
          of a 49px header. Two of those was 68px spent on making two badges sit
          alone.
        */}
        {/*
          TWO CHANNELS IN ONE PANEL, not two panels.

          The panel was called "Telegram alerts" while Telegram was the only
          way an alert left the building. It is not any more - the app itself
          can now notify the phone it is installed on - and the reader's
          question is "where do my alerts go", which is one question with two
          answers. A second panel of equal weight would have made it two
          subjects and put the answer to "why is my phone silent" on whichever
          of them the reader did not open.

          Each channel wears a small uppercase label, the same device the
          profile panel uses for Sign-in, so three sections can live under one
          heading without any of them reading as the panel's own subject.
        */}
        {/* Website only - AppDownload hides itself inside the app. */}
        <AppDownload signedIn className="lg:col-span-2" />

        <Panel id="alerts" title="Alerts" className="scroll-mt-20">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
            <Send size={12} />
            Telegram
          </p>

          {/*
            One row for the whole state of this connection: whether it works,
            what it last did or last failed at, and the button that re-tests it.
            It was three things in two places - a badge in the header, a
            paragraph under the form, and the test button on a row of its own -
            and two of the three were usually saying nothing.
          */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
              {connected ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="warn">not connected</Badge>
              )}

              <span className="min-w-0 text-xs leading-relaxed">
                {telegram?.last_error ? (
                  <span className="text-bad-500">{friendlyError(telegram.last_error)}</span>
                ) : telegram?.verified_at ? (
                  <span className="text-good-500">
                    Last verified {fmtRelative(telegram.verified_at)}.
                  </span>
                ) : (
                  /* State, not instruction: the button that fixes it is on this
                     row, so telling somebody to press what their thumb is
                     already on was the second half of this line. */
                  <span className="text-faint">Not verified yet.</span>
                )}
              </span>
            </span>

            <InlineActionForm action={testMyTelegram} className="shrink-0">
              <SubmitButton variant="secondary" size="sm" pendingLabel="Sending...">
                <Send size={13} />
                Send test
              </SubmitButton>
            </InlineActionForm>
          </div>

          {!env.telegramBotToken ? (
            /* Ours to fix, not the reader's, so this says what it means for
               them and where to ask - never who to chase. */
            <p className="mb-4 text-xs leading-relaxed text-warn-500">
              Telegram delivery is not switched on yet, so a test will fail.
              {supportEmail ? (
                <>
                  {" "}
                  Let us know at{" "}
                  <a href={`mailto:${supportEmail}`} className="underline">
                    {supportEmail}
                  </a>
                  .
                </>
              ) : null}
            </p>
          ) : null}

          <ActionForm action={saveMyTelegram} closeOnSuccess={false}>
            <div className="space-y-4">
              {/*
                The steps were behind an (i) beside this label, and on the live
                page people did not find them - which is fatal here, because
                nobody has a chat id until these three steps give them one. A
                dropdown labelled with the question is a thing a reader can see
                is there; an (i) is a thing you have to already know about. See
                TelegramChatIdHelp.
              */}
              <div>
                <Field label="Chat id" name="chat_id">
                  <Input
                    name="chat_id"
                    defaultValue={telegram?.chat_id ?? ""}
                    inputMode="numeric"
                    placeholder="e.g. 123456789"
                    className="font-mono"
                  />
                </Field>
                <TelegramChatIdHelp className="mt-1.5" />
              </div>
              <Checkbox
                name="is_enabled"
                label="Send me alerts on Telegram"
                defaultChecked={telegram?.is_enabled ?? true}
              />
            </div>
            <FormActions>
              <SubmitButton>Save</SubmitButton>
            </FormActions>
          </ActionForm>

          {/*
            SCOPED TO TELEGRAM, WHICH IT WAS NOT.

            This was the answer to the owner's "notification is not showing on
            mobile as a notification. home screen pe yeh added hai but
            notification show nahi hoti", and it opened by saying that adding
            the app to the home screen does not make the icon buzz - which was
            true when nothing sent a push, and is not any more. The section
            below this one now switches exactly that on.

            So what is left here is the Telegram checklist, which is still worth
            walking and is still where the reader who has muted Telegram will
            find their answer. Everything about the phone itself has moved into
            PushSetup, where the device's own state can be shown alongside it.

            A dropdown and not an (i): a checklist somebody has to walk, read by
            somebody who has already concluded the product is broken - which is
            exactly the person an (i) does not reach.
          */}
          <HelpNote title="Telegram alerts do not reach me" className="mt-4">
            <p>
              A Telegram alert is a <strong className="text-ink">Telegram message</strong>, so it is
              Telegram that has to be allowed to notify you. For the app itself to notify you, see{" "}
              <strong className="text-ink">Notifications on this phone</strong> below.
            </p>
            {/* Explicit margins, because preflight zeroes every <p> and
                HelpNote's body carries no p+p rule of its own - unlike
                InfoTip's panel, which does. Without these the three paragraphs
                below butt against each other as one block of text. */}
            <p className="mt-2">Worth checking, in this order:</p>
            <ol className="mt-1.5 space-y-1.5">
              {[
                <>
                  Telegram is installed and signed in on <em>that</em> phone.
                </>,
                <>
                  Telegram&apos;s own notifications are on in the phone&apos;s Settings — on an
                  iPhone, Settings &rsaquo; Notifications &rsaquo; Telegram.
                </>,
                <>The chat id above is saved and the switch under it is on.</>,
                /* Named and linked, not "the alerts bot". A reader working
                   down this list has to be able to check the item, and they
                   cannot check one that does not say which bot or where it
                   is - Telegram's search returns imitations for any name
                   typed into it. */
                <>
                  You pressed <strong className="text-ink">Start</strong> on{" "}
                  <a
                    href={ALERT_BOT_START_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium break-all text-brand-500 hover:underline"
                  >
                    t.me/{ALERT_BOT_USERNAME}
                    <ExternalLink size={11} className="shrink-0" />
                  </a>
                  . Telegram forbids a bot from messaging anyone who has not sent it a{" "}
                  <Mono className="text-[11px]">/start</Mono>.
                </>,
                <>
                  <strong className="text-ink">Send test</strong> above reports connected.
                </>,
              ].map((step, index) => (
                <li key={index} className="flex gap-2">
                  <span className="font-mono text-brand-500">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2">
              The bell at the top of the screen is this app&apos;s own list of the same alerts. It
              is there to look at rather than to interrupt you.
            </p>
          </HelpNote>

          {/*
            THE OWNER'S ACTUAL REQUEST: "app notification mobile me jaana
            chahiye - fix it and create if not exists. i want that free. now we
            are using home shortcut so notification should be send to phone."

            Web Push with our own VAPID keys, which costs nothing - the delivery
            is done by the browser vendor's own service. It sits here rather
            than in a panel of its own because it is the second answer to the
            one question this panel asks, and beneath Telegram rather than above
            it because Telegram is what every existing account already has
            working.

            A client component, and it has to be: what it says depends entirely
            on facts only the device knows - whether this is the installed copy
            or a Safari tab, what the OS has already been asked, whether a
            subscription exists - and none of those can be read on the server.
          */}
          <PushSetup
            platformReady={integrationHealth().webPush}
            appReady={integrationHealth().fcm}
            savedDevices={pushDevices ?? 0}
            supportEmail={supportEmail}
          />

          {/*
            The third channel, visible and unusable.
            It is built and switched off - there is no WhatsApp account behind it
            yet - and saying so is better than either hiding it, which turns
            "can I get these on WhatsApp?" into a support email, or offering a
            switch that silently sends nothing.
          */}
          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed border-line px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted">
              <MessageCircle size={14} className="shrink-0 text-faint" />
              WhatsApp alerts
            </span>
            <Badge tone="neutral">coming soon</Badge>
          </div>
        </Panel>

        {/* ================= who you are ================= */}
        <Panel id="profile" title="My profile" className="scroll-mt-20">
          <ActionForm action={updateMyProfile} closeOnSuccess={false}>
            <div className="space-y-4">
              <Field label="Full name" name="full_name">
                <Input
                  name="full_name"
                  required
                  maxLength={80}
                  defaultValue={profile.full_name ?? ""}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </Field>

              {/*
                Was a free-text 20-character box that accepted a landline, a
                five-digit number and a foreign number - none of which sign-up
                allows, so one account could hold a format another refused. Same
                field as every other form now, and compulsory: this is the number
                we ring when somebody cannot get into their account, which is
                exactly when they cannot use the app to tell us a better one.

                PhoneField's own "10 digits, no country code" carries the format,
                which is what is wanted at the moment of typing; why we want the
                number at all is read once at sign-up.
              */}
              <PhoneField label="Mobile number" value={profile.phone} />

              {/*
                THE FOUR OPTIONAL FIELDS, FOLDED.

                Job title, company, city and state were four more full-width
                boxes of exactly the weight of the two above them, and at 390px
                FormGrid's cols={2} collapses to one column - so the pairing
                this used to be written as was invisible on the device it
                mattered on. Six identical boxes, and a reader had no way to
                tell that two of them are required and four are decoration.

                Decoration is not unfair: grep says office, designation, district
                and state are read by the admin console and nowhere else - the
                officers list, the explore screen and one account's overview.
                They are how whoever answers the phone recognises an account.
                They change roughly never, they are never shown back to the
                customer, and nothing in the product behaves differently for
                them. That is the definition of something that should start shut.

                The inputs are still inside this form and still submit: a closed
                <details> hides its content, it does not disable or detach the
                controls in it, so updateMyProfile receives all six fields
                whether the group was opened or not. Folding a form group would
                otherwise silently blank four columns on every save, which is why
                this is worth writing down.

                Disclosure rather than a bordered card of its own: it is the
                sanctioned dropdown and it brings the <details> semantics that
                make the paragraph above true. Its .panel skin is lightened here
                because a card carrying a card shadow inside a panel body of the
                same colour reads as a second panel that has drifted inside the
                first.
              */}
              <Disclosure
                title="Company and location"
                /* One line at 390px. Two states - filled and not - were tried
                   here and neither earned the second line they cost: the
                   question a reader has at a shut group is "must I open this",
                   and the title answers that. */
                hint="Optional. Used when you call us."
                className="border-line/70 bg-raised/40 [box-shadow:none]"
                bodyClassName="border-t border-divider px-3 py-3.5"
              >
                <div className="space-y-4">
                  <FormGrid cols={2}>
                    <Field label="Job title" name="designation">
                      <Input
                        name="designation"
                        maxLength={60}
                        defaultValue={profile.designation ?? ""}
                        placeholder="Fleet manager"
                        autoComplete="organization-title"
                      />
                    </Field>
                    <Field label="Company or organisation" name="office">
                      <Input
                        name="office"
                        maxLength={120}
                        defaultValue={profile.office ?? ""}
                        placeholder="Patel Roadlines"
                        autoComplete="organization"
                      />
                    </Field>
                  </FormGrid>
                  <FormGrid cols={2}>
                    <Field label="City or district" name="district">
                      <Input
                        name="district"
                        maxLength={60}
                        defaultValue={profile.district ?? ""}
                        placeholder="Ahmedabad"
                        autoComplete="address-level2"
                      />
                    </Field>
                    <Field label="State" name="state">
                      <Input
                        name="state"
                        maxLength={60}
                        defaultValue={profile.state ?? ""}
                        placeholder="Gujarat"
                        autoComplete="address-level1"
                      />
                    </Field>
                  </FormGrid>
                </div>
              </Disclosure>
            </div>

            <FormActions>
              <SubmitButton>Save changes</SubmitButton>
            </FormActions>
          </ActionForm>

          {/*
            Sign-in sits inside the profile panel rather than in one of its own:
            it is the same subject, and the reason it is read-only is only clear
            next to the boxes that are not.
          */}
          <div className="mt-5 border-t border-divider pt-4">
            {/*
              An (i) and not a dropdown, deliberately: moving your account to a
              new address is a detail one reader in a hundred wants, not a task
              this screen is asking anybody to do. The line used to sit open
              under the rows, where it read as an apology for the one field that
              has no box.
            */}
            <InfoTip
              label="changing your sign-in email"
              info={
                <p>
                  Your email is how you sign in, so it is not changed from here.
                  {supportEmail ? (
                    <>
                      {" "}
                      Write to{" "}
                      <a href={`mailto:${supportEmail}`} className="text-brand-500 hover:underline">
                        {supportEmail}
                      </a>{" "}
                      to move the account to a new address.
                    </>
                  ) : (
                    " Contact support to move the account to a new address."
                  )}
                </p>
              }
            >
              <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
                <KeyRound size={12} />
                Sign-in
              </p>
            </InfoTip>
            <dl className="mt-2">
              <DescRow label="Email">
                <span className="break-all">{email}</span>
              </DescRow>
              <DescRow label="Password">
                <Link href="/forgot-password" className="font-medium text-brand-500 hover:underline">
                  Send me a reset link
                </Link>
              </DescRow>
              <DescRow label="Member since">{fmtDate(profile.created_at)}</DescRow>
            </dl>
          </div>
        </Panel>

        {/* ================= where history is kept ================= */}
        {/*
          The anchor lives on this wrapper because Disclosure takes no id, and
          #backup has to keep working - it was in the jump row that has just been
          deleted, and an anchor somebody may have bookmarked is not worth
          breaking to save a div.
        */}
        <div id="backup" className="scroll-mt-20 lg:col-span-2">
          {/*
            FOLDED, AND THE ONLY SECTION THAT IS.

            567px of open form for a feature most accounts never turn on, and it
            was the last thing on the page: a phone reader scrolled two full
            screens of Google Sheets setup to reach the end of Settings. Shut, it
            is one row that still reports its own state - the badge and the hint
            below say whether a sheet is connected, when it last copied and
            whether it has stopped working - so nothing that was visible is now
            hidden, only unexpanded.

            It opens itself when it is broken. A sheet that has stopped taking
            rows is the one state where the reader has something to do and does
            not know it, and a fault folded away is a fault nobody finds.
          */}
          <Disclosure
            title="Backup to your Google Sheet"
            defaultOpen={Boolean(sheet?.last_error)}
            badge={
              /* A sheet that stopped working is the whole reason this badge is
                 here - it is the only place the failure is visible. */
              sheet?.last_error ? (
                <Badge tone="bad">not working</Badge>
              ) : sheetOn ? (
                <Badge tone="good">
                  <CheckCircle2 size={10} />
                  connected
                </Badge>
              ) : (
                <Badge tone="neutral">not set</Badge>
              )
            }
            hint={
              sheet?.last_error ? (
                /* One line, but it keeps the one thing to go and check: the
                   sharing is the cause nine times in ten. */
                <span className="text-bad-500">
                  Last copy failed — {friendlyError(sheet.last_error)} Check it is still shared as
                  Editor.
                </span>
              ) : sheet?.last_synced_at ? (
                <>Last copied {fmtRelative(sheet.last_synced_at)}.</>
              ) : sheetId ? (
                /* Not a fault: copying runs on a schedule, so a sheet named
                   this morning has nothing in it yet. */
                <>Nothing copied across yet — it runs on a schedule, not on save.</>
              ) : (
                <>Keep your own copy of every record, in a sheet you own.</>
              )
            }
          >
            {/* Nothing can be written to a sheet that was never shared, so the
                address comes before the box asking for the link. */}
            <div className="rounded-xl border border-line bg-raised px-3 py-3">
              {/*
                "as Editor" is in the heading rather than in the dropdown with
                the rest of the steps: it is the one requirement that fails
                silently - a sheet shared as Viewer looks shared and takes no
                rows - so it stays where it cannot be missed. How to do the
                sharing is a task, and tasks go behind a labelled dropdown, the
                same call as the chat id above.
              */}
              <p className="text-xs font-semibold text-ink">
                1. Share your sheet with this address as <strong>Editor</strong>
              </p>

              {sheetsReady ? (
                <>
                  <div className="mt-2.5">
                    <CopyAddress address={env.googleServiceAccountEmail} />
                  </div>
                  <HelpNote title="How do I share it?" className="mt-1.5">
                    In your sheet tap <strong className="text-ink">Share</strong>, paste this
                    address in, set it to <strong className="text-ink">Editor</strong> and send.
                    Anything less and rows cannot be added.
                  </HelpNote>
                </>
              ) : (
                /* Ours to fix, not the reader's. */
                <p className="mt-1 text-xs leading-relaxed text-warn-500">
                  Copying to sheets is not switched on yet, so nothing is being written to any
                  sheet.
                  {supportEmail ? (
                    <>
                      {" "}
                      Let us know at{" "}
                      <a href={`mailto:${supportEmail}`} className="underline">
                        {supportEmail}
                      </a>
                      .
                    </>
                  ) : null}
                </p>
              )}
            </div>

            <ActionForm action={saveMySheet} closeOnSuccess={false} className="mt-4">
              <div className="space-y-4">
                <Field label="2. Paste the link to your sheet" name="sheet_url">
                  <Input
                    name="sheet_url"
                    // Not type="url": a bare sheet id is accepted too, and the
                    // browser would refuse to submit one.
                    inputMode="url"
                    defaultValue={sheet?.sheet_url ?? ""}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="font-mono text-xs"
                  />
                </Field>
                <Checkbox
                  name="is_enabled"
                  label="Copy my history to this sheet"
                  defaultChecked={sheet?.is_enabled ?? true}
                />
              </div>
              <FormActions>
                {sheet?.sheet_url ? (
                  <a
                    href={sheet.sheet_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mr-auto inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-brand-500 hover:underline"
                  >
                    Open my sheet
                    <ExternalLink size={12} />
                  </a>
                ) : null}
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>

            <Disclosure
              title="What ends up in the sheet?"
              hint="One tab per kind of record."
              className="mt-4 border-line/70 bg-raised/40 [box-shadow:none]"
              bodyClassName="border-t border-divider px-3 py-3.5"
            >
              {/* Straight from the exporter, so this list cannot promise a tab
                  that is never written. */}
              <ul className="grid grid-cols-1 gap-1.5 text-xs text-muted sm:grid-cols-2">
                {Object.values(SHEET_TABS).map((tab) => (
                  <li key={tab} className="flex items-center gap-1.5">
                    <span aria-hidden className="size-1 shrink-0 rounded-full bg-brand-500/60" />
                    {tab}
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs leading-relaxed text-muted">
                Rows are only ever added to the end of a tab. Nothing in your sheet is read, changed
                or removed, so anything you write there yourself is safe. The app clears its own
                records in time; your sheet keeps them.
              </p>
            </Disclosure>
          </Disclosure>
        </div>
      </div>
    </>
  );
}
