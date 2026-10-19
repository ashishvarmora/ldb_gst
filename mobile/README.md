# Rahdari mobile app (Android + iOS)

The app is **the live website (https://rahdari.in) inside a native shell**, built
with [Capacitor](https://capacitorjs.com). Same screens, same login, same
Razorpay checkout — one codebase.

**Why not React Native?** The site is ~100 server-rendered Next.js pages with
server actions and Supabase cookies. React Native would mean rewriting every
screen and keeping two frontends in step forever. Capacitor reuses the
frontend as-is and adds the native parts (icon, splash screen, back button,
downloads, payment popups, offline screen).

**The big win:** when you deploy the website to Vercel, the app updates at the
same moment. You only rebuild the app when something in `mobile/` changes.

```
mobile/
  capacitor.config.json   app id, name, which URL it opens, splash/status bar
  www/offline.html        shown when the phone has no internet
  assets/                 source icon -> `npm run icons` makes every size
  android/                Android Studio project (MainActivity adds downloads + Razorpay popups)
  ios/                    Xcode project
```

---

## 1. Build the Android app for free (no Android Studio needed)

`.github/workflows/android.yml` builds on GitHub's servers whenever `mobile/`
changes on `main`, or when you press **Run workflow**.

1. Commit and push this folder and the workflow.
2. GitHub → your repo → **Actions** → **Android app** → open the run →
   **Artifacts** → download `rahdari-debug.apk`.
3. Send that APK to your phone and install it (allow "Install unknown apps"
   when Android asks). This is the test build.

### Signed release (needed for Play Store and public download)

Do this **once**, and **back up the `.jks` file and passwords** somewhere safe —
lose them and you can never update the app on Play Store.

Create the key (needs Java; Android Studio includes it, or install Temurin 21):

```bash
keytool -genkeypair -v -keystore rahdari-release.jks -alias rahdari -keyalg RSA -keysize 2048 -validity 10000
```

Turn it into text for GitHub:

```bash
base64 -w0 rahdari-release.jks > keystore.txt
```

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | contents of `keystore.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `rahdari` |
| `ANDROID_KEY_PASSWORD` | the key password |

Run the workflow again. The `rahdari-release` artifact now holds
`app-release.aab` (for Play Store) and `app-release.apk` (for direct download).
Delete `keystore.txt` afterwards. Never commit the `.jks` (it's in `.gitignore`).

### Or build on your own PC

Install [Android Studio](https://developer.android.com/studio), then:

```bash
cd mobile
npm install
npx cap sync
npx cap open android
```

Android Studio opens → plug in a phone with USB debugging on → ▶ Run.
For a store build: **Build → Generate Signed Bundle / APK**.

---

## 2. Publish on Android

### Google Play (recommended — where people look)
- **Cost:** $25 one-time developer account at https://play.google.com/console.
- **New personal accounts must run a closed test with at least 12 testers for
  14 days** before going public. An organisation account (needs a D-U-N-S
  number for your company) skips this.
- Create app → upload `app-release.aab` → fill store listing (screenshots,
  description), **Privacy policy URL:** `https://rahdari.in/privacy`,
  **Data safety** form (you collect name, email, phone, payment info via
  Razorpay), content rating, target audience.
- **Account deletion is mandatory** for apps with sign-up: Play needs a web
  URL where a user can ask for their account to be deleted. The site has no
  self-service deletion yet — add a page (even "message us from Support and we
  delete within 7 days") before submitting.
- Play reviews thin "website in a box" apps. Rahdari passes because it's a
  real logged-in tool (search, tracking, payments), but describe those features
  clearly in the listing.

### Free ways to distribute
| Where | Cost | Good for |
|---|---|---|
| **Direct APK download** — attach `app-release.apk` to a GitHub Release, or put it on rahdari.in behind a "Download Android app" button | Free | Fastest; users must allow "unknown apps" |
| **Indus Appstore** (India, by PhonePe) — https://developer.indusappstore.com | Free listing | Indian Android users, no $25 fee |
| **Samsung Galaxy Store** — https://seller.samsungapps.com | Free | Samsung phones |
| **Firebase App Distribution** | Free | Sending test builds to your team/testers |

---

## 3. iOS (iPhone)

- Building needs **macOS + Xcode**. No Mac? **Codemagic** (https://codemagic.io)
  gives 500 free macOS build minutes a month and builds this `ios/` project.
- Publishing needs an **Apple Developer account: $99/year**. There is no free
  App Store.
- Apple rejects apps that are "just a website" more readily than Google
  (guideline 4.2), and requires **in-app account deletion**. Expect to add
  native value (push notifications) before iOS approval. Meanwhile iPhone
  users can keep using **Share → Add to Home Screen** on rahdari.in, which the
  site already supports.

On a Mac:

```bash
cd mobile
npm install
npx cap sync ios
npx cap open ios
```

Xcode → pick your Team under Signing → ▶ Run on a phone → **Product →
Archive** → Distribute to App Store Connect → TestFlight → submit.

---

## 4. Where it's "hosted"

Nothing new to host. The website — and therefore the app's content — stays on
**Vercel** at rahdari.in. Apps themselves aren't hosted like websites; they're
distributed through stores. The free equivalents of "Vercel for apps" are:

- **GitHub Actions** — free builds (already set up for Android)
- **Codemagic** — free iOS/Android builds (500 min/month)
- **Firebase App Distribution** — free tester delivery
- **GitHub Releases / Indus Appstore** — free public download

---

## 5. Day-to-day

| You changed… | Do this |
|---|---|
| Anything in `src/` (the website) | Deploy to Vercel. The app shows it on next open. Nothing else. |
| `mobile/` (icon, name, native code, plugins) | Push → GitHub builds a new AAB → upload to Play Console. The version number goes up automatically. |
| The domain | Update `server.url` and `allowNavigation` in `capacitor.config.json`, `isOurs()` in `MainActivity.java`, and the URLs in `www/offline.html`; release a new build. |
| The icon | Replace `assets/icon-only.png` (and `icon-foreground.png`), then `npm run icons`, then `npx cap sync`. 1024×1024 PNG is best. |

## 6. Push notifications in the Android app (Firebase, free)

The app's WebView has no Web Push, so inside the app the **Settings → Alerts →
Notifications on this phone** switch uses Firebase Cloud Messaging instead,
through `@capacitor/push-notifications`. The site stores the phone's FCM token
in the same `push_subscriptions` table as browser subscriptions (kind `fcm`,
migration 0058), and every alert, the test button and support-message pings
go out through FCM's HTTP v1 API (`src/lib/fcm.ts`). FCM is free.

Two halves to set up, once: the **app** needs `google-services.json` so it can
register, and the **website** needs a service account so it can send. Both must
come from the **same** Firebase project.

### a. Create the Firebase project

1. https://console.firebase.google.com → **Add project** → name it `Rahdari`
   (Google Analytics: not needed, switch it off).
2. In the project: **Add app → Android**. Package name **`in.rahdari.app`**
   (must match exactly), nickname `Rahdari`. Skip the SHA-1 and the SDK steps —
   Capacitor already adds the SDK.
3. Download **`google-services.json`**.

### b. Give the app its google-services.json (a CI secret, not a commit)

The file isn't really a password, but it ties builds to your Firebase project,
so it stays out of git (`mobile/.gitignore`) and comes from a secret, like the
signing key.

GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `GOOGLE_SERVICES_JSON` | the **whole contents** of `google-services.json`, pasted as-is |

The workflow writes it to `android/app/google-services.json` before building.
Without the secret the build still succeeds (with a warning) but has no push:
**don't ship such a build**, because tapping the notification switch in it can
crash the app (Firebase isn't initialised).

Building on your own PC instead: copy the file to
`mobile/android/app/google-services.json` and build as in section 1.

### c. Give the website a Firebase service account

1. Firebase console → ⚙ **Project settings → Service accounts** →
   **Generate new private key**. A JSON file downloads. Treat it like a
   password: never commit it, never paste it anywhere public.
2. Copy three fields from it into Vercel → the project → **Settings →
   Environment Variables** (Production), and into `.env.local` for local runs:

| Variable | From the JSON |
|---|---|
| `FCM_PROJECT_ID` | `project_id` |
| `FCM_CLIENT_EMAIL` | `client_email` |
| `FCM_PRIVATE_KEY` | `private_key` — the whole `-----BEGIN PRIVATE KEY-----…` string, `\n`s and all |

3. Redeploy. **Admin → Settings → health** shows "Notifications in the Android
   app" green once all three are set.
4. Run the migration if it hasn't been: `npm run migrate` (adds the `kind`
   column to `push_subscriptions`).
5. Delete the downloaded JSON once the values are saved.

### d. Check it end to end

1. Install the new APK from the Actions run (section 1).
2. Sign in → **Settings** → **Notifications on this phone** → switch on →
   allow when Android asks.
3. **Send a test notification**. It should appear within a few seconds, with
   the app open or closed. Tapping it opens Settings.

If the test says the keys were refused, the service account and the
`google-services.json` are from different Firebase projects.

## How the website knows it's in the app

The app adds `RahdariApp/1.0` to its user agent (`appendUserAgent`).
`src/lib/native-app.ts` checks for it. It is used to hide the
"Add to home screen" banner and, on Android, to switch the phone notification
setting from Web Push to the native push plugin
(`window.Capacitor.Plugins.PushNotifications`, which the app injects into
rahdari.in pages).

## Known gaps

- **Push notifications on iPhone** aren't wired up: that needs APNs set up in
  Xcode and Firebase's iOS SDK. The iPhone app's Settings panel says so; Android
  works (see section 6).
- **iOS downloads** (CSV exports) aren't wired up yet; Android saves them to Downloads.
- **Razorpay:** the app opens rahdari.in, which is already the registered
  website, so nothing changes. Test one real UPI payment and one card payment
  in the app before launch; if Razorpay ever asks for the app, the package
  name is `in.rahdari.app`.
