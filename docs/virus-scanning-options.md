# Virus scanning of uploads: options note (D30)

Status: **plan only.** No code, dependency or service is added by this note, and nothing is bought. D30 today: uploads are not scanned; they are marked "not scanned" and only the Owner and the uploading customer can open them. This note is for the Owner's decision before launch.

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
