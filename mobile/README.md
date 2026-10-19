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

## How the website knows it's in the app

The app adds `RahdariApp/1.0` to its user agent (`appendUserAgent`).
`src/lib/native-app.ts` checks for it. Right now that is used to hide the
"Add to home screen" banner and to give an honest message on the phone
notification setting.

## Known gaps

- **Phone push notifications** don't work inside the app yet. The app's WebView
  has no Web Push; it needs Firebase Cloud Messaging (`@capacitor/push-notifications`)
  plus a server change to send through FCM. Telegram alerts work as normal.
- **iOS downloads** (CSV exports) aren't wired up yet; Android saves them to Downloads.
- **Razorpay:** the app opens rahdari.in, which is already the registered
  website, so nothing changes. Test one real UPI payment and one card payment
  in the app before launch; if Razorpay ever asks for the app, the package
  name is `in.rahdari.app`.
