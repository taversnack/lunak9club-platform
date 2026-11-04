# Virus scanning of uploads: options note (D30)

Status: **plan only.** No code, dependency or service is added by this note, and nothing is bought. Owner decision (D30, Stephen): ClamAV in a sidecar container; when the scanner is down, **hold the upload for the Owner**. Section "Implementation plan" below is the build plan; it is not built. D30 today: uploads are not scanned; they are marked "not scanned" and only the Owner and the uploading customer can open them. This note is for the Owner's decision before launch.

## What is uploaded today

Vaccination certificates (`uploadVaccinationRecord`) and incident photos or PDFs (welfare). Every upload is already checked by its bytes (PDF, JPEG, PNG, WEBP or HEIC only, never by name or browser type), is at most 10 MB, is stored under a random private key, and is opened only through the app after a permission check, by short-lived link, with every view audited. That removes most risk (no scripts served, no guessable URLs), but it does not detect a malicious PDF or a booby-trapped image.

## Options

| Option | What it is | Cost | Notes |
|---|---|---|---|
| A. ClamAV in a sidecar container | The open-source ClamAV daemon (`clamd`) running next to the app; the app streams each file to it before accepting it | Software free. Extra memory: plan about 2 GB of RAM for the signature database, a larger VPS or container size (**paid item, flag to the Owner**) | Fits the Node container / VPS plan (D107). Signature updates (`freshclam`) need outbound internet once or twice a day. Slow to start (a minute or two after boot). Detection is signature-based, so it finds known malware, not clever new files. |
| B. Same scanner, run after upload by the scheduler | The file is stored as "pending", the 10-minute tick scans it, and it opens only once clean | Same as A | Upload is instant and survives scanner downtime, but needs a database column for the scan state (a migration with a rollback plan) and a "being checked" state in the UI. |
| C. A hosted scanning API | Send each file to a third-party service | Free tiers exist, but most are not for commercial use or retain the files | **Not recommended.** Customers' documents and incident photos (which can show people) would leave our control, which conflicts with the privacy rules (UK GDPR, CLAUDE.md rule 5). |
| D. Object-store scanning add-on | A storage provider's built-in or marketplace malware scan | Usually paid | Depends on the bucket provider, which is not chosen. Revisit once it is. |
| E. Keep D30 as it is | Type check, size cap, private storage, Owner/uploader only | Free | Honest and low effort, but a customer could still upload an infected PDF that the Owner then opens. |

## Recommendation

A first, with B's "pending" idea only if the Owner wants uploads to keep working when the scanner is down. Reason: free software, no third-party data sharing, and it fits the container plan. The only real cost is the extra RAM.

## What happens when the scanner is down

Two safe choices; both fail closed (an unscanned file is never opened by anyone but the Owner, with a visible warning):

1. **Reject the upload** with "We can't check files right now, please try again in a few minutes." Simplest, no migration. The customer is inconvenienced and a vaccination check may be delayed.
2. **Hold the document for the Owner**: accept it, mark it "not yet checked", retry from the scheduler, and let only the Owner open it (with a warning, audited) until it is clean. Better for customers, but needs the scan-state column and a UI state.

Suggested default: sync scan with a 10-second timeout; if the scanner is down or slow, use choice 2. An infected result is never kept for opening: it is quarantined (the file moved to a restricted key or deleted, the record rejected with a plain reason), an audit event is written, and the Owner is told with no file name or contents in the email.

## Effect on the runtime

- A second container (the scanner), health-checked, that the app reaches over the private network only (never exposed publicly).
- Roughly 2 GB more memory, and a minute or two of start-up. Scanning a 10 MB file takes a second or two.
- The app adds a small TCP client for the scanner's `INSTREAM` command. This is simple enough to write without a new dependency, but if a library is preferred that is a dependency decision for the Owner.
- `docs/deployment.md` gets the scanner's container, update and monitoring steps; the health endpoint can report scanner reachability once built.

## Testing

Use the harmless industry-standard EICAR test string, never a real virus, against a scanner container in an integration test. A fake scanner is used for the "scanner down" paths. No real customer files are ever used.

## Decisions for the Owner

1. Is the extra memory (a bigger VPS or container) acceptable?
2. When the scanner is down: reject (choice 1) or hold for the Owner (choice 2)?
3. Scan before launch, or launch with D30 as it is and add scanning later?

## Implementation plan (not built)

**Switch.** `SCANNER_MODE=off|clamav`, default `off`. While off, nothing changes: uploads stay `not_scanned` exactly as D30 says today. The extra memory is a paid host-size item, so the scanner stays off until Stephen approves the cost; production config can then turn it on without a code change.

**Data model (one migration, additive, with rollback).** `documents.scan_status` already exists (`not_scanned | clean | infected`, check constraint `documents_scan_chk`). The migration:
1. widens that check to add `held` (accepted but not yet checked);
2. adds `scan_attempts integer not null default 0` and `scanned_at timestamptz` (last attempt), both with safe defaults.
Existing rows keep `not_scanned`; nothing is rewritten. **Rollback:** `UPDATE documents SET scan_status = 'not_scanned' WHERE scan_status = 'held'`, drop the new check, re-add the old one, drop the two columns. No data is lost (the files themselves are untouched). This is non-destructive, so no backfill is needed (CLAUDE.md rule 6 note goes in `drizzle/NOTES.md`).

**Scanner client.** A small module (`src/infra/scan/clamd.ts`, no new dependency) using `node:net` to speak clamd's `INSTREAM`: send `zINSTREAM\0`, then length-prefixed chunks, then a zero-length chunk; read `stream: OK` or `stream: <name> FOUND` or an error. 10 second timeout. Returns `clean | infected | unavailable`; it never throws file contents or the signature name into logs or errors. Host and port from `SCANNER_HOST` and `SCANNER_PORT`, validated in `env.ts` (required when `SCANNER_MODE=clamav`). The same type check, 10 MB cap and random private key stay in front of it.

**Upload flow** (`uploadVaccinationRecord`, incident photos in `welfare.ts`): after the byte check, scan before the file is committed.
- clean: store, `scan_status='clean'`.
- scanner unavailable or timed out: store, `scan_status='held'`, `scan_attempts=1`; the customer sees "Received. We're checking it, and it can't be opened until then."
- infected: do not keep the bytes. Row (kept for the audit trail with its sha256) is `infected`, the object is deleted, the submission becomes `replacement_requested` with the plain reason "We couldn't accept that file. Please upload a new copy.", an audit event is written, and the Owner is emailed "A file was blocked by the scanner" with a link to the Owner area and no file name, customer or contents.

**Retry from the scheduler.** A new every-tick step (`scan-held-documents`): pick `held` rows with `FOR UPDATE SKIP LOCKED` and backoff by `scanned_at`, re-scan, move to `clean` or `infected` as above. Idempotent and safe if two ticks overlap. A document still held after 24 hours stays held and shows on Today until dealt with.

**Opening held files (Owner only, audited).** `authoriseDocumentDownload` already limits downloads to the Owner and the uploader. For `held` files only the Owner (`documents.read_any`) may open it, the uploader gets the same not-found response as for any document they may not open, and the open requires an explicit acknowledgement (a confirm step in the UI sends it; the server refuses without it) and writes `document.opened_unscanned` to the audit log. `infected` files can never be opened (the bytes are gone). Clean and `not_scanned` behave as today.

**Owner Today.** `ownerInbox` gets a new kind `document_held` ("A file is waiting for a virus check"), no due date, ordered by age, one item per held document with the customer's name and a link to the dog or review page; it disappears when the file is checked. Frontend wires the item and the "open anyway" confirm step.

**Tests (no real malware).** A fake clamd (an in-process TCP server speaking `INSTREAM`) covers clean, found, error, timeout and connection refused for the client. Integration tests: upload clean; scanner down gives held and a customer message; retry turns held into clean and into infected; infected removes the object, rejects the submission and writes an audit event with no personal data; only the Owner can open held files and only with the acknowledgement, each open audited; `SCANNER_MODE=off` changes nothing. An optional test against a real ClamAV container uses only the harmless EICAR string and runs only when a scanner address is set (CI service container later).

**Dev setup.** A `scanner` profile in `docker-compose.yml` (the official `clamav/clamav` image, memory limit set, not started by default) so `docker compose --profile scanner up` adds it; nothing else changes for people who do not use it.

**Memory and cost.** ClamAV loads its whole signature database into RAM: plan for about 2 GB for the scanner container (more briefly while it reloads signatures; setting `ConcurrentDatabaseReload no` avoids the doubling at the price of a short pause). On a VPS or container host that usually means moving up a size. **This is a paid host-size item that needs Stephen's approval before the scanner is switched on.** Software, updates and tests are free.

**Effort (rough).** About 4 to 5 working days: migration and notes 0.5, scanner client and fake 1, upload flow for documents and incident photos 1, scheduler retry 0.5, Owner open rules and audit 0.5, inbox item 0.5, tests 1, compose, env checks and docs 0.5. Frontend adds roughly a day for the Today item and the confirm step.

**Order of work (when scheduled).** Migration and client with tests first (no behaviour change while `off`), then the upload flow, the retry step, the Owner open rules and the inbox item, then docs. Each is its own small PR so the tester can gate them.

