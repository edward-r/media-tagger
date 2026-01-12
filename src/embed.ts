import path from "node:path";
import { pipeline } from "@xenova/transformers";
import { AppConfig } from "./config.js";
import { Asset } from "./types.js";
import { readJson } from "./fsUtils.js";
import { loadProgress, markEmbedDone, saveProgress } from "./progress.js";
import {
  appendVector,
  getVectorStorePaths,
  loadVectorIndex,
  loadVectorMeta,
} from "./vectorStore.js";

type Extractor = (
  input: string,
  opts?: Record<string, unknown>,
) => Promise<unknown>;

export const computeEmbeddings = async (cfg: AppConfig): Promise<void> => {
  const assets = await readJson<readonly Asset[]>(
    path.join(cfg.dataDir, "assets.json"),
  );
  const reps = assets.filter(
    (a) => typeof a.repPath === "string",
  ) as readonly (Asset & { repPath: string })[];

  const store = getVectorStorePaths(cfg.dataDir);
  const existingIdx = await loadVectorIndex(store);
  const existingMeta = await loadVectorMeta(store);

  let prog = await loadProgress(cfg);

  const extractor = (await pipeline(
    "feature-extraction",
    "Xenova/clip-vit-base-patch32",
  )) as Extractor;

  for (const r of reps) {
    const already =
      prog.embedsDone[r.id] === true ||
      typeof existingIdx.idToOffset[r.id] === "number";
    if (already) continue;

    const vec = await embedOne(extractor, r.repPath);
    const dim = existingMeta?.dim ?? vec.length;

    await appendVector(store, r.id, vec, dim);
    prog = markEmbedDone(prog, r.id);
  }

  await saveProgress(cfg, prog);
};

const embedOne = async (
  extractor: Extractor,
  imagePath: string,
): Promise<readonly number[]> => {
  const raw = await extractor(imagePath, { pooling: "mean", normalize: true });
  return extractVector(raw);
};

const extractVector = (raw: unknown): readonly number[] => {
  if (typeof raw !== "object" || raw === null)
    throw new Error("Unexpected embedding output (non-object).");
  const rec = raw as Record<string, unknown>;
  const data = rec["data"];

  if (data instanceof Float32Array) return Array.from(data);
  if (Array.isArray(data) && data.every((n) => typeof n === "number"))
    return data as number[];

  if (Array.isArray(raw) && raw.every((n) => typeof n === "number"))
    return raw as number[];

  throw new Error(
    "Unexpected embedding output structure. Paste error + your @xenova/transformers version.",
  );
};
