import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const FORMAT = 'nuevo-amanecer-pos-site-artifact-v1';

function posix(path) {
  return path.split(sep).join('/');
}

async function walk(root, dir = root) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes:true });
  entries.sort((a,b) => a.name.localeCompare(b.name, 'en'));
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, path));
    else if (entry.isFile()) out.push(path);
    else throw new Error('unsupported artifact entry: ' + posix(relative(root,path)));
  }
  return out;
}

async function fileDescriptor(root, path) {
  const stat = await lstat(path);
  if (!stat.isFile()) throw new Error('artifact path is not a regular file: ' + path);
  const bytes = await readFile(path);
  return {
    path: posix(relative(root,path)),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function validateTargetHead(targetHead) {
  if (!/^[0-9a-f]{40}$/.test(String(targetHead || ''))) throw new Error('invalid target_head');
}

export async function buildManifest(siteDir, targetHead) {
  validateTargetHead(targetHead);
  const root = resolve(siteDir);
  const paths = await walk(root);
  if (!paths.length) throw new Error('site artifact is empty');
  const files = [];
  for (const path of paths) files.push(await fileDescriptor(root,path));
  files.sort((a,b) => a.path.localeCompare(b.path, 'en'));
  return {
    format: FORMAT,
    target_head: targetHead,
    file_count: files.length,
    total_bytes: files.reduce((sum,file)=>sum+file.bytes,0),
    files,
  };
}

function validateManifestShape(manifest, expectedTargetHead) {
  if (!manifest || manifest.format !== FORMAT) throw new Error('invalid site artifact format');
  validateTargetHead(manifest.target_head);
  if (expectedTargetHead && manifest.target_head !== expectedTargetHead) throw new Error('artifact target_head mismatch');
  if (!Number.isSafeInteger(manifest.file_count) || manifest.file_count < 1 ||
      !Number.isSafeInteger(manifest.total_bytes) || manifest.total_bytes < 1 ||
      !Array.isArray(manifest.files) || manifest.files.length !== manifest.file_count) {
    throw new Error('invalid site artifact manifest counts');
  }
  const seen = new Set();
  let prior = '';
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || !file.path || file.path.startsWith('/') ||
        file.path.includes('..') || file.path.includes('\\') ||
        !Number.isSafeInteger(file.bytes) || file.bytes < 0 ||
        !/^[0-9a-f]{64}$/.test(String(file.sha256 || ''))) {
      throw new Error('invalid site artifact file descriptor');
    }
    if (seen.has(file.path) || (prior && prior.localeCompare(file.path,'en') >= 0)) throw new Error('artifact file order/uniqueness invalid');
    seen.add(file.path); prior = file.path;
  }
}

export async function verifyManifest(siteDir, manifest, expectedTargetHead = '') {
  validateManifestShape(manifest, expectedTargetHead);
  const actual = await buildManifest(siteDir, manifest.target_head);
  if (JSON.stringify(actual) !== JSON.stringify(manifest)) throw new Error('site artifact content mismatch');
  return actual;
}

async function cli() {
  const [command, siteDir, arg3, arg4] = process.argv.slice(2);
  if (command === 'build') {
    if (!siteDir || !arg3 || !arg4) throw new Error('usage: site-artifact.mjs build <site-dir> <target-head> <manifest-out>');
    const manifest = await buildManifest(siteDir,arg3);
    await writeFile(arg4, JSON.stringify(manifest,null,2) + '\n');
    console.log(JSON.stringify({status:'SITE_ARTIFACT_MANIFEST_BUILT',target_head:manifest.target_head,file_count:manifest.file_count,total_bytes:manifest.total_bytes}));
    return;
  }
  if (command === 'verify') {
    if (!siteDir || !arg3) throw new Error('usage: site-artifact.mjs verify <site-dir> <manifest-path> [expected-target-head]');
    const manifest = JSON.parse(await readFile(arg3,'utf8'));
    const verified = await verifyManifest(siteDir,manifest,arg4 || '');
    console.log(JSON.stringify({status:'SITE_ARTIFACT_VERIFIED',target_head:verified.target_head,file_count:verified.file_count,total_bytes:verified.total_bytes}));
    return;
  }
  throw new Error('usage: site-artifact.mjs <build|verify> ...');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli().catch(error => { console.error(error.message); process.exit(1); });
}
