import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';

const DEFAULT_DOCUMENT_PATH = '/laboratorio/pos-lab/index.html';

function isExternal(ref) {
  return /^(?:https?:)?\/\//i.test(ref) || /^(?:data|blob|javascript):/i.test(ref) || ref.startsWith('#');
}

function cleanRef(ref) {
  return String(ref || '').split('#')[0].split('?')[0];
}

export function collectLocalAssets(html, documentPath = DEFAULT_DOCUMENT_PATH) {
  const baseMatch = html.match(/<base\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  const documentDir = posix.dirname(documentPath) + '/';
  const baseDir = baseMatch
    ? (isExternal(baseMatch[1]) ? documentDir : posix.normalize(posix.join(documentDir, cleanRef(baseMatch[1]))))
    : documentDir;

  const assets = [];
  const tagRe = /<(script|link)\b[^>]*?\b(src|href)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(tagRe)) {
    const ref = match[3];
    if (!ref || isExternal(ref)) continue;
    const local = cleanRef(ref);
    if (!local) continue;
    const pathname = local.startsWith('/')
      ? posix.normalize(local)
      : posix.normalize(posix.join(baseDir, local));
    assets.push({ tag: match[1].toLowerCase(), attr: match[2].toLowerCase(), ref, pathname });
  }
  return assets;
}

function withBuild(ref, build) {
  if (!ref || isExternal(ref)) return ref;
  const hashAt = ref.indexOf('#');
  const hash = hashAt >= 0 ? ref.slice(hashAt) : '';
  let main = hashAt >= 0 ? ref.slice(0, hashAt) : ref;
  if (/([?&])build=[^&#]*/.test(main)) {
    main = main.replace(/([?&])build=[^&#]*/, '$1build=' + encodeURIComponent(build));
  } else {
    main += (main.includes('?') ? '&' : '?') + 'build=' + encodeURIComponent(build);
  }
  return main + hash;
}

export function stampLabHtml(html, build) {
  if (!build) throw new Error('LAB_PAGES_BUILD_REQUIRED');
  let stamped = html.replace(
    /<(script|link)\b([^>]*?)\b(src|href)=["']([^"']+)["']([^>]*)>/gi,
    (full, tag, before, attr, ref, after) => {
      if (isExternal(ref)) return full;
      return '<' + tag + before + attr + '="' + withBuild(ref, build) + '"' + after + '>';
    }
  );

  const meta = '<meta name="na-lab-build" content="' + String(build).replace(/"/g, '&quot;') + '">';
  if (/<meta\s+name=["']na-lab-build["'][^>]*>/i.test(stamped)) {
    stamped = stamped.replace(/<meta\s+name=["']na-lab-build["'][^>]*>/i, meta);
  } else {
    stamped = stamped.replace(/<head>/i, '<head>\n    ' + meta);
  }
  return stamped;
}

export function verifySite(siteDir, html) {
  const assets = collectLocalAssets(html);
  const missing = [];
  for (const asset of assets) {
    const file = join(siteDir, asset.pathname.replace(/^\/+/, ''));
    if (!existsSync(file)) missing.push({ ...asset, file });
  }
  return { assets, missing };
}

function argValue(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : null;
}

const isCli = process.argv[1] && process.argv[1].endsWith('verify-pages-site.mjs');
if (isCli) {
  const siteDir = argValue('--site');
  const build = argValue('--build');
  const stamp = process.argv.includes('--stamp');
  if (!siteDir) throw new Error('LAB_PAGES_SITE_REQUIRED');

  const indexPath = join(siteDir, 'laboratorio/pos-lab/index.html');
  let html = readFileSync(indexPath, 'utf8');
  if (stamp) {
    html = stampLabHtml(html, build);
    writeFileSync(indexPath, html, 'utf8');
  }

  const result = verifySite(siteDir, html);
  if (result.missing.length) {
    for (const item of result.missing) {
      console.error('LAB_PAGES_ASSET_MISSING', item.ref, '=>', item.pathname);
    }
    process.exit(1);
  }

  if (stamp && !html.includes('name="na-lab-build" content="' + build + '"')) {
    throw new Error('LAB_PAGES_BUILD_STAMP_MISSING');
  }

  console.log('LAB_PAGES_SITE_PASS assets=' + result.assets.length + ' build=' + (build || 'unstamped'));
}
