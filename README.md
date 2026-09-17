# eTIMS Retransmission Tool

Local tool to re-queue a processed KRA eTIMS sales invoice JSON file for
retransmission, by moving it from the `processedArchive` folder into the
`resend\trnsSales` folder for the selected entity.

## Setup

```
npm install
npm start
```

Then open http://localhost:4173

During development, `npm run dev` runs the same server via Node's built-in
`--watch`, restarting automatically whenever a file changes. `node
server.js` also works directly — all three (`npm start`, `npm run dev`,
`node server.js`) start the same app.

## Configuration

Copy [.env.example](.env.example) to `.env` and adjust values for this machine:

```
PORT=4173
EBM_DATA_ROOT=C:\..put_full_path
SOURCE_SUBPATH=Data\processed\processedArchive
DEST_SUBPATH=Data\resend\trnsSales
SEARCH_MAX_DEPTH=6
```

| Variable            | Purpose                                                              | Default |
|---------------------|-----------------------------------------------------------------------|---------|
| `PORT`              | Port the local web UI listens on                                      | `4173`  |
| `EBM_DATA_ROOT`     | Root folder containing the per-entity `P0000...P_00` directories      | `C:\...\AppData\EbmData` |
| `SOURCE_SUBPATH`    | Path (relative to `<EBM_DATA_ROOT>\<entity>`) searched for archives   | `Data\processed\processedArchive` |
| `DEST_SUBPATH`      | Path (relative to `<EBM_DATA_ROOT>\<entity>`) files are moved into    | `Data\resend\trnsSales` |
| `SEARCH_MAX_DEPTH`  | How many sub-folder levels deep to search under `SOURCE_SUBPATH`      | `6`     |
| `HOST`              | Network interface the server binds to                                 | `127.0.0.1` |
| `ALLOWED_ORIGINS`   | Extra origins (comma-separated) allowed to call the API, beyond `localhost`/`127.0.0.1` | *(empty)* |

If `HOST` is changed to a LAN IP (or `0.0.0.0`) so the app can be reached
from other machines — e.g. through a DNS name like
`http://nav.farmerschoice.co.ke:8089` — you **must** also set
`ALLOWED_ORIGINS` to that exact origin, or every request will fail with
`"Cross-origin request rejected."` (see [Security](#security)):

```
ALLOWED_ORIGINS=http://nav.farmerschoice.co.ke:8089
```

`.env` is git-ignored since it's machine-specific; `.env.example` is the
template to copy. Settings can also be set as real environment variables
instead of (or to override) `.env`.

Entities are configured in [config.js](config.js):

| Folder          | Display name  | Default |
|-----------------|---------------|---------|
| P000592722P_00  | Farmerschoice | Yes     |
| P000613908P_00  | Flamingo      | No      |

## How it works

1. Enter the invoice number, e.g. `KRACU0300007620/478344`. The part after
   the `/` (`478344`) is used to search `Data\processed\processedArchive`
   (including sub-folders) for a matching `.json` file.
2. If exactly one match is found, it is safely moved into
   `Data\resend\trnsSales`:
   - the file is copied to a temp file in the destination and flushed to disk,
   - the copy is checksum-verified against the source,
   - only then is it atomically renamed to its final name,
   - only after that succeeds is the original file in `processedArchive`
     deleted.

   If any step fails before the final delete, nothing is removed from
   `processedArchive` and any partial file in the destination is cleaned up
   — no document is ever left missing from both locations.
3. If zero or more than one file matches, nothing is moved and the app
   reports the problem instead of guessing.

### Bulk mode

Switch to the **Bulk** tab to process a list of invoice numbers instead of
one. Paste them one per line — a column copied straight out of Excel pastes
in as one-per-line automatically, so no file upload is needed:

```
KRACU0300007620/401074
KRACU0300007620/401076
KRACU0300007620/401087
```

Each invoice number is sent to the server and its response is received
back **before the next one is sent** ([public/app.js](public/app.js)) — the
batch runs strictly one at a time, never in parallel, so two file moves can
never overlap. Every row in the results table updates live as its result
comes back and is colour-highlighted green (success) or red (failed), with
its filename or failure reason shown alongside. If any fail, a "Copy
failed" button copies just their invoice numbers back to the clipboard for
a retry. Capped at 500 invoice numbers per batch.

## Logging

Every request — successful transmissions, rejected input, and system
errors — is recorded in `logs/<YYYY-MM-DD>.json`, one file per calendar
day, as a JSON array of entries:

```json
[
  {
    "timestamp": "2026-09-15T14:33:21.731Z",
    "level": "INFO",
    "event": "TRANSMIT_SUCCESS",
    "invoiceNumber": "KRACU0300007620/478344",
    "entityId": "P000592722P_00",
    "entityName": "Farmerschoice",
    "fileName": "trnsSales_KRACU0300007620_478344.json"
  },
  {
    "timestamp": "2026-09-15T14:33:21.727Z",
    "level": "WARN",
    "event": "TRANSMIT_FAILURE",
    "invoiceNumber": "X/000000",
    "entityId": "P000592722P_00",
    "code": "NO_MATCH",
    "message": "No archived file matching reference \"000000\" was found for Farmerschoice."
  }
]
```

- `level: "INFO"` — a successful transmission (`TRANSMIT_SUCCESS`).
- `level: "WARN"` — the request was rejected because of what the user
  entered (bad format, no match, ambiguous match, missing fields).
- `level: "ERROR"` — something on the system side stopped the transmission
  (e.g. the configured archive folder doesn't exist, a copy failed). These
  entries include the full internal error detail (which may include a file
  path) — this file is for the operator, it is never sent to the browser.

Writes are serialized per day-file and written atomically (temp file +
rename), so two requests landing at the same time can't corrupt the log or
overwrite each other's entries; a log file found to be corrupt on read is
quarantined (renamed with a `.corrupt-<timestamp>` suffix) rather than
silently overwritten. `logs/` is git-ignored.

## Security

This tool moves real tax-invoice files based on user input, so it's built
so that only the two folders you configure can ever be touched, and only by
requests actually made from this app running on this machine:

- **No arbitrary paths from the client.** The browser only ever sends an
  invoice number and an entity choice. The entity is checked against a
  hardcoded whitelist ([config.js](config.js)) before it's used to build any
  path — an unrecognised entity is rejected outright, never used to
  construct a folder name. The invoice-number reference is validated to be
  short, alphanumeric (plus `-`/`_`), and is only ever used as a
  `.includes()` filter over files Node itself already listed from disk — it
  is never concatenated into a path.
- **Every resolved path is re-confirmed to stay inside `EBM_DATA_ROOT`**
  ([config.js](config.js) `assertWithinRoot`), both at startup (a typo'd
  `SOURCE_SUBPATH`/`DEST_SUBPATH` in `.env` fails immediately rather than
  silently pointing elsewhere) and again for every file the search step
  matches.
- **Symbolic links inside the archive tree are skipped, not followed**
  ([lib/search.js](lib/search.js)), so a link planted there can't be used to
  pull in or overwrite a file from outside the configured folders.
- **The move only ever writes inside the destination folder and only ever
  deletes the one matched source file** — see the copy-verify-then-delete
  sequence in [lib/safeMove.js](lib/safeMove.js). It also refuses to
  overwrite an existing file at the destination.
- **The server only listens on `127.0.0.1` by default** (`HOST` in `.env`),
  so no other device on the network can reach it — only processes on this
  machine can. If `HOST` is deliberately changed to a LAN IP so a remote
  team can reach it (e.g. `http://nav.farmerschoice.co.ke:8089`), that
  network exposure is now intentional and the origin check below becomes
  the main thing standing between "this app" and "anything else on the
  network" — keep `ALLOWED_ORIGINS` scoped to exactly the origin(s) people
  actually use, never a wildcard.
- **Cross-origin requests to `/api/transmit` are rejected** ([server.js](server.js)
  `requireSameOrigin`), so a malicious page open in another browser tab
  can't silently trigger a file move by POSTing to it in the background
  (CSRF). Only requests whose `Origin`/`Referer` matches this app's own
  origin (`localhost`/`127.0.0.1` plus whatever is listed in
  `ALLOWED_ORIGINS`) — or plain local tools like `curl` that send neither
  header — are accepted.

What this does **not** protect against: anyone who can already run code as
your Windows user account, or who has filesystem access to
`EBM_DATA_ROOT` directly, already has the same access this app has — there
is no OS-level permission boundary here, only application-level input and
path validation. If several people share this machine/account, treat that
as the actual trust boundary.
