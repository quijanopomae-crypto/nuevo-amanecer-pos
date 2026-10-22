import { expect, type Locator, type Page } from '@playwright/test';

// Comprobaciones de layout reutilizables y deterministas.
// En lugar de contar fragmentos con getClientRects() (que varía con nodos
// inline, ::before y el momento del reflow), se mide la caja delimitadora y se
// reintenta con expect.poll hasta que el layout se estabiliza.

export type FitsOptions = {
  /** Selector del contenedor; se busca con closest() desde el objetivo y, si no, en el documento. */
  within: string;
  /** Mide solo el texto del objetivo (Range), sin pseudo-elementos ni padding. */
  text?: boolean;
  /** Exige que el contenido ocupe una sola línea (alto <= 1.5 × line-height). */
  singleLine?: boolean;
  /** Tolerancia en px para redondeos subpíxel. */
  tolerance?: number;
};

/** Devuelve la lista de problemas de layout del objetivo; [] significa que cabe. */
export function fitsProblems(target: Locator, options: FitsOptions): Promise<string[]> {
  return target.evaluate((node: Element, o: FitsOptions) => {
    const tol = o.tolerance ?? 1;
    const problems: string[] = [];
    if (!node.isConnected) return ['objetivo desconectado del DOM'];
    const container = node.closest(o.within) ?? document.querySelector(o.within);
    if (!container) return [`no existe el contenedor ${o.within}`];
    let rect: DOMRect;
    if (o.text) {
      const range = document.createRange();
      range.selectNodeContents(node);
      rect = range.getBoundingClientRect();
    } else rect = node.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    const r = (n: number) => Math.round(n * 10) / 10;
    if (rect.width <= 0 || rect.height <= 0) problems.push(`caja vacía ${r(rect.width)}×${r(rect.height)}`);
    if (rect.left < box.left - tol || rect.right > box.right + tol) problems.push(`sale en horizontal: [${r(rect.left)}, ${r(rect.right)}] fuera de [${r(box.left)}, ${r(box.right)}]`);
    if (rect.top < box.top - tol || rect.bottom > box.bottom + tol) problems.push(`sale en vertical: [${r(rect.top)}, ${r(rect.bottom)}] fuera de [${r(box.top)}, ${r(box.bottom)}]`);
    const el = node as HTMLElement;
    if (!o.text && el.scrollWidth > el.clientWidth + tol) problems.push(`contenido recortado: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    if (o.singleLine) {
      const style = getComputedStyle(el);
      const lineHeight = style.lineHeight === 'normal' ? parseFloat(style.fontSize) * 1.2 : parseFloat(style.lineHeight);
      if (rect.height > lineHeight * 1.5) problems.push(`más de una línea: alto ${r(rect.height)} con line-height ${r(lineHeight)}`);
    }
    return problems;
  }, options);
}

/** Espera (web-first) a que la caja del objetivo quede dentro de su contenedor. */
export async function expectFits(target: Locator, options: FitsOptions, message?: string) {
  await expect.poll(() => fitsProblems(target, options), { message: message ?? `${target} debe caber en ${options.within}` }).toEqual([]);
}

/**
 * Espera a que el contenedor no tenga scroll horizontal (ni el documento) y a que
 * todos los descendientes que coinciden con `selector` quepan en su ancho.
 */
export async function expectAllFit(container: Locator, selector: string, tolerance = 1) {
  await expect.poll(() => container.evaluate((root: Element, [sel, tol]: [string, number]) => {
    const problems: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > window.innerWidth + tol) problems.push(`documento con scroll horizontal ${doc.scrollWidth} > ${window.innerWidth}`);
    if (root.scrollWidth > root.clientWidth + tol) problems.push(`contenedor con scroll horizontal ${root.scrollWidth} > ${root.clientWidth}`);
    const box = root.getBoundingClientRect();
    for (const child of root.querySelectorAll<HTMLElement>(sel)) {
      const rect = child.getBoundingClientRect();
      const name = child.tagName.toLowerCase() + (child.className && typeof child.className === 'string' ? '.' + child.className.trim().split(/\s+/).join('.') : '');
      if (rect.left < box.left - tol || rect.right > box.right + tol) problems.push(`${name} sale en horizontal`);
      if (child.scrollWidth > child.clientWidth + tol) problems.push(`${name} recortado (${child.scrollWidth} > ${child.clientWidth})`);
    }
    return problems;
  }, [selector, tolerance] as [string, number]), { message: `${container} y sus ${selector} sin desbordes` }).toEqual([]);
}

/**
 * Guard: espera a que la hoja `href` esté cargada y parseada, y a que una
 * custom property que solo define esa hoja ya resuelva en `scope`.
 */
export async function expectStylesheetApplied(page: Page, href: string, scope: Locator, customProperty: string) {
  await expect.poll(() => page.evaluate(h => {
    const link = document.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href$="${h}"]`);
    try { return !!link?.sheet && link.sheet.cssRules.length > 0; } catch { return false; }
  }, href), { message: `${href} debe estar cargada` }).toBe(true);
  await expect.poll(() => scope.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop).trim(), customProperty),
    { message: `${href} debe aplicarse (${customProperty})` }).not.toBe('');
}
