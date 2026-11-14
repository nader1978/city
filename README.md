# 🏙️ City Services Guide · دليل خدمات المدينة

A bilingual (English / Arabic) city services directory.

- **Residents** search for services and see verified details: hours, address, phone, fees and required documents.
- **Service and shop providers** sign in with Google and submit their listings.
- **The admin** reviews each submission and approves it (it's published right away) or sends it back with a note.

> **بالعربية:** دليل ثنائي اللغة لخدمات المدينة. يبحث السكان عن الخدمات، ويضيف مقدّمو الخدمات والمتاجر بياناتهم، وتراجعها الإدارة قبل نشرها. اتبع الخطوات أدناه لنشر الموقع على GitHub Pages وربطه بـ Firebase.

---

## Files

| File | What it is |
|---|---|
| `index.html` | The page |
| `styles.css` | Design (supports right-to-left Arabic) |
| `app.js` | App logic |
| `i18n.js` | All English and Arabic text, and the service categories (edit categories here) |
| `store.js` | Data layer: Firebase (live) or browser storage (demo) |
| `config.js` | **Your settings**: Firebase keys and admin email(s) |
| `firestore.rules` | Database security rules to paste into Firebase |

There's no build step. It's plain HTML, CSS and JavaScript.

---

## Step 1: Put it on GitHub Pages (works right away in demo mode)

1. Create a new repository on GitHub, for example `city-services-guide`.
2. Upload all the files in this folder to the repository (**Add file → Upload files**), then **Commit**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute, your site is live at `https://YOUR-USERNAME.github.io/city-services-guide/`.

Until you finish Step 2, the site runs in **demo mode**. A yellow bar at the top lets you switch between *Resident*, *Provider* and *Admin* to try the whole flow. In demo mode, data is saved **only in that visitor's browser**, so it's good for showing people how it works but not for real use.

---

## Step 2: Connect Firebase (free) so it works for everyone

Firebase stores the listings and handles Google sign-in. The free *Spark* plan is enough for a city directory.

### 2a. Create the project
1. Go to <https://console.firebase.google.com> and click **Create a project**. You can turn off Google Analytics.
2. On the project home page, click the **Web** icon (`</>`), give the app a name, and click **Register app**. Don't tick Firebase Hosting.
3. Firebase shows a `firebaseConfig` block. Copy its values into **`config.js`**, replacing the placeholders.

### 2b. Turn on Google sign-in
1. Go to **Build → Authentication → Get started → Sign-in method → Google → Enable**, choose a support email, and **Save**.
2. Go to **Authentication → Settings → Authorized domains → Add domain** and add `YOUR-USERNAME.github.io`.

### 2c. Create the database
1. Go to **Build → Firestore Database → Create database**. Pick a location close to you (for example `me-central1` or `europe-west`) and start in **production mode**.
2. Open the **Rules** tab, paste the contents of **`firestore.rules`**, replace `admin@example.com` with your admin Google email, and click **Publish**.

### 2d. Set the admin
In **`config.js`**, put the same admin email in `adminEmails`. You can list more than one, but each must also be in `firestore.rules`.

### 2e. Upload the updated `config.js` to GitHub
Commit it. Within a minute the yellow demo bar disappears and the site is live.

> The Firebase web config in `config.js` is **meant to be public**. It isn't a password. Your data is protected by `firestore.rules`.

---

## How it works

```
Provider signs in ──► fills the form ──► submissions/{their id}   (status: pending)
                                                 │
Admin opens "Admin" tab ◄────────────────────────┘
   ├─ Approve  ──► copied to listings/{id}  ──► visible to everyone
   └─ Send back with note ──► provider sees the note, edits, resubmits
```

- If a provider edits a published listing, the old version stays live until the admin approves the update. The admin sees the changes highlighted.
- Providers can ask for a listing to be removed, and the admin confirms.
- The search understands Arabic spelling variants (أ/إ/ا, ة/ه, ى/ي, diacritics) and searches both languages at once.

## Customising

- **Categories:** edit the `CATS` list in `i18n.js` (English label, Arabic label and emoji).
- **Text:** all wording is in `i18n.js`, under `en` and `ar`.
- **Colours:** change `--brand` and the other colour variables at the top of `styles.css`.
- **Sample listings:** they appear only in demo mode. The live Firebase database starts empty.

## Testing locally

The site uses JavaScript modules, so open it through a small web server rather than double-clicking the file:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
