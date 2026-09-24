# Owner finalization — one command

The repository-side remediation is complete. The remaining controls require repository-administration and real Cloudflare credentials, which are intentionally not exposed to the connected GitHub app used by ChatGPT.

Run from a Windows machine where GitHub CLI (gh) is authenticated as the repository owner/admin:

~~~powershell
powershell -ExecutionPolicy Bypass -File tools/owner-finalize-v1.3.ps1
~~~

The script generates independent 256-bit LAB import and device pepper secrets locally without printing them, enables branch protection, deploys the hardened LAB secret separation, refreshes the LAB writer credential binding, and runs the real backup/recovery drill.

The recovery drill is manual-only. It reads a real production D1 export, stores and re-reads that SQL from the private R2 backup bucket, restores only into a newly created temporary D1, runs integrity/canonical/count/financial checks, stores a PASS manifest in private R2, and deletes the temporary D1. It never imports the drill SQL into the production database.

Previous successful remote runs on 2026-09-24 demonstrate that this repository previously had working Cloudflare/LAB deployment and device-provisioning credentials. The finalizer still fails closed if an existing credential has since been removed or lost permissions.

Expected terminal result:

~~~text
OWNER FINALIZATION PASS
HEAD: <current feature/v1.3-mobile-cloud SHA>
LAB deploy run: <run id>
LAB device run: <run id>
Backup/recovery drill run: <run id>
Branch protection: PASS
~~~

Only after this PASS should OWNER_ONLY_PENDING be considered operationally closed.
