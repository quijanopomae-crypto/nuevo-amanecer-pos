import type { Page } from '@playwright/test';

// Contraste WCAG calculado en el navegador con getComputedStyle. El fondo efectivo se arma componiendo
// los fondos de los ancestros (rgb/rgba y color(srgb …), que es lo que devuelve color-mix).
export type Contrast = { ratio: number; fg: string; bg: string };

export function contrastOf(page: Page, selector: string, prop: 'color' | 'borderTopColor' | 'backgroundColor' = 'color', against: 'self' | 'parent' = 'self'): Promise<Contrast> {
  return page.evaluate(([sel, p, ag]) => {
    const parse = (c: string): number[] => {
      let m = c.match(/^rgba?\(([^)]+)\)$/);
      if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v[3] ?? 1]; }
      m = c.match(/^color\(srgb ([^)]+)\)$/);
      if (m) { const v = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v[3] ?? 1]; }
      throw new Error('color no soportado: ' + c);
    };
    const over = (top: number[], bottom: number[]) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + bottom[i] * (1 - a)).concat(1); };
    const bgOf = (start: Element | null) => {
      const layers: number[][] = [];
      for (let n = start; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
      let out = [255, 255, 255, 1];
      for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
      return out;
    };
    const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const el = document.querySelector(sel);
    if (!el) throw new Error('no existe ' + sel);
    const bg = bgOf(ag === 'self' ? el : el.parentElement);
    const fg = over(parse((getComputedStyle(el) as any)[p]), bg);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const s = (c: number[]) => 'rgb(' + c.slice(0, 3).map(Math.round).join(',') + ')';
    return { ratio: Math.round(ratio * 100) / 100, fg: s(fg), bg: s(bg) };
  }, [selector, prop, against] as const);
}

export async function rect(page: Page, selector: string) {
  return page.locator(selector).evaluate(n => { const r = n.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; });
}

export function overlaps(a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function noHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.body.scrollWidth <= innerWidth + 1);
}
