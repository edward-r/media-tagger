import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { AppConfig } from "./config.js";
import { Asset, QueryRow } from "./types.js";
import { readJson, writeJson } from "./fsUtils.js";
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
type TopItem = Readonly<{ offset: number; score: number }>;

export const querySimilarMulti = async (
  cfg: AppConfig,
  anchorPaths: readonly string[],
  k: number,
  minScore: number,
  outFileName: string,
): Promise<readonly QueryRow[]> => {
  if (anchorPaths.length === 0) throw new Error("Provide at least one anchor.");

  const assets = await readJson<readonly Asset[]>(
    path.join(cfg.dataDir, "assets.json"),
  );
  const idToAsset = new Map<string, Asset>(assets.map((a) => [a.id, a]));

  const store = getVectorStorePaths(cfg.dataDir);
  const meta = await loadVectorMeta(store);
  if (!meta) throw new Error("Vector store meta not found. Run embed first.");

  const idx = await loadVectorIndex(store);
  const offsetToId = invertIndex(idx.idToOffset);

  const extractor = (await pipeline(
    "feature-extraction",
    "Xenova/clip-vit-base-patch32",
  )) as Extractor;
  const anchorVecs = await Promise.all(
    anchorPaths.map(async (p) => normalize(await embedAnchor(extractor, p))),
  );

  const top = createTopK<TopItem>(k, (x) => x.score);

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

const embedAnchor = async (
  extractor: Extractor,
  imagePath: string,
): Promise<readonly number[]> => {
  const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
  if (typeof raw !== "object" || raw === null)
    throw new Error("Unexpected anchor embedding output.");
  const rec = raw as Record<string, unknown>;
  const data = rec["data"];
  if (data instanceof Float32Array) return Array.from(data);
  if (Array.isArray(data) && data.every((n) => typeof n === "number"))
    return data as number[];
  throw new Error("Unexpected anchor embedding output structure.");
};

const invertIndex = (
  idToOffset: Readonly<Record<string, number>>,
): ReadonlyMap<number, string> => {
  const m = new Map<number, string>();
  for (const [id, off] of Object.entries(idToOffset)) m.set(off, id);
  return m;
};

