# Where every `.env` value comes from

Four places. Supabase is the only one you cannot skip — the app will not start
without it. Telegram and Google are needed for alerts and sheets, and can be added
later. Nothing here costs money on the free tiers.

Work through this once, paste each value into `.env.local`, and you are done.

```bash
cp .env.example .env.local
```

---

## 1. Supabase — the database and login system

**Time: ~5 minutes.** Free tier is fine to start.

### Create the project

1. Go to <https://supabase.com> → **Start your project** → sign in (GitHub is quickest).
2. **New project**.
3. Fill in:
   - **Name** — `gst-truck-intel`
   - **Database Password** — click Generate, then **save it in your password manager**.
     You will not need it for this app, but you need it if you ever connect with psql.
   - **Region** — **South Asia (Mumbai)** `ap-south-1`. Closest to your officers, so
     the dashboard feels fast.
   - **Plan** — Free.
4. **Create new project**, then wait ~2 minutes while it provisions.

### Run the database migrations

Before copying keys, set up the tables — otherwise the app loads but every page is
empty and errors.

1. Left sidebar → **SQL Editor** → **New query**.
2. Open `supabase/migrations/0001_init.sql` from this project, copy **everything**,
   paste into the editor, click **Run**. You should see "Success. No rows returned".
3. Repeat for `supabase/migrations/0002_views_rls_seed.sql`.
4. Repeat for `supabase/migrations/0003_worker_rpcs.sql`.

Order matters. All three are safe to re-run if you are unsure whether one worked.

Check it worked: sidebar → **Table Editor** → you should see `profiles`, `plans`,
`tracked_trucks` and the rest, and `plans` should already contain Basic,
Professional and Unlimited.

### Copy the three keys

1. Sidebar → **Project Settings** (gear icon at the bottom) → **API**.
   - Newer dashboards split this into **API** and **API Keys** — check both tabs.
2. Copy these:

| Dashboard label | Goes into |
| --- | --- |
| **Project URL** (`https://xxxx.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| **anon** / **public** key — or **Publishable key** (`sb_publishable_…`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role** / **secret** key — or a **Secret key** (`sb_secret_…`), click Reveal | `SUPABASE_SERVICE_ROLE_KEY` |

If your project shows both the new keys and a **Legacy API keys** tab, either set
works. Just keep the pairing right: the public one goes in the `NEXT_PUBLIC_` variable,
the secret one in `SUPABASE_SERVICE_ROLE_KEY`.

> **The service_role key bypasses every security rule.** It must never appear in
> client code, a screenshot, a git commit, or a WhatsApp message. It only ever lives
> in `.env.local` (which `.gitignore` already excludes) and in Vercel's environment
> variables.

### Create your own admin login

Add three lines to `.env.local`:

```bash
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=YourStrongPassword
ADMIN_NAME=Your Name
```

Then:

```bash
node scripts/bootstrap-admin.mjs
```

This creates the account, confirms the email, and marks you super admin. Run it again
any time to reset your own password.

**Delete those three lines once you can sign in.** They are only a bootstrap
convenience — the app itself never reads them, and they must not go into Vercel. The
real password lives hashed inside Supabase Auth; the env var is just a copy sitting in
plaintext on your disk.

You can still pass them as arguments instead
(`node scripts/bootstrap-admin.mjs you@example.com "pass" "Name"`), but the env-file
route is safer: a password typed as a command-line argument is saved in your shell
history and is visible to anyone who can run `ps` while it runs.

---

## 2. Telegram — one bot for the whole platform

**Time: ~2 minutes.** You create ONE bot. Officers never create bots and never give
you their phone number.

### Create the bot

1. Open Telegram (phone or desktop) and search for **@BotFather** — the one with the
   blue verified tick.
2. Send `/newbot`.
3. It asks for a **name** (what people see): `Truck Watch`.
4. It asks for a **username**, which must be unique and end in `bot`:
   `gst_truck_watch_bot`. If it is taken, try another.
5. BotFather replies with a token like:

   ```
   8123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```

   That whole string → `TELEGRAM_BOT_TOKEN`.

Optional polish, still in BotFather: `/setdescription`, `/setuserpic`,
`/setabouttext` — makes the bot look official to officers.

### Getting an officer's chat id

Two things must happen, and they are separate:

**a) The officer must start the bot.** Telegram forbids a bot from messaging someone
who has never messaged it. Send the officer your bot link —
`https://t.me/gst_truck_watch_bot` — and ask them to press **Start**.

**b) You need their numeric chat id.** A plain BotFather bot does not reply with it
on its own. Two ways:

- **You read it** (recommended). After they press Start, run:

  ```bash
  node scripts/get-telegram-chat-id.mjs
  ```

  It lists everyone who has messaged your bot, with their name and chat id. Paste the
  id on that officer's page in the admin console.

- **They read it.** Ask them to open **@userinfobot** in Telegram and send `/start`.
  It replies with their `Id` — a plain number. They paste it themselves in
  **Portal → Settings**, or send it to you.

Then use the **Send test message** button to confirm delivery.

> Telegram keeps unread updates for about 24 hours, so run the script reasonably soon
> after the officer presses Start.

---

## 3. Google Sheets — one service account

**Time: ~10 minutes.** Only needed if you want the sheet mirror. You can skip it and
add it later; everything else keeps working.

You create ONE service account. Officers share their own sheet with its email address.
You never touch their Google password, and there is no OAuth consent screen.

### Create the project and enable the API

1. Go to <https://console.cloud.google.com> and sign in with the Google account that
   should own this.
2. Top bar → project dropdown → **New Project** → name it `gst-truck-sync` → **Create**.
3. Make sure that project is selected in the top bar.
4. Search bar at the top: type **Google Sheets API** → open it → **Enable**.

### Create the service account

5. Left menu → **APIs & Services** → **Credentials**.
6. **+ Create Credentials** → **Service account**.
7. **Service account name**: `gst-truck-sync` → **Create and continue**.
8. "Grant this service account access to project" — **skip it**, click **Continue**.
   It needs no project roles; access comes from each officer sharing their sheet.
9. **Done**.

### Download the key

10. Click the service account you just created.
11. **Keys** tab → **Add key** → **Create new key** → **JSON** → **Create**.
12. A `.json` file downloads. Open it in a text editor. You need two fields:

```jsonc
{
  "client_email": "gst-truck-sync@gst-truck-sync.iam.gserviceaccount.com",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
}
```

| JSON field | Goes into |
| --- | --- |
| `client_email` | `GOOGLE_SERVICE_ACCOUNT_EMAIL` |
| `private_key` | `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` |

**Copying the private key correctly is the step people get wrong.** Copy the value
exactly as it appears in the JSON, including the `\n` sequences, and wrap the whole
thing in double quotes in `.env.local`:

```bash
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----\n"
```

Do not press Enter to make it multi-line, and do not delete the `\n`. The app converts
them back to real line breaks.

Keep the downloaded JSON somewhere safe and out of the project folder — it is as
sensitive as a password.

### What the officer does

They create a blank Google Sheet, click **Share**, paste your `client_email`, set it
to **Editor**, and send you the link. The app creates the tabs on first write.

The service-account address is shown on **Admin → Settings** so you can copy it, and
on the officer's own settings page so they can see who to share with.

---

## 4. CRON_SECRET — you invent this one

Any long random string. Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste it into `CRON_SECRET`. It stops anyone on the internet from triggering your
tracking worker and burning your quota. The worker refuses to run if it is unset.

---

## 5. LDB_API_URL — nothing to sign up for

The Logistics Data Bank endpoint is public and needs no key. The default in
`.env.example` is already correct:

```
LDB_API_URL=https://ldb.co.in/api/ldbv2/truck/search
```

You only change it if the portal moves. It can also be edited later from
**Admin → Settings** without a redeploy.

---

## Your finished `.env.local`

```bash
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklm.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

LDB_API_URL=https://ldb.co.in/api/ldbv2/truck/search

TELEGRAM_BOT_TOKEN=8123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

GOOGLE_SERVICE_ACCOUNT_EMAIL=gst-truck-sync@gst-truck-sync.iam.gserviceaccount.com
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"

CRON_SECRET=8f3c1a9e7b2d4f60a1c8e5b3d7f2a4c6e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9
```

Then:

```bash
npm run dev
```

Open <http://localhost:3000/login> and sign in with the admin account you created in
step 1. Go to **Admin → Settings** — the **Connection health** panel shows a green
tick for each credential it can see. That is the quickest way to confirm you pasted
everything correctly.

---

## Putting the same values on Vercel

`.env.local` only works on your own machine. For the live site:

1. Push the project to GitHub.
2. <https://vercel.com> → **Add New** → **Project** → import the repository.
3. Before clicking Deploy, open **Environment Variables** and add each line from
   `.env.local` — name on the left, value on the right.
   - For the private key, paste the same one-line `-----BEGIN PRIVATE KEY-----\n...`
     value. Do not add the surrounding quotes here; Vercel stores the raw value.
4. **Deploy**.
5. Afterwards you can edit them under **Project → Settings → Environment Variables**.
   Changing a variable needs a redeploy to take effect.

The cron schedule in `vercel.json` starts working automatically. On the **Hobby** plan
Vercel only runs cron once a day — see
[TRACKING-WORKER.md](TRACKING-WORKER.md) for free external schedulers that hit the
same URL every 5 minutes.

---

## If something does not work

| Problem | Cause |
| --- | --- |
| `Missing environment variable NEXT_PUBLIC_SUPABASE_URL` | `.env.local` not created, or the dev server was started before you saved it. Restart `npm run dev`. |
| Pages load but every list is empty and mentions `officer_overview` | The migrations did not run. Redo step 1's SQL Editor part. |
| `bootstrap-admin.mjs` says the profile row failed | Same — migration `0001` or `0002` did not run. |
| Sign-in says invalid credentials | Use the exact email and password you passed to `bootstrap-admin.mjs`. Re-run it to reset. |
| Telegram test says "chat not found" | The officer has not pressed Start on your bot yet, or the chat id is wrong. |
| Sheet test says Google refused access | The sheet was not shared with the service-account email, or was shared as Viewer instead of Editor. |
| `Could not sign the Google token request` | The private key got mangled. Re-copy it from the JSON with the `\n` intact, in double quotes. |
