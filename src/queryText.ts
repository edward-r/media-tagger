import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { AppConfig } from "./config.js";
import { Asset, QueryRow } from "./types.js";
import { fileExists, readJson, writeJson } from "./fsUtils.js";
import {
  getVectorStorePaths,
  loadVectorIndex,
  loadVectorMeta,
  streamAllVectors,
} from "./vectorStore.js";
import { dot, normalize } from "./similarity.js";
import { createTopK } from "./topK.js";

type Extractor = (
  input: string,
  opts?: Record<string, unknown>,
) => Promise<unknown>;

type OffsetScore = Readonly<{ offset: number; score: number }>;

export const embedTextPrompt = async (
  text: string,
): Promise<readonly number[]> => {
  const extractor = (await pipeline(
    "feature-extraction",
    "Xenova/clip-vit-base-patch32",
  )) as Extractor;

  const raw = await extractor(text, { pooling: "mean", normalize: true });
  return extractVector(raw);
};

export const querySimilarText = async (
  cfg: AppConfig,
  text: string,
  k: number,
  minScore: number,
  outFileName: string,
): Promise<readonly QueryRow[]> => {
  const assetsPath = path.join(cfg.dataDir, "assets.json");
  if (!(await fileExists(assetsPath))) {
    throw new Error(
      "data/assets.json not found. Run: media-tagger scan (then reps, embed).",
    );
  }

  const assets = await readJson<readonly Asset[]>(assetsPath);
  const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));

  const store = getVectorStorePaths(cfg.dataDir);
  const meta = await loadVectorMeta(store);
  const idx = await loadVectorIndex(store);

  const storeOk =
    meta !== null &&
    meta.dim > 0 &&
    meta.count > 0 &&
    (await fileExists(store.binPath)) &&
    Object.keys(idx.idToOffset).length > 0;

  if (!storeOk) {
    throw new Error(
      "Embeddings store not found. Run: media-tagger scan && media-tagger reps && media-tagger embed",
    );
  }

  const offsetToId = invertIndex(idx.idToOffset);

  const textVecRaw = await embedTextPrompt(text);
  if (textVecRaw.length !== meta.dim) {
    throw new Error(
      `Text embedding dim mismatch: got ${textVecRaw.length}, expected ${meta.dim}.`,
    );
  }
  const textVec = normalize(textVecRaw);

  const top = createTopK<OffsetScore>(k, (x) => x.score);

  await streamAllVectors(store, meta.dim, async (offset, vec) => {
    const id = offsetToId.get(offset);
    if (!id) return;

    const v = normalize(Array.from(vec));
    const score = dot(textVec, v);
    if (score < minScore) return;

    top.offer({ offset, score });
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

const extractVector = (raw: unknown): readonly number[] => {
  if (typeof raw !== "object" || raw === null)
    throw new Error("Unexpected embedding output (non-object).");

  const rec = raw as Record<string, unknown>;
  const data = rec["data"];

  if (data instanceof Float32Array) return Array.from(data);
  if (isNumberArray(data)) return data;

  // Sometimes the pipeline returns nested arrays like [[...512 numbers...]]
  if (isNumberArray2d(data) && data.length === 1) {
    const first = data[0];
    if (first) return first;
  }

  if (isNumberArray(raw)) return raw;
  if (isNumberArray2d(raw) && raw.length === 1) {
    const first = raw[0];
    if (first) return first;
  }

  throw new Error(
    "Unexpected text embedding output structure. Paste error + your @xenova/transformers version.",
  );
};

const isNumberArray = (x: unknown): x is readonly number[] =>
  Array.isArray(x) && x.every((n) => typeof n === "number");

const isNumberArray2d = (x: unknown): x is readonly (readonly number[])[] =>
  Array.isArray(x) && x.every((row) => isNumberArray(row));

const invertIndex = (
  idToOffset: Readonly<Record<string, number>>,
): ReadonlyMap<number, string> => {
  const m = new Map<number, string>();
  for (const [id, off] of Object.entries(idToOffset)) m.set(off, id);
  return m;
};
