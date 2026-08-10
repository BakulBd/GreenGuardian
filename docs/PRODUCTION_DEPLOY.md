# Production deployment checklist

Everything below is required for a working deployment. Items marked **silent**
do not break the build or throw on boot — the app starts fine and a feature is
simply, quietly, dead. Admin → System Health reports every one of them, and is
the first place to look after a deploy.

---

## 1. Environment variables (Vercel → Settings → Environment Variables)

### Firebase — Auth + Firestore

| Variable | Notes |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Public by design |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | |
| `FIREBASE_SERVICE_ACCOUNT` | **Required.** Inline JSON, one line. Without it every server route returns 503 |

`NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` is no longer used — file storage is B2.

### Backblaze B2 — file storage (server-only, never `NEXT_PUBLIC_`)

| Variable | Notes |
| --- | --- |
| `B2_ENDPOINT` | e.g. `https://s3.us-east-005.backblazeb2.com` |
| `B2_REGION` | e.g. `us-east-005` |
| `B2_KEY_ID` | |
| `B2_APPLICATION_KEY` | |
| `B2_BUCKET_NAME` | Must match the bucket exactly — a typo fails as `NoSuchBucket` at upload time, not at boot |
| `STORAGE_URL_SECRET` | **Set this.** Otherwise link signatures derive from `B2_APPLICATION_KEY`, and rotating that key breaks every attachment URL already stored in Firestore |

### Other

| Variable | Consequence if missing |
| --- | --- |
| `REGISTRATION_ENC_KEY` | **Silent.** A fallback key is derived; in-flight registrations break if the project id changes |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | **Silent.** OTP and reset emails are written to the server log instead of being delivered |
| `GEMINI_API_KEY` | **Silent.** OCR, AI detection and AI mark suggestions all stop; the buttons stay visible and fail |
| `NEXT_PUBLIC_TURN_URLS` / `_USERNAME` / `_CREDENTIAL` | Optional. Without TURN, ~10–20% of students fall back to the 1 fps Firestore relay for live video |
| `CONFIG_CHECK_TOKEN` | Optional. Gates `/api/auth/config-check` in production |

---

## 2. One-time setup

```bash
# Firestore rules and indexes — REQUIRED after any change to firestore.rules
npm run firebase:deploy:rules

# B2 bucket CORS — enables direct browser uploads
npm run storage:cors
npm run storage:cors:show   # verify
```

The bucket must be **private** (`allPrivate`). `npm run storage:cors:show`
prints the bucket type and warns if it is not.

Without the CORS rule the app still uploads, but every upload routes through
the server proxy and is capped at 4 MB — so 100 MB classroom videos fail. The
System Health page states which path is live.

---

## 3. Verify after deploying

Sign in as an admin and open **Dashboard → System Health**. Confirm:

- [ ] **All systems operational** (green)
- [ ] Object storage — bucket reachable, region correct
- [ ] Direct browser uploads — CORS applied
- [ ] Email delivery — sending as your `MAIL_FROM`
- [ ] Capabilities — `aiOcrAndGrading`, `objectStorage`, `emailDelivery` all enabled
- [ ] Modules — counts look plausible for your data
- [ ] Server logs — no repeated errors

Then walk one path of each kind, because these are the four that depend on
config rather than code:

1. **Student joins a classroom by code** → membership appears in People.
2. **Student submits an assignment with a PDF** → teacher sees the file.
3. **Student sits an exam, triggers a warning** → the screenshot appears in
   Teacher → Snapshots.
4. **Teacher marks an upload-mode submission** → the mark shows on the
   student's results.

---

## 4. Things that are per-instance, not global

The **server log panel** reads an in-memory ring buffer belonging to one
serverless instance. It is a diagnostic aid for "what went wrong just now", not
an audit log. For a durable, complete record use the hosting provider's log
drain. The panel says as much on screen so nobody concludes "no errors" from an
empty list that belongs to a different instance.

---

## 5. Known operational notes

- **Local dev on a machine with broken IPv6**: Node stalls connecting to the B2
  endpoint while `curl` succeeds. Start with
  `NODE_OPTIONS=--no-network-family-autoselection npm run dev`. Hosted
  deployments are unaffected.
- **Firestore composite indexes**: the System Health module counters degrade to
  `—` rather than failing if an index is missing. `npm run firebase:deploy:rules`
  deploys `firestore.indexes.json` along with the rules.
- **Rules changes are not automatic.** A code deploy does not deploy
  `firestore.rules`. Several past "permission denied" reports were an
  un-redeployed ruleset.
