# Owner finalization — one command

The repository-side remediation is complete. The remaining controls require repository administration and real Cloudflare credentials, which are intentionally not exposed to the connected GitHub app used by ChatGPT.

Run from a Windows machine where GitHub CLI (`gh`) is authenticated as the repository owner/admin:

~~~powershell
powershell -ExecutionPolicy Bypass -File tools/owner-finalize-v1.3.ps1
~~~

The script:

1. generates the independent LAB import HMAC secret locally;
2. asks the owner to enter the private POS activation secret once without echoing it;
3. stores both values as GitHub Actions secrets;
4. enables branch protection;
5. deploys the LAB Worker, binding `LAB_IMPORT_HMAC_SECRET` and `POS_ACTIVATION_SECRET`;
6. runs the real backup/recovery drill.

There is no per-device provisioning step. `DEVICE_CREDENTIAL_PEPPER`, `LAB_DEVICE_SYNC_TOKEN`, `lab-phone-main` and the device provisioning workflow are no longer part of the current architecture.

## Authentication model

On a new browser or phone, the user enters `POS_ACTIVATION_SECRET` one time. The Worker validates it and issues a random persistent session token. The browser stores only that session token. Subsequent POS requests use the session token and do not require a hardware identifier, IMEI, registered phone ID or repeated password entry.

A new activation is needed only if browser/app storage is cleared, the session is revoked, or the user moves to another fresh browser/profile.

## Recovery drill

The recovery drill is manual-only. It reads a real production D1 export, stores and re-reads that SQL from the private R2 backup bucket, restores only into a newly created temporary D1, runs integrity/canonical/count/financial checks, stores a PASS manifest in private R2, and deletes the temporary D1. It never imports the drill SQL into the production database.

Expected terminal result:

~~~text
OWNER FINALIZATION PASS
HEAD: <current feature/v1.3-mobile-cloud SHA>
LAB deploy run: <run id>
Backup/recovery drill run: <run id>
Branch protection: PASS
~~~

Only after this PASS should `OWNER_ONLY_PENDING` be considered operationally closed.
