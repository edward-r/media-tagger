# Photo Categorization and Segue to SaaS
Absolutely — we’ll add **`tag-this --apply`**, and I’ll give you **everything again** (full repo code + full workflow).

What this enhancement does:

- `tag-this` still does: **query → generate review → start server**  
- When you click **Save approvals**, the UI will:
  - show an **Apply tags** button
  - and if you ran with `--apply`, it will **auto-apply immediately after saving approvals**
- Applying happens via a new server endpoint: `POST /api/apply`
- Tags are written as **basename XMP sidecars** next to the media files (as before)

New (prefilter): `query-text`
- Runs **zero-shot retrieval** using a CLIP text prompt (example: "a photo of a dog").
- Writes results to `data/<out>` and also updates `data/last_query.json` so the existing review/apply flow works unchanged.

Example:

```bash
npm run query-text -- --text "a photo of a dog" --k 2000 --minScore 0.22 --out dog_candidates.json
npm run review
npm run review:serve -- --port 8787
npm run apply -- --tag "Dogs|All" --approved review/approved.json
```

---

# 1) Project structure

```
media-tagger/
  package.json
  tsconfig.json
  README.md
  src/
    apply.ts
    bin.ts
    cli.ts
    config.ts
    embed.ts
    exec.ts
    fsUtils.ts
    manifest.ts
    mediaDetect.ts
    profiles.ts
    progress.ts
    query.ts
    queryText.ts
    reps.ts
    review.ts
    reviewServer.ts
    similarity.ts
    topK.ts
    types.ts
    vectorStore.ts
    verify.ts
  profiles/
    subjects.json
    dogs.json
  data/
  derivatives/
    reps/
  review/
```

---

# 2) Code excerpts (see repo for current code)

Note: this document includes large code excerpts for explanation, but the repo is the source of truth. Newer additions include `query-text` (CLIP text prompt queries) and a shared `src/topK.ts` helper.

## `package.json`

```json
{
  "name": "media-tagger",
  "version": "0.4.0",
  "private": true,
  "type": "module",
  "bin": {
    "media-tagger": "./dist/bin.js"
  },
  "scripts": {
    "dev": "tsx src/bin.ts",
    "build": "tsc -p tsconfig.json",

    "scan": "tsx src/cli.ts scan",
    "reps": "tsx src/cli.ts reps",
    "embed": "tsx src/cli.ts embed",
    "query": "tsx src/cli.ts query",
    "query-text": "tsx src/cli.ts query-text",
    "tag-this": "tsx src/cli.ts tag-this",
    "review": "tsx src/cli.ts review",
    "review:serve": "tsx src/cli.ts review-serve",
    "apply": "tsx src/cli.ts apply",
    "status": "tsx src/cli.ts status",
    "verify": "tsx src/cli.ts verify",
    "test": "node --import tsx --test"
  },
  "dependencies": {
    "@xenova/transformers": "^2.17.2"
  },
  "devDependencies": {
    "@types/node": "^22.10.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.3"
  }
}
```

---

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"]
}
```

---

## `src/bin.ts`

```ts
#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv.slice(2)).catch((e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
});
```

---

## `src/types.ts`

```ts
export type MediaKind = "image" | "video";

export type Asset = Readonly<{
  id: string;
  absPath: string;
  relPath: string;
  ext: string;
  kind: MediaKind;
  repPath?: string;
}>;

export type Neighbor = Readonly<{
  id: string;
  score: number;
}>;

export type QueryRow = Readonly<
  Neighbor & {
    absPath: string;
    relPath: string;
  }
>;

export type TagProfile = Readonly<{
  name: string;
  tagTemplate: string; // e.g. "Subjects|{label}"
  queryDefaults: Readonly<{
    k: number;
    minScore: number;
  }>;
  autoTags?: ReadonlyArray<"year" | "camera" | "location">;
}>;
```

---

## `src/config.ts`

```ts
import path from "node:path";

export type AppConfig = Readonly<{
  photoLibRoot: string;
  dataDir: string;
  repsDir: string;
  reviewDir: string;
  profilesDir: string;
  maxFiles?: number;
  repMaxSizePx: number;
  videoFrameSecond: number;
}>;

export const getConfig = (): AppConfig => {
  const photoLibRoot = process.env.PHOTO_LIB ?? "/PATH/TO/LIBRARY";
  const projectRoot = process.cwd();

  return {
    photoLibRoot,
    dataDir: path.join(projectRoot, "data"),
    repsDir: path.join(projectRoot, "derivatives", "reps"),
    reviewDir: path.join(projectRoot, "review"),
    profilesDir: path.join(projectRoot, "profiles"),
    maxFiles: parseOptionalInt(process.env.MAX_FILES),
    repMaxSizePx: 768,
    videoFrameSecond: 3
  };
};

const parseOptionalInt = (v: string | undefined): number | undefined => {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
```

---

## `src/fsUtils.ts`

```ts
import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export const ensureDir = async (dir: string): Promise<void> => {
  await fs.mkdir(dir, { recursive: true });
};

export const fileExists = async (p: string): Promise<boolean> => {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
};

export const sha1 = (s: string): string =>
  crypto.createHash("sha1").update(s, "utf8").digest("hex");

export const toPosixRel = (rootAbs: string, abs: string): string =>
  path.relative(rootAbs, abs).split(path.sep).join("/");

export const writeJson = async <T>(p: string, value: T): Promise<void> => {
  await fs.writeFile(p, JSON.stringify(value, null, 2), "utf8");
};

export const readJson = async <T>(p: string): Promise<T> => {
  const raw = await fs.readFile(p, "utf8");
  return JSON.parse(raw) as T;
};

export const readText = async (p: string): Promise<string> => {
  return await fs.readFile(p, "utf8");
};

export const listFiles = async (dir: string): Promise<readonly string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(dir, e.name));
};
```

---

## `src/exec.ts`

```ts
import { spawn } from "node:child_process";

export type ExecResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

export const exec = async (cmd: string, args: readonly string[]): Promise<ExecResult> =>
  await new Promise<ExecResult>((resolve) => {
    const child = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    child.stdout.on("data", (b: Buffer) => outChunks.push(b));
    child.stderr.on("data", (b: Buffer) => errChunks.push(b));

    child.on("close", (code) => {
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout: Buffer.concat(outChunks).toString("utf8"),
        stderr: Buffer.concat(errChunks).toString("utf8")
      });
    });
  });
```

---

## `src/mediaDetect.ts`

```ts
import path from "node:path";
import { MediaKind } from "./types.js";

const imageExts = new Set([
  "jpg", "jpeg", "png", "heic", "tif", "tiff", "gif", "bmp", "webp", "psd"
]);

const videoExts = new Set([
  "mov", "mp4", "m4v", "avi", "mkv", "mts"
]);

export const detectKind = (absPath: string): MediaKind | undefined => {
  const ext = path.extname(absPath).toLowerCase().replace(".", "");
  if (imageExts.has(ext)) return "image";
  if (videoExts.has(ext)) return "video";
  return undefined;
};
```

---

## `src/manifest.ts`

```ts
import fs from "node:fs/promises";
import path from "node:path";

export const manifestPath = (dataDir: string): string => path.join(dataDir, "assets.json");

export const walkFiles = async (root: string): Promise<readonly string[]> => {
  const out: string[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(abs);
      else if (e.isFile()) out.push(abs);
    }
  }

  return out;
};
```

---

## `src/progress.ts`

```ts
import path from "node:path";
import { AppConfig } from "./config.js";
import { fileExists, readJson, writeJson } from "./fsUtils.js";

export type Progress = Readonly<{
  repsDone: Readonly<Record<string, true>>;
  embedsDone: Readonly<Record<string, true>>;
}>;

export const loadProgress = async (cfg: AppConfig): Promise<Progress> => {
  const p = path.join(cfg.dataDir, "progress.json");
  if (!(await fileExists(p))) return { repsDone: {}, embedsDone: {} };
  return await readJson<Progress>(p);
};

export const saveProgress = async (cfg: AppConfig, prog: Progress): Promise<void> => {
  const p = path.join(cfg.dataDir, "progress.json");
  await writeJson(p, prog);
};

export const markRepDone = (prog: Progress, id: string): Progress => ({
  ...prog,
  repsDone: { ...prog.repsDone, [id]: true }
});

export const markEmbedDone = (prog: Progress, id: string): Progress => ({
  ...prog,
  embedsDone: { ...prog.embedsDone, [id]: true }
});
```

---

## `src/reps.ts`

```ts
import path from "node:path";
import { Asset } from "./types.js";
import { AppConfig } from "./config.js";
import { ensureDir, fileExists, readJson, writeJson } from "./fsUtils.js";
import { exec } from "./exec.js";
import { loadProgress, markRepDone, saveProgress } from "./progress.js";

export const generateRepresentatives = async (cfg: AppConfig): Promise<readonly Asset[]> => {
  const assetsPath = path.join(cfg.dataDir, "assets.json");
  const assets = await readJson<readonly Asset[]>(assetsPath);

  await ensureDir(cfg.repsDir);
  let prog = await loadProgress(cfg);

  const updated: Asset[] = [];

  for (const a of assets) {
    const repPath = path.join(cfg.repsDir, `${a.id}.jpg`);

    const already = prog.repsDone[a.id] === true;
    const exists = await fileExists(repPath);

    if (!already || !exists) {
      const ok = await makeRep(cfg, a.absPath, a.kind, repPath);
      if (ok) prog = markRepDone(prog, a.id);
    }

    updated.push((await fileExists(repPath)) ? { ...a, repPath } : a);
  }

  await writeJson(assetsPath, updated);
  await saveProgress(cfg, prog);
  return updated;
};

const makeRep = async (
  cfg: AppConfig,
  input: string,
  kind: "image" | "video",
  outputJpg: string
): Promise<boolean> => {
  const common = ["-y", "-hide_banner", "-loglevel", "error"];

  const args =
    kind === "video"
      ? [
          ...common,
          "-ss",
          `${cfg.videoFrameSecond}`,
          "-i",
          input,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          outputJpg
        ]
      : [
          ...common,
          "-i",
          input,
          "-vf",
          `scale='if(gt(iw,ih),${cfg.repMaxSizePx},-2)':'if(gt(iw,ih),-2,${cfg.repMaxSizePx})'`,
          "-frames:v",
          "1",
          "-q:v",
          "2",
          outputJpg
        ];

  const r = await exec("ffmpeg", args);
  return r.code === 0;
};
```

---

## `src/similarity.ts`

```ts
export const l2Norm = (a: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s);
};

export const normalize = (a: readonly number[]): readonly number[] => {
  const n = l2Norm(a);
  if (n === 0) return a.slice();
  return a.map((x) => x / n);
};

export const dot = (a: readonly number[], b: readonly number[]): number => {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
};
```

---

## `src/vectorStore.ts`

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileExists, readJson, writeJson } from "./fsUtils.js";

export type VectorMeta = Readonly<{
  dim: number;
  count: number;
}>;

export type VectorIndex = Readonly<{
  idToOffset: Readonly<Record<string, number>>;
}>;

export type VectorStorePaths = Readonly<{
  binPath: string;
  indexPath: string;
  metaPath: string;
}>;

export const getVectorStorePaths = (dataDir: string): VectorStorePaths => ({
  binPath: path.join(dataDir, "embeddings.f32"),
  indexPath: path.join(dataDir, "embeddings.index.json"),
  metaPath: path.join(dataDir, "embeddings.meta.json")
});

export const loadVectorMeta = async (paths: VectorStorePaths): Promise<VectorMeta | null> => {
  if (!(await fileExists(paths.metaPath))) return null;
  return await readJson<VectorMeta>(paths.metaPath);
};

export const loadVectorIndex = async (paths: VectorStorePaths): Promise<VectorIndex> => {
  if (!(await fileExists(paths.indexPath))) return { idToOffset: {} };
  return await readJson<VectorIndex>(paths.indexPath);
};

export const saveVectorIndex = async (paths: VectorStorePaths, idx: VectorIndex): Promise<void> => {
  await writeJson(paths.indexPath, idx);
};

export const saveVectorMeta = async (paths: VectorStorePaths, meta: VectorMeta): Promise<void> => {
  await writeJson(paths.metaPath, meta);
};

export const appendVector = async (
  paths: VectorStorePaths,
  id: string,
  vec: readonly number[],
  expectedDim?: number
): Promise<void> => {
  const idx = await loadVectorIndex(paths);
  if (typeof idx.idToOffset[id] === "number") return;

  const meta = await loadVectorMeta(paths);
  const dim = expectedDim ?? meta?.dim ?? vec.length;

  if (vec.length !== dim) {
    throw new Error(`Vector dim mismatch for ${id}: got ${vec.length}, expected ${dim}`);
  }

  await ensureBinExists(paths.binPath);

  const offset = meta?.count ?? 0;
  const nextCount = offset + 1;

  const f32 = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) f32[i] = vec[i] ?? 0;

  await fs.appendFile(paths.binPath, Buffer.from(f32.buffer));

  const nextIdx: VectorIndex = { idToOffset: { ...idx.idToOffset, [id]: offset } };
  const nextMeta: VectorMeta = { dim, count: nextCount };

  await saveVectorIndex(paths, nextIdx);
  await saveVectorMeta(paths, nextMeta);
};

export const streamAllVectors = async (
  paths: VectorStorePaths,
  dim: number,
  onVector: (offset: number, vec: Float32Array) => void | Promise<void>
): Promise<void> => {
  const handle = await fs.open(paths.binPath, "r");
  try {
    const stat = await handle.stat();
    const bytes = stat.size;

    const vecBytes = dim * 4;
    if (vecBytes <= 0) throw new Error("Invalid dim for streamAllVectors");

    const count = Math.floor(bytes / vecBytes);
    const buf = Buffer.allocUnsafe(vecBytes);

    for (let offset = 0; offset < count; offset += 1) {
      const pos = offset * vecBytes;
      await handle.read(buf, 0, vecBytes, pos);

      const arrBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      await onVector(offset, new Float32Array(arrBuf));
    }
  } finally {
    await handle.close();
  }
};

const ensureBinExists = async (binPath: string): Promise<void> => {
  if (await fileExists(binPath)) return;
  await fs.writeFile(binPath, Buffer.alloc(0));
};
```

---

## `src/embed.ts`

```ts
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { AppConfig } from "./config.js";
import { Asset } from "./types.js";
import { readJson } from "./fsUtils.js";
import { loadProgress, markEmbedDone, saveProgress } from "./progress.js";
import { appendVector, getVectorStorePaths, loadVectorIndex, loadVectorMeta } from "./vectorStore.js";

type Extractor = (input: string, opts?: Record<string, unknown>) => Promise<unknown>;

export const computeEmbeddings = async (cfg: AppConfig): Promise<void> => {
  const assets = await readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"));
  const reps = assets.filter((a) => typeof a.repPath === "string") as readonly (Asset & { repPath: string })[];

  const store = getVectorStorePaths(cfg.dataDir);
  const existingIdx = await loadVectorIndex(store);
  const existingMeta = await loadVectorMeta(store);

  let prog = await loadProgress(cfg);

  const extractor = (await pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")) as Extractor;

  for (const r of reps) {
    const already =
      prog.embedsDone[r.id] === true || typeof existingIdx.idToOffset[r.id] === "number";
    if (already) continue;

    const vec = await embedOne(extractor, r.repPath);
    const dim = existingMeta?.dim ?? vec.length;

    await appendVector(store, r.id, vec, dim);
    prog = markEmbedDone(prog, r.id);
  }

  await saveProgress(cfg, prog);
};

const embedOne = async (extractor: Extractor, imagePath: string): Promise<readonly number[]> => {
  const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
  return extractVector(raw);
};

const extractVector = (raw: unknown): readonly number[] => {
  if (typeof raw !== "object" || raw === null) throw new Error("Unexpected embedding output (non-object).");
  const rec = raw as Record<string, unknown>;
  const data = rec["data"];

  if (data instanceof Float32Array) return Array.from(data);
  if (Array.isArray(data) && data.every((n) => typeof n === "number")) return data as number[];

  if (Array.isArray(raw) && raw.every((n) => typeof n === "number")) return raw as number[];

  throw new Error("Unexpected embedding output structure. Paste error + your @xenova/transformers version.");
};
```

---

## `src/query.ts`

```ts
import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { AppConfig } from "./config.js";
import { Asset, QueryRow } from "./types.js";
import { readJson, writeJson } from "./fsUtils.js";
import { getVectorStorePaths, loadVectorIndex, loadVectorMeta, streamAllVectors } from "./vectorStore.js";
import { dot, normalize } from "./similarity.js";

type Extractor = (input: string, opts?: Record<string, unknown>) => Promise<unknown>;
type TopItem = Readonly<{ offset: number; score: number }>;

export const querySimilarMulti = async (
  cfg: AppConfig,
  anchorPaths: readonly string[],
  k: number,
  minScore: number,
  outFileName: string
): Promise<readonly QueryRow[]> => {
  if (anchorPaths.length === 0) throw new Error("Provide at least one anchor.");

  const assets = await readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"));
  const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));

  const store = getVectorStorePaths(cfg.dataDir);
  const meta = await loadVectorMeta(store);
  if (!meta) throw new Error("Vector store meta not found. Run embed first.");

  const idx = await loadVectorIndex(store);
  const offsetToId = invertIndex(idx.idToOffset);

  const extractor = (await pipeline("feature-extraction", "Xenova/clip-vit-base-patch32")) as Extractor;
  const anchorVecs = await Promise.all(anchorPaths.map(async (p) => normalize(await embedAnchor(extractor, p))));

  const top = createTopK(k);

  await streamAllVectors(store, meta.dim, async (offset, vec) => {
    const id = offsetToId.get(offset);
    if (!id) return;

    const v = normalize(Array.from(vec));

    let best = -1;
    for (const a of anchorVecs) {
      const s = dot(a, v);
      if (s > best) best = s;
    }

    if (best < minScore) return;
    top.offer({ offset, score: best });
  });

  const best = top.valuesSortedDesc();

  const rows: QueryRow[] = best
    .map((b) => {
      const id = offsetToId.get(b.offset);
      if (!id) return undefined;
      const a = idToAsset.get(id);
      if (!a) return undefined;
      return { id, score: b.score, absPath: a.absPath, relPath: a.relPath };
    })
    .filter((x): x is QueryRow => typeof x !== "undefined");

  await writeJson(path.join(cfg.dataDir, outFileName), rows);
  await writeJson(path.join(cfg.dataDir, "last_query.json"), rows);

  return rows;
};

const embedAnchor = async (extractor: Extractor, imagePath: string): Promise<readonly number[]> => {
  const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
  if (typeof raw !== "object" || raw === null) throw new Error("Unexpected anchor embedding output.");
  const rec = raw as Record<string, unknown>;
  const data = rec["data"];
  if (data instanceof Float32Array) return Array.from(data);
  if (Array.isArray(data) && data.every((n) => typeof n === "number")) return data as number[];
  throw new Error("Unexpected anchor embedding output structure.");
};

const invertIndex = (idToOffset: Readonly<Record<string, number>>): ReadonlyMap<number, string> => {
  const m = new Map<number, string>();
  for (const [id, off] of Object.entries(idToOffset)) m.set(off, id);
  return m;
};

const createTopK = (k: number) => {
  const cap = Math.max(1, Math.floor(k));
  let items: TopItem[] = [];

  const offer = (x: TopItem): void => {
    if (items.length < cap) {
      items = [...items, x];
      if (items.length === cap) items = items.slice().sort((a, b) => a.score - b.score);
      return;
    }

    const min = items[0];
    if (!min) return;
    if (x.score <= min.score) return;

    const rest = items.slice(1);
    const next = insertSortedAsc(rest, x);
    items = next.length > cap ? next.slice(next.length - cap) : next;
  };

  const valuesSortedDesc = (): readonly TopItem[] =>
    items.slice().sort((a, b) => b.score - a.score);

  return { offer, valuesSortedDesc };
};

const insertSortedAsc = (arr: readonly TopItem[], x: TopItem): TopItem[] => {
  const out: TopItem[] = [];
  let inserted = false;

  for (const it of arr) {
    if (!inserted && x.score <= it.score) {
      out.push(x);
      inserted = true;
    }
    out.push(it);
  }

  if (!inserted) out.push(x);
  return out;
};
```

---

## `src/review.ts` ✅ (UPDATED for Apply + auto-apply)

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { Asset, QueryRow } from "./types.js";
import { ensureDir, readJson } from "./fsUtils.js";

export type ReviewOptions = Readonly<{
  autoApplyAfterSave: boolean;
}>;

export const generateReviewHtml = async (cfg: AppConfig, opts: ReviewOptions): Promise<string> => {
  const rows = await readJson<readonly QueryRow[]>(path.join(cfg.dataDir, "last_query.json"));
  const assets = await readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"));

  const idToRep = new Map<string, string>(
    assets
      .filter((a) => typeof a.repPath === "string")
      .map((a) => [a.id, a.repPath as string])
  );

  await ensureDir(cfg.reviewDir);

  const html = buildHtml(rows, idToRep, opts);
  const outPath = path.join(cfg.reviewDir, "review.html");
  await fs.writeFile(outPath, html, "utf8");
  return outPath;
};

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const buildHtml = (
  rows: readonly QueryRow[],
  idToRep: ReadonlyMap<string, string>,
  opts: ReviewOptions
): string => {
  const cards = rows
    .map((r, i) => {
      const rep = idToRep.get(r.id);
      const repSrc = rep ? `file://${rep}` : "";
      const checked = i < 120 ? "checked" : "";
      return `
      <div class="card">
        <label class="row">
          <input type="checkbox" data-id="${escapeHtml(r.id)}" ${checked} />
          <span class="score">score: ${r.score.toFixed(4)}</span>
        </label>
        <div class="path">${escapeHtml(r.relPath)}</div>
        ${rep ? `<img src="${repSrc}" />` : `<div class="missing">No representative image</div>`}
      </div>`;
    })
    .join("\n");

  const autoApply = opts.autoApplyAfterSave ? "true" : "false";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>media-tagger review</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }
    .card { border: 1px solid #ddd; border-radius: 10px; padding: 10px; }
    img { width: 100%; height: auto; border-radius: 8px; margin-top: 8px; }
    .path { font-size: 12px; color: #444; margin-top: 6px; word-break: break-all; }
    .score { margin-left: 8px; font-size: 12px; color: #111; }
    .topbar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; position: sticky; top: 0; background: white; padding: 10px 0; z-index: 10; flex-wrap: wrap; }
    button { padding: 8px 12px; border-radius: 10px; border: 1px solid #ccc; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: default; }
    .status { font-size: 12px; color: #333; }
    .pill { font-size: 12px; padding: 4px 8px; border: 1px solid #ddd; border-radius: 999px; }
  </style>
</head>
<body>
  <div class="topbar">
    <button id="save">Save approvals</button>
    <button id="apply" disabled>Apply tags</button>
    <button id="selectAll">Select all</button>
    <button id="selectNone">Select none</button>
    <span class="pill" id="mode"></span>
    <span id="status" class="status"></span>
  </div>

  <div class="grid">${cards}</div>

  <script type="module">
    const AUTO_APPLY_AFTER_SAVE = ${autoApply};

    const qs = (sel) => document.querySelector(sel);

    const setStatus = (msg) => {
      const el = qs("#status");
      if (el) el.textContent = msg;
    };

    const setMode = () => {
      const el = qs("#mode");
      if (!el) return;
      el.textContent = AUTO_APPLY_AFTER_SAVE ? "Mode: Save → Auto-Apply" : "Mode: Save → Apply manually";
    };

    const getApproved = () => {
      const checks = Array.from(document.querySelectorAll("input[type=checkbox]"));
      return checks
        .filter((c) => c.checked)
        .map((c) => c.getAttribute("data-id"))
        .filter((x) => typeof x === "string");
    };

    const saveApprovals = async () => {
      const approved = getApproved();
      setStatus(\`Saving \${approved.length} approvals…\`);

      const res = await fetch("/api/approved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved })
      });

      if (!res.ok) {
        const txt = await res.text();
        setStatus("Save failed: " + txt);
        return { ok: false, count: 0 };
      }

      const json = await res.json();
      setStatus(\`Saved: \${json.count} approvals\`);
      qs("#apply")?.removeAttribute("disabled");
      return { ok: true, count: json.count ?? 0 };
    };

    const applyTags = async () => {
      setStatus("Applying tags via server… (this can take a while)");
      qs("#apply")?.setAttribute("disabled", "true");

      const res = await fetch("/api/apply", { method: "POST" });

      if (!res.ok) {
        const txt = await res.text();
        setStatus("Apply failed: " + txt);
        qs("#apply")?.removeAttribute("disabled");
        return;
      }

      const json = await res.json();
      setStatus(\`Applied: \${json.applied ?? 0} files (see sidecar .xmp files)\`);
    };

    qs("#selectAll")?.addEventListener("click", () => {
      document.querySelectorAll("input[type=checkbox]").forEach((c) => c.checked = true);
      setStatus("Selected all");
    });

    qs("#selectNone")?.addEventListener("click", () => {
      document.querySelectorAll("input[type=checkbox]").forEach((c) => c.checked = false);
      setStatus("Selected none");
    });

    qs("#save")?.addEventListener("click", async () => {
      const s = await saveApprovals();
      if (s.ok && AUTO_APPLY_AFTER_SAVE) await applyTags();
    });

    qs("#apply")?.addEventListener("click", async () => {
      await applyTags();
    });

    // boot
    setMode();

    fetch("/api/approved").then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      if (j && Array.isArray(j.approved)) {
        setStatus(\`Existing approvals: \${j.approved.length}\`);
        qs("#apply")?.removeAttribute("disabled");
      }
    }).catch(() => {});
  </script>
</body>
</html>`;
};
```

---

## `src/reviewServer.ts` ✅ (UPDATED: new `/api/apply` endpoint)

```ts
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { applyTagsViaSidecars } from "./apply.js";
import { fileExists } from "./fsUtils.js";

export type ReviewServer = Readonly<{ close: () => Promise<void>; url: string }>;

export type ReviewServerOptions = Readonly<{
  approvedPath: string;
  // If provided, /api/apply becomes active
  apply?: Readonly<{
    baseTag: string;
    autoTags: readonly ("year" | "camera" | "location")[];
  }>;
}>;

export const startReviewServer = async (
  cfg: AppConfig,
  port: number,
  opts: ReviewServerOptions
): Promise<ReviewServer> => {
  const reviewHtmlPath = path.join(cfg.reviewDir, "review.html");
  const approvedPath = opts.approvedPath;

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && (url === "/" || url.startsWith("/review.html"))) {
      const html = await fs.readFile(reviewHtmlPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (method === "POST" && url === "/api/approved") {
      const body = await readBody(req);
      const parsed = safeJson(body);
      const approved = validateApproved(parsed);

      await fs.writeFile(approvedPath, JSON.stringify({ approved }, null, 2), "utf8");

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, count: approved.length }));
      return;
    }

    if (method === "GET" && url === "/api/approved") {
      try {
        const raw = await fs.readFile(approvedPath, "utf8");
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(raw);
      } catch {
        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "approved.json not found" }));
      }
      return;
    }

    if (method === "POST" && url === "/api/apply") {
      if (!opts.apply) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Apply is not enabled for this server session.");
        return;
      }

      if (!(await fileExists(approvedPath))) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("approved.json not found. Click 'Save approvals' first.");
        return;
      }

      const before = await readApprovedCount(approvedPath);

      await applyTagsViaSidecars(cfg, approvedPath, opts.apply.baseTag, opts.apply.autoTags);

      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, applied: before }));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const url = `http://localhost:${port}/review.html`;

  return {
    url,
    close: async () =>
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
};

const readBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

const validateApproved = (v: unknown): readonly string[] => {
  if (typeof v !== "object" || v === null) throw new Error("Invalid JSON payload.");
  const rec = v as Record<string, unknown>;
  const approved = rec["approved"];
  if (!Array.isArray(approved)) throw new Error("Payload must be { approved: string[] }.");
  if (!approved.every((x) => typeof x === "string")) throw new Error("approved must be string[].");
  return approved;
};

const readApprovedCount = async (approvedPath: string): Promise<number> => {
  const raw = await fs.readFile(approvedPath, "utf8");
  const parsed = safeJson(raw);
  if (typeof parsed !== "object" || parsed === null) return 0;
  const rec = parsed as Record<string, unknown>;
  const a = rec["approved"];
  if (!Array.isArray(a)) return 0;
  return a.length;
};
```

---

## `src/profiles.ts`

```ts
import path from "node:path";
import { AppConfig } from "./config.js";
import { TagProfile } from "./types.js";
import { fileExists, listFiles, readJson } from "./fsUtils.js";

export const loadProfile = async (cfg: AppConfig, profilePathOrName: string): Promise<TagProfile> => {
  if (profilePathOrName.endsWith(".json")) {
    const abs = path.isAbsolute(profilePathOrName)
      ? profilePathOrName
      : path.join(process.cwd(), profilePathOrName);

    if (!(await fileExists(abs))) throw new Error(`Profile not found: ${abs}`);
    return validateProfile(await readJson<TagProfile>(abs));
  }

  const abs = path.join(cfg.profilesDir, `${profilePathOrName}.json`);
  if (!(await fileExists(abs))) throw new Error(`Profile not found: ${abs}`);
  return validateProfile(await readJson<TagProfile>(abs));
};

export const listProfiles = async (cfg: AppConfig): Promise<readonly string[]> => {
  if (!(await fileExists(cfg.profilesDir))) return [];
  const files = await listFiles(cfg.profilesDir);
  return files
    .map((f) => path.basename(f))
    .filter((n) => n.toLowerCase().endsWith(".json"))
    .map((n) => n.replace(/\.json$/i, ""));
};

export const renderTag = (tpl: string, label: string): string => {
  return tpl.replaceAll("{label}", label.trim());
};

const validateProfile = (p: TagProfile): TagProfile => {
  if (!p || typeof p !== "object") throw new Error("Invalid profile: not an object.");
  if (typeof p.name !== "string" || p.name.trim() === "") throw new Error("Invalid profile: name.");
  if (typeof p.tagTemplate !== "string" || p.tagTemplate.trim() === "") throw new Error("Invalid profile: tagTemplate.");
  if (!p.queryDefaults || typeof p.queryDefaults !== "object") throw new Error("Invalid profile: queryDefaults.");

  const k = p.queryDefaults.k;
  const minScore = p.queryDefaults.minScore;

  if (typeof k !== "number" || !Number.isFinite(k) || k <= 0) throw new Error("Invalid profile: queryDefaults.k");
  if (typeof minScore !== "number" || !Number.isFinite(minScore)) throw new Error("Invalid profile: queryDefaults.minScore");

  return p;
};
```

---

## `src/apply.ts`

```ts
import path from "node:path";
import fs from "node:fs/promises";
import { AppConfig } from "./config.js";
import { Asset, TagProfile } from "./types.js";
import { readJson } from "./fsUtils.js";
import { exec } from "./exec.js";

type ApprovedFile = Readonly<{ approved: readonly string[] }>;

export const applyTagsViaSidecars = async (
  cfg: AppConfig,
  approvedJsonPath: string,
  baseTag: string,
  autoTags: readonly ("year" | "camera" | "location")[]
): Promise<void> => {
  const assets = await readJson<readonly Asset[]>(path.join(cfg.dataDir, "assets.json"));
  const approved = await readApproved(approvedJsonPath);
  const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));

  for (const id of approved) {
    const a = idToAsset.get(id);
    if (!a) continue;

    const xmpPath = sidecarBasenamePath(a.absPath);

    const derived = await deriveAutoTags(a.absPath, autoTags);
    const tags = [baseTag, ...derived].filter((t) => t.trim() !== "");

    const subjectArgs = tags.flatMap((t) => [`-XMP:Subject+=${t}`]);

    const args = [
      "-overwrite_original",
      ...subjectArgs,
      "-o",
      xmpPath,
      a.absPath
    ];

    const r = await exec("exiftool", args);
    if (r.code !== 0) {
      // eslint-disable-next-line no-console
      console.error(`exiftool failed for: ${a.absPath}\n${r.stderr}`);
    }
  }
};

export const getProfileAutoTags = (profile: TagProfile): readonly ("year" | "camera" | "location")[] => {
  const a = profile.autoTags;
  if (!Array.isArray(a)) return [];
  const allowed = new Set<"year" | "camera" | "location">(["year", "camera", "location"]);
  return a.filter((x): x is "year" | "camera" | "location" => allowed.has(x));
};

const sidecarBasenamePath = (absMediaPath: string): string => {
  const dir = path.dirname(absMediaPath);
  const base = path.basename(absMediaPath, path.extname(absMediaPath));
  return path.join(dir, `${base}.xmp`);
};

const readApproved = async (p: string): Promise<readonly string[]> => {
  const raw = await fs.readFile(p, "utf8");
  const parsed = JSON.parse(raw) as ApprovedFile;

  if (!parsed || !Array.isArray(parsed.approved)) throw new Error(`Invalid approved.json format at ${p}`);
  if (!parsed.approved.every((x) => typeof x === "string")) throw new Error(`Invalid approved.json: approved must be string[]`);
  return parsed.approved;
};

type ExifMini = Readonly<{
  DateTimeOriginal?: string;
  CreateDate?: string;
  Model?: string;
  GPSLatitude?: string;
  GPSLongitude?: string;
  Country?: string;
  State?: string;
  City?: string;
}>;

const deriveAutoTags = async (
  absPath: string,
  autoTags: readonly ("year" | "camera" | "location")[]
): Promise<readonly string[]> => {
  if (autoTags.length === 0) return [];

  const wantYear = autoTags.includes("year");
  const wantCamera = autoTags.includes("camera");
  const wantLocation = autoTags.includes("location");

  const args = [
    "-j",
    "-n",
    "-DateTimeOriginal",
    "-CreateDate",
    "-Model",
    "-GPSLatitude",
    "-GPSLongitude",
    "-Country",
    "-State",
    "-City",
    absPath
  ];

  const r = await exec("exiftool", args);
  if (r.code !== 0) return [];

  const parsed = safeJson(r.stdout);
  const exif = pickFirstExif(parsed);

  const tags: string[] = [];

  if (wantYear) {
    const year = extractYear(exif.DateTimeOriginal ?? exif.CreateDate);
    if (typeof year === "string") tags.push(`Year|${year}`);
  }

  if (wantCamera) {
    if (typeof exif.Model === "string" && exif.Model.trim() !== "") {
      tags.push(`Camera|${exif.Model.trim()}`);
    }
  }

  if (wantLocation) {
    const loc = buildLocationTag(exif.Country, exif.State, exif.City);
    if (typeof loc === "string") tags.push(loc);
  }

  return tags;
};

const safeJson = (s: string): unknown => {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
};

const pickFirstExif = (v: unknown): ExifMini => {
  if (!Array.isArray(v) || v.length < 1) return {};
  const first = v[0];
  if (typeof first !== "object" || first === null) return {};
  return first as ExifMini;
};

const extractYear = (dt: string | undefined): string | undefined => {
  if (typeof dt !== "string") return undefined;
  const m = /^(\d{4})[:\-]/.exec(dt.trim());
  return m?.[1];
};

const buildLocationTag = (
  country: string | undefined,
  state: string | undefined,
  city: string | undefined
): string | undefined => {
  const parts = [country, state, city]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter((x) => x !== "");

  if (parts.length === 0) return undefined;
  return `Location|${parts.join("|")}`;
};
```

---

## `src/verify.ts`

```ts
import path from "node:path";
import { AppConfig } from "./config.js";
import { fileExists, readJson } from "./fsUtils.js";
import { Asset } from "./types.js";
import { getVectorStorePaths, loadVectorIndex, loadVectorMeta } from "./vectorStore.js";

export type VerifyLine = Readonly<{
  ok: boolean;
  label: string;
  detail?: string;
}>;

export const verify = async (cfg: AppConfig): Promise<readonly VerifyLine[]> => {
  const assetsPath = path.join(cfg.dataDir, "assets.json");
  const reviewHtml = path.join(cfg.reviewDir, "review.html");
  const approved = path.join(cfg.reviewDir, "approved.json");

  const store = getVectorStorePaths(cfg.dataDir);

  const assetsOk = await fileExists(assetsPath);
  const assets = assetsOk ? await readJson<readonly Asset[]>(assetsPath) : [];

  const repsCount = assets.filter((a) => typeof a.repPath === "string").length;

  const meta = await loadVectorMeta(store);
  const idx = await loadVectorIndex(store);

  const lines: VerifyLine[] = [
    { ok: true, label: "Config: PHOTO_LIB", detail: cfg.photoLibRoot },
    { ok: assetsOk, label: "Scan: data/assets.json exists", detail: assetsOk ? `${assets.length} assets` : undefined },
    { ok: repsCount > 0, label: "Reps: some rep JPGs recorded", detail: `${repsCount}/${assets.length}` },
    { ok: await fileExists(store.binPath), label: "Embeddings: data/embeddings.f32 exists" },
    { ok: await fileExists(store.indexPath), label: "Embeddings: data/embeddings.index.json exists" },
    { ok: await fileExists(store.metaPath), label: "Embeddings: data/embeddings.meta.json exists" },
    { ok: (meta?.count ?? 0) > 0, label: "Embeddings: meta.count > 0", detail: meta ? `dim=${meta.dim}, count=${meta.count}` : "missing meta" },
    { ok: Object.keys(idx.idToOffset).length > 0, label: "Embeddings: index has entries", detail: `${Object.keys(idx.idToOffset).length}` },
    { ok: await fileExists(reviewHtml), label: "Review: review/review.html exists" },
    { ok: await fileExists(approved), label: "Review: review/approved.json exists (after saving approvals)" }
  ];

  return lines;
};

export const formatVerify = (lines: readonly VerifyLine[]): string => {
  const icon = (ok: boolean): string => (ok ? "✅" : "❌");
  const rows = lines.map((l) => `${icon(l.ok)} ${l.label}${l.detail ? ` — ${l.detail}` : ""}`);
  return rows.join("\n");
};
```

---

## `src/cli.ts` ✅ (UPDATED: add `--apply` and wire server apply)

```ts
import path from "node:path";
import { getConfig } from "./config.js";
import { ensureDir, fileExists, readJson, sha1, toPosixRel, writeJson } from "./fsUtils.js";
import { walkFiles, manifestPath } from "./manifest.js";
import { detectKind } from "./mediaDetect.js";
import { generateRepresentatives } from "./reps.js";
import { computeEmbeddings } from "./embed.js";
import { querySimilarMulti } from "./query.js";
import { generateReviewHtml } from "./review.js";
import { startReviewServer } from "./reviewServer.js";
import { applyTagsViaSidecars, getProfileAutoTags } from "./apply.js";
import { loadProgress } from "./progress.js";
import { Asset } from "./types.js";
import { getVectorStorePaths, loadVectorMeta, loadVectorIndex } from "./vectorStore.js";
import { listProfiles, loadProfile, renderTag } from "./profiles.js";
import { verify, formatVerify } from "./verify.js";
import { exec } from "./exec.js";

export const runCli = async (argv: readonly string[]): Promise<void> => {
  const cfg = getConfig();

  await ensureDir(cfg.dataDir);
  await ensureDir(cfg.repsDir);
  await ensureDir(cfg.reviewDir);
  await ensureDir(cfg.profilesDir);

  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "scan": {
      const assets = await scan(cfg.photoLibRoot, cfg.maxFiles);
      await writeJson(manifestPath(cfg.dataDir), assets);
      console.log(`Scanned assets: ${assets.length}`);
      console.log(`Library root: ${cfg.photoLibRoot}`);
      break;
    }

    case "reps": {
      const assets = await generateRepresentatives(cfg);
      const withReps = assets.filter((a) => typeof a.repPath === "string").length;
      console.log(`Assets with reps: ${withReps}/${assets.length}`);
      break;
    }

    case "embed": {
      await computeEmbeddings(cfg);

      const store = getVectorStorePaths(cfg.dataDir);
      const meta = await loadVectorMeta(store);
      const idx = await loadVectorIndex(store);

      console.log(`Embeddings stored.`);
      console.log(`Meta: dim=${meta?.dim ?? 0}, count=${meta?.count ?? 0}`);
      console.log(`Index entries: ${Object.keys(idx.idToOffset).length}`);
      break;
    }

    case "query": {
      await cmdQuery(cfg, rest);
      break;
    }

    case "tag-this": {
      await cmdTagThis(cfg, rest);
      break;
    }

    case "review": {
      const outPath = await generateReviewHtml(cfg, { autoApplyAfterSave: false });
      console.log(`Review HTML written: ${outPath}`);
      console.log(`Run: media-tagger review-serve --port 8787`);
      break;
    }

    case "review-serve": {
      const args = parseArgs(rest);
      const portStr = args["--port"] ?? "8787";
      const port = Number(portStr);
      if (!Number.isFinite(port) || port <= 0) throw new Error("--port must be a positive number");

      if (!(await fileExists(path.join(cfg.reviewDir, "review.html")))) {
        throw new Error(`review/review.html not found. Run: media-tagger review`);
      }

      const approvedPath = path.join(cfg.reviewDir, "approved.json");
      const srv = await startReviewServer(cfg, port, { approvedPath });
      console.log(`Review server running: ${srv.url}`);
      console.log(`Saves approvals to: review/approved.json`);
      break;
    }

    case "apply": {
      const args = parseArgs(rest);

      const profileArg = args["--profile"];
      const labelArg = args["--label"];
      const approved = args["--approved"] ?? path.join(cfg.reviewDir, "approved.json");

      if (typeof profileArg === "string" && typeof labelArg === "string") {
        const profile = await loadProfile(cfg, profileArg.trim());
        const baseTag = renderTag(profile.tagTemplate, labelArg.trim());

        const auto = getProfileAutoTags(profile);
        await applyTagsViaSidecars(cfg, approved, baseTag, auto);

        console.log(`Applied tag "${baseTag}" using basename XMP sidecars.`);
        console.log(`Auto-tags: ${auto.length > 0 ? auto.join(", ") : "(none)"}`);
        break;
      }

      const tag = (args["--tag"] ?? "Subjects|Example").trim();
      if (tag === "") throw new Error(`--tag must be non-empty (or use --profile + --label)`);

      const autoTagsRaw = (args["--autoTags"] ?? "").trim();
      const autoTags = parseAutoTags(autoTagsRaw);

      await applyTagsViaSidecars(cfg, approved, tag, autoTags);
      console.log(`Applied tag "${tag}" using basename XMP sidecars.`);
      console.log(`Auto-tags: ${autoTags.length > 0 ? autoTags.join(", ") : "(none)"}`);
      break;
    }

    case "status": {
      const prog = await loadProgress(cfg);
      const assetsPath = manifestPath(cfg.dataDir);

      const assets = (await fileExists(assetsPath))
        ? await readJson<readonly Asset[]>(assetsPath)
        : [];

      const repsPresent = assets.filter((a) => typeof a.repPath === "string").length;

      const store = getVectorStorePaths(cfg.dataDir);
      const meta = await loadVectorMeta(store);
      const idx = await loadVectorIndex(store);

      console.log(`Library root: ${cfg.photoLibRoot}`);
      console.log(`Assets: ${assets.length}`);
      console.log(`Reps present: ${repsPresent}`);
      console.log(`Reps done (progress): ${Object.keys(prog.repsDone).length}`);
      console.log(`Embeddings meta count: ${meta?.count ?? 0}`);
      console.log(`Embeddings indexed ids: ${Object.keys(idx.idToOffset).length}`);
      console.log(`Embeddings done (progress): ${Object.keys(prog.embedsDone).length}`);
      break;
    }

    case "verify": {
      const lines = await verify(cfg);
      console.log(formatVerify(lines));
      const ok = lines.every((l) => l.ok);
      if (!ok) process.exit(2);
      break;
    }

    default: {
      const profiles = await listProfiles(cfg);
      console.log(`media-tagger

Commands:
  scan
  reps
  embed
  query --anchors "a|b|c" [--profile subjects --label "Teddy"] [--k N] [--minScore 0.25] [--out file.json]
  tag-this --anchors "a|b|c" --profile subjects --label "Teddy" [--port 8787] [--open] [--apply] [--k N] [--minScore 0.25]
  review
  review-serve --port 8787
  apply --profile subjects --label "Teddy" [--approved review/approved.json]
  apply --tag "Subjects|Teddy" [--autoTags year,camera,location]
  status
  verify

Environment:
  PHOTO_LIB=/PATH/TO/LIBRARY
  MAX_FILES=500 (optional)

Profiles in ./profiles:
  ${profiles.length > 0 ? profiles.join(", ") : "(none yet)"}
`);
    }
  }
};

const cmdQuery = async (cfg: ReturnType<typeof getConfig>, rest: readonly string[]): Promise<void> => {
  const args = parseArgs(rest);

  const anchorsRaw = args["--anchors"];
  const anchorRaw = args["--anchor"];
  const out = args["--out"] ?? "candidates.json";

  const profileArg = args["--profile"];
  const labelArg = args["--label"];

  const anchors = parseAnchors(anchorsRaw, anchorRaw);

  const profile =
    typeof profileArg === "string" && profileArg.trim() !== ""
      ? await loadProfile(cfg, profileArg.trim())
      : null;

  const kStr = args["--k"];
  const minScoreStr = args["--minScore"];

  const k = parseNumberOr(profile?.queryDefaults.k ?? 700, kStr);
  const minScore = parseNumberOr(profile?.queryDefaults.minScore ?? 0.0, minScoreStr);

  if (anchors.length === 0) {
    const available = await listProfiles(cfg);
    throw new Error(`Usage:
  media-tagger query --anchors "/path/a.jpg|/path/b.jpg" --profile subjects --label "Teddy"
OR
  media-tagger query --anchor "/path/a.jpg" --k 700 --minScore 0.25 --out "candidates.json"

Profiles available:
  ${(available.join(", ")) || "(none yet)"}
`);
  }

  if (profile && typeof labelArg === "string" && labelArg.trim() !== "") {
    const baseTag = renderTag(profile.tagTemplate, labelArg.trim());
    console.log(`Profile tag preview: ${baseTag}`);
    console.log(`Defaults: k=${profile.queryDefaults.k}, minScore=${profile.queryDefaults.minScore}`);
  }

  const results = await querySimilarMulti(cfg, anchors, k, minScore, out);
  console.log(`Wrote data/${out} with ${results.length} rows.`);
  console.log(`Also updated data/last_query.json`);
};

const cmdTagThis = async (cfg: ReturnType<typeof getConfig>, rest: readonly string[]): Promise<void> => {
  const args = parseArgs(rest);

  const anchorsRaw = args["--anchors"];
  const anchorRaw = args["--anchor"];
  const anchors = parseAnchors(anchorsRaw, anchorRaw);

  const profileArg = args["--profile"];
  const labelArg = args["--label"];
  const portStr = args["--port"] ?? "8787";
  const shouldOpen = args["--open"] === "true";
  const autoApplyAfterSave = args["--apply"] === "true";

  if (anchors.length === 0) throw new Error(`tag-this requires --anchors or --anchor`);
  if (typeof profileArg !== "string" || profileArg.trim() === "") throw new Error(`tag-this requires --profile`);
  if (typeof labelArg !== "string" || labelArg.trim() === "") throw new Error(`tag-this requires --label`);

  const profile = await loadProfile(cfg, profileArg.trim());

  const k = parseNumberOr(profile.queryDefaults.k, args["--k"]);
  const minScore = parseNumberOr(profile.queryDefaults.minScore, args["--minScore"]);

  const port = Number(portStr);
  if (!Number.isFinite(port) || port <= 0) throw new Error(`--port must be a positive number`);

  const out = args["--out"] ?? "candidates.json";
  const baseTag = renderTag(profile.tagTemplate, labelArg.trim());
  const autoTags = getProfileAutoTags(profile);

  console.log(`Tag: ${baseTag}`);
  console.log(`Auto-tags: ${autoTags.length > 0 ? autoTags.join(", ") : "(none)"}`);
  console.log(`Query: k=${k}, minScore=${minScore}`);
  console.log(`Writing: data/${out} + data/last_query.json`);

  await querySimilarMulti(cfg, anchors, k, minScore, out);

  const reviewPath = await generateReviewHtml(cfg, { autoApplyAfterSave });
  console.log(`Review HTML written: ${reviewPath}`);

  const approvedPath = path.join(cfg.reviewDir, "approved.json");

  const srv = await startReviewServer(cfg, port, {
    approvedPath,
    apply: { baseTag, autoTags }
  });

  console.log(`Review server running: ${srv.url}`);
  console.log(`Save approvals to: review/approved.json`);
  console.log(`Apply mode: ${autoApplyAfterSave ? "AUTO after Save" : "manual (click Apply tags)"}`);

  if (shouldOpen) {
    const r = await exec("open", [srv.url]);
    if (r.code !== 0) console.log(`Could not auto-open browser. Open manually: ${srv.url}`);
  }
};

const scan = async (root: string, maxFiles?: number): Promise<readonly Asset[]> => {
  const allFiles = await walkFiles(root);
  const assets: Asset[] = [];

  for (const absPath of allFiles) {
    const kind = detectKind(absPath);
    if (!kind) continue;

    const relPath = toPosixRel(root, absPath);
    const ext = relPath.split(".").pop()?.toLowerCase() ?? "";
    const id = sha1(relPath);

    assets.push({ id, absPath, relPath, ext, kind });

    if (typeof maxFiles === "number" && assets.length >= maxFiles) break;
  }

  return assets;
};

const parseArgs = (argv: readonly string[]): Readonly<Record<string, string | undefined>> => {
  const out: Record<string, string | undefined> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (!k || !k.startsWith("--")) continue;
    const v = argv[i + 1];
    if (typeof v === "string" && !v.startsWith("--")) out[k] = v;
    else out[k] = "true";
  }
  return out;
};

const parseAnchors = (anchorsRaw: string | undefined, anchorRaw: string | undefined): readonly string[] => {
  if (typeof anchorsRaw === "string" && anchorsRaw.trim() !== "") {
    return anchorsRaw.split("|").map((s) => s.trim()).filter((s) => s !== "");
  }
  if (typeof anchorRaw === "string" && anchorRaw.trim() !== "") return [anchorRaw.trim()];
  return [];
};

const parseNumberOr = (fallback: number, v: string | undefined): number => {
  if (typeof v !== "string" || v.trim() === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n;
};

const parseAutoTags = (csv: string): readonly ("year" | "camera" | "location")[] => {
  if (csv.trim() === "") return [];
  const parts = csv.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const allowed = new Set<"year" | "camera" | "location">(["year", "camera", "location"]);
  return parts.filter((p): p is "year" | "camera" | "location" =>
    allowed.has(p as "year" | "camera" | "location")
  );
};

// Allow running via `tsx src/cli.ts <cmd>` directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2)).catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(msg);
    process.exit(1);
  });
}
```

---

## `profiles/subjects.json`

```json
{
  "name": "subjects",
  "tagTemplate": "Subjects|{label}",
  "queryDefaults": {
    "k": 700,
    "minScore": 0.25
  },
  "autoTags": ["year", "camera", "location"]
}
```

## `profiles/dogs.json`

```json
{
  "name": "dogs",
  "tagTemplate": "Dogs|{label}",
  "queryDefaults": {
    "k": 700,
    "minScore": 0.25
  },
  "autoTags": ["year"]
}
```

---

## `README.md` ✅ (UPDATED with `--apply`)

```md
# media-tagger

Local-first pipeline to:
1) scan a folder of mixed photo/video formats,
2) create representative JPGs (thumbnails / video frames),
3) compute CLIP embeddings locally,
4) find “all media like this” (multi-anchor similarity search),
5) review matches in a lightweight browser UI,
6) write tags back to disk via **XMP sidecar files** (basename convention) for DAM ingest (e.g. Photo Supreme).

No Apple Photos. No Adobe.

---

## Requirements (macOS)

```bash
brew install ffmpeg exiftool
```

Node 18+ recommended.

---

## Setup

```bash
npm install
```

---

## Profiles / presets

Profiles live in `profiles/*.json`.

Example: `profiles/subjects.json`

- `tagTemplate`: e.g. `Subjects|{label}`
- `queryDefaults.k`: how many top results to keep
- `queryDefaults.minScore`: similarity cutoff
- `autoTags`: optional extras to add during apply: `year`, `camera`, `location`

---

## Quick Start (single command for review + apply)

Once scan/reps/embed are done:

```bash
export PHOTO_LIB="/PATH/TO/LIBRARY"

npm run tag-this -- \
  --anchors "/PATH/a.jpg|/PATH/b.jpg|/PATH/c.jpg" \
  --profile subjects \
  --label "Teddy" \
  --port 8787 \
  --open \
  --apply
```

In the browser:
- uncheck false positives
- click **Save approvals**
- it will auto-apply tags immediately

---

## Full pipeline (first time)

```bash
export PHOTO_LIB="/PATH/TO/LIBRARY"

npm run scan
npm run reps
npm run embed
npm run verify
```

---

## Verify

```bash
npm run verify
```

---

## Turn this into a real CLI (`media-tagger`)

Build:

```bash
npm run build
```

Link locally:

```bash
npm link
```

Now you can run:

```bash
media-tagger scan
media-tagger reps
media-tagger embed
media-tagger tag-this --anchors "/a.jpg|/b.jpg" --profile subjects --label "Teddy" --open --apply
```
```

---

# 3) Complete process again (end-to-end)

## A) One-time setup

```bash
brew install ffmpeg exiftool
mkdir -p ~/media-tagger
cd ~/media-tagger
npm install
mkdir -p profiles data derivatives/reps review
```

Create `profiles/subjects.json` and `profiles/dogs.json` (from above).

---

## B) Set your library path

```bash
export PHOTO_LIB="/PATH/TO/LIBRARY"
```

Optional “small test run”:

```bash
export MAX_FILES="500"
```

---

## C) First-time full library prep

```bash
npm run scan
npm run reps
npm run embed
npm run verify
```

---
## (Optional) D0) Pull “all dog photos” first

**Content (conceptual):**
- Run `media-tagger find-dogs --out dogs.json --minScore …`
- This produces `data/dogs.json` (a candidate set)
- Then `tag-this` uses `--scope dogs.json` (or similar) to limit search/review/apply

---
## D) Tag a subject (new best workflow: one command)

1) Choose 3–10 anchor photos of the dog (different lighting/angles)

2) Run:

```bash
npm run tag-this -- \
  --anchors "/PATH/TO/LIBRARY/teddy1.jpg|/PATH/TO/LIBRARY/teddy2.jpg|/PATH/TO/LIBRARY/teddy3.jpg" \
  --profile subjects \
  --label "Teddy" \
  --port 8787 \
  --open \
  --apply
```

3) In the browser:
- uncheck false positives
- click **Save approvals**
- it auto-applies and writes sidecar `.xmp` files next to the media

> [!NOTE] If you created a dog-only scope, pass `--scope data/dogs.json` so Teddy searches only the dog subset.
---

## E) Repeat for other labels

```bash
npm run tag-this -- --anchors "/.../luna1.jpg|/.../luna2.jpg" --profile subjects --label "Luna" --open --apply
```

---

# One practical note

Applying can take a while (50k files isn’t the issue; the number of *approved* files is). The UI will show “Applying…” and then “Applied: N files”.

---


  
