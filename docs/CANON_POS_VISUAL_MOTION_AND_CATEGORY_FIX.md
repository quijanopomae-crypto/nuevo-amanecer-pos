# CANON POS visual motion and category fix

## Evidence

- CANON published products render in the Todo category, but category tabs such as Bebidas can show Sin productos because the canonical adapter exposes categoria while legacy POS filtering reads cat.
- CANON contains the motion infrastructure, but the Clientes refresh motion approved in LAB is not loaded as a CANON bridge.
- Toast and cart motion helpers exist in CANON, but the POS events do not call them.

## Authorized scope

- Add cat to the read-only legacy snapshot produced by POS/js/sync/canonical-client.js.
- Add a visual-only Clientes motion bridge in POS/js/motion/client-list-motion.js.
- Load that bridge after POS/js/modules/client-credit-accounts-v2.js.
- Add the LAB-approved timing values to POS/css/client-credit-accounts-v2.css using CANON class names.
- Connect existing visual helpers for toast and cart badge feedback.
- Update docs/MOTION_MAP.yaml.

## Business safety

This change does not create sales, payments, credits, cash movements, network calls, storage writes, authorization decisions, or stock mutations. If the motion bridge fails, cliRender falls back to the original function or to a static UI path for reduced-motion users.

## Rollback

Revert the branch commits that touch the files listed above. The POS returns to the previous static Clientes refresh and the prior legacy category mapping.
