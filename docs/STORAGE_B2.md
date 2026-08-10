# File storage — Backblaze B2

Firebase Cloud Storage has been replaced by **Backblaze B2**, accessed through
its S3-compatible API with `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner`. Firebase Authentication and Firestore are
unchanged; only the bytes moved.

Everything else about the app is the same: the UI, the upload components, and
the Firestore metadata (`url`, `path`, `name`, `type`, `size` on attachments;
`screenshotUrl` + `storagePath` on proctoring evidence) keep their existing
shapes, so no data migration is required for new uploads.

---

## The security model in one paragraph

The bucket is **private**. Nothing in the browser ever holds a B2 credential.
A client that wants to upload asks the server for permission and receives a
presigned URL valid for one object key, one content type, and ten minutes. A
client that wants to read a file follows a signed in-app link, which the server
exchanges for a presigned download URL valid for fifteen minutes. The B2 key id
and application key are server-only environment variables and are never
prefixed with `NEXT_PUBLIC_`.

---

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `B2_ENDPOINT` | yes | e.g. `https://s3.us-east-005.backblazeb2.com` |
| `B2_REGION` | yes | e.g. `us-east-005` |
| `B2_KEY_ID` | yes | B2 application key id |
| `B2_APPLICATION_KEY` | yes | B2 application key |
| `B2_BUCKET_NAME` | yes | Bucket name — must be **private** |
| `STORAGE_URL_SECRET` | no | Signs stored download links. Defaults to `B2_APPLICATION_KEY` |
| `B2_CORS_ORIGINS` | no | Overrides the origins written by `npm run storage:cors` |

`STORAGE_URL_SECRET` is worth setting in production. Without it the link
signature is derived from `B2_APPLICATION_KEY`, so rotating that key would
invalidate every attachment URL already stored in Firestore.

---

## Bucket CORS — run this once

```bash
npm run storage:cors        # apply
npm run storage:cors:show   # inspect what is currently on the bucket
```

Direct browser uploads are cross-origin `PUT`s. A bucket with no CORS rule
rejects the preflight, and the app falls back to the server proxy — which
works but caps uploads at 4 MB, so 100 MB classroom videos start failing. B2
does not implement S3's `PutBucketCors`, so the script uses B2's native API;
the key needs the `writeBuckets` capability.

**Admin → System Health** reports which upload path is actually in use.

---

## How each operation works

### Upload

1. `lib/storage/client.ts#uploadFile` POSTs `{ path, contentType, size }` to
   `/api/storage/upload-url` with the caller's Firebase ID token.
2. The route verifies the token, then re-checks the key prefix against the
   caller's role (`lib/storage/policy.ts`), the content type, and the size.
   Client-side validation decides what to *attempt*; this decides what is
   *allowed*.
3. It returns a presigned `PUT` plus the durable URL to store in Firestore.
4. The browser `PUT`s the bytes straight to B2 with real progress reporting.

Three fallbacks, in order, because a silently lost upload costs a student their
work:

| Path | When | Limit |
| --- | --- | --- |
| Presigned `PUT` direct to B2 | normal | 100 MB |
| `POST /api/storage/upload` (same-origin proxy) | direct upload failed — missing CORS, blocked network | 4 MB |
| Inline base64 data URL in the Firestore document | both failed | 600 KB |

An inline result records its path as `inline:<key>`, which is how the rest of
the app knows there is no stored object behind it.

A refusal from `/api/storage/upload-url` (bad type, forbidden prefix) is *not*
retried through the fallbacks — it would fail identically every time, and
quietly storing the file somewhere unexpected is worse than an error message.

### Download

Firestore stores a relative, signed capability URL:

```
/api/storage/download?key=<object key>&exp=<unix>&sig=<hmac-sha256>
```

`/api/storage/download` verifies the HMAC (which covers both the key and the
expiry, so a link cannot be edited into a link for another object) and
redirects to a fresh 15-minute presigned B2 URL. Because it is an ordinary URL,
it works in `<img src>` and `<a href>`, neither of which can send an
`Authorization` header. This is the same model Firebase Storage used with its
unguessable `?token=` download links, so who can open a stored attachment did
not change.

The route also accepts a bearer ID token instead of a signature. An unsigned,
unauthenticated request is refused — a bare `?key=` never resolves, so the
bucket cannot be walked by guessing paths.

### Reading a file on the server (OCR / AI)

`lib/storage/read-object.ts#readFileReference` resolves any stored reference to
bytes. Server code must use it rather than `fetch(url)`:

| Reference | Resolution |
| --- | --- |
| `/api/storage/download?key=…` | Read straight from B2. `fetch()` cannot take a relative URL in Node — this is what would otherwise break every OCR run after the migration. |
| `data:…;base64,…` | Decoded inline (the small-file upload fallback). |
| `https://…` | Fetched normally — legacy Firebase Storage links still resolve. |

`urlToBase64()` in `lib/utils/gemini.ts` delegates to it, so the OCR pipeline
reads private objects with the server's own credentials, one round trip fewer,
and without the deployment needing to call itself.

### Delete

`DELETE /api/storage/object?key=…`, authorised by prefix and role. The browser
holds no bucket credential, so every delete is a server decision.

`warningScreenshots/` is refused by this route outright — proctoring evidence
must not be destroyable by the student it was raised against. Those deletions
go through `/api/proctoring/snapshots`, which verifies the caller owns the
related exam first.

---

## Key prefixes and who may write them

`lib/storage/policy.ts` is the single place this is decided. It replaces
`storage.rules` and deliberately mirrors the prefixes that file used.

| Prefix | Upload | Delete |
| --- | --- | --- |
| `avatars/{uid}/` | owner (or staff) | owner (or staff) |
| `notices/{uid}/` | teacher/admin, own uid | same |
| `exams/` | any signed-in user (students submit answers) | teacher/admin |
| `answers/`, `submissions/`, `classrooms/`, `assignments/`, `uploads/` | any signed-in user | any signed-in user |
| `proctoring/` | any signed-in user | teacher/admin |
| `warningScreenshots/` | any signed-in user (own exam client) | **never** via this route |

Keys are normalised before use: traversal segments, absolute paths, control
characters and backslashes are rejected, so a caller-supplied path cannot
escape the prefix its role allows.

---

## Where the code lives

| File | Role |
| --- | --- |
| `lib/storage/b2.ts` | S3 client, presigning, put/delete/head/list (server-only) |
| `lib/storage/b2-native.ts` | Native B2 API — CORS status only (server-only) |
| `lib/storage/signing.ts` | HMAC capability links (server-only) |
| `lib/storage/policy.ts` | Key normalisation + prefix authorisation (isomorphic) |
| `lib/storage/constants.ts` | Size/type limits, `validateFile` (isomorphic) |
| `lib/storage/client.ts` | Browser upload client (`uploadFile`, `deleteFile`, …) |
| `app/api/storage/*` | `upload-url`, `upload`, `download`, `object` |
| `scripts/apply-b2-cors.mjs` | One-time bucket CORS setup |

---

## Local development note

If uploads hang on a developer machine with broken IPv6 routing, Node stalls on
the AAAA record for the B2 endpoint while `curl` succeeds. Start the dev server
with family autoselection disabled:

```bash
NODE_OPTIONS=--no-network-family-autoselection npm run dev
```

This is a local network quirk, not an application setting — hosted deployments
do not need it.
