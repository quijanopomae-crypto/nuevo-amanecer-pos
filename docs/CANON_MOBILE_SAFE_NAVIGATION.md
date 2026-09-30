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
8. Keep LAB parity page-entry Motion disabled on mobile.
9. For **Clientes only**, register the existing scroll-linked `clientes` preset after paint/idle so `.filter-bar` and `.stats-strip` recover the approved LAB collapse/fade behavior without delaying module entry.

Desktop keeps the existing goPage flow.

## Scope

No sales, inventory, credit, cash, expense, sync, storage, D1 or R2 behavior is changed.


## Clientes targeted Motion recovery

The mobile-safe fallback originally disabled all parity Motion because real phones
had frozen before the destination shell painted. That safety rule remains for
page-entry transitions and navigation wrappers.

The Clientes correction is narrower: after the destination has already painted,
`body.module-mobile-scroll` is active and the browser reaches idle time,
`menu-navigation.js` registers only the existing `NA_MOTION.scroll` preset
`clientes`. The preset already targets `.filter-bar` and `.stats-strip` and
uses the promoted CANON CSS. If the Motion runtime is absent or throws,
navigation/rendering continue normally.

This does not enable the same post-paint preset for Inventario, Ventas, Caja or
Gastos; those remain under the previous mobile-safe behavior until separately
validated.
