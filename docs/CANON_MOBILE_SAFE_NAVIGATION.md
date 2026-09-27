# CANON Mobile Safe Navigation

## Purpose

Provide a mobile-only fallback path that prioritizes entering the module over animation or navigation wrappers.

## Mobile order

1. Intercept the menu card tap.
2. Remove active from all pages.
3. Add active to the requested page.
4. Show Back and scroll to top.
5. Let the browser paint.
6. Apply module/config scroll classes.
7. Schedule the existing renderer after the browser is idle.
8. Skip LAB parity Motion on mobile.

Desktop keeps the existing goPage flow.

## Scope

No sales, inventory, credit, cash, expense, sync, storage, D1 or R2 behavior is changed.
