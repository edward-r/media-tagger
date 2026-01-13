import path from "node:path";
import { AppConfig } from "./config.js";
import { fileExists, readJson } from "./fsUtils.js";
import { Asset } from "./types.js";
import {
  getVectorStorePaths,
  loadVectorIndex,
  loadVectorMeta,
} from "./vectorStore.js";

export type VerifyLine = Readonly<{
  ok: boolean;
  label: string;
  detail?: string;
}>;

export const verify = async (
  cfg: AppConfig,
): Promise<readonly VerifyLine[]> => {
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
    assetsOk
      ? {
          ok: assetsOk,
          label: "Scan: data/assets.json exists",
          detail: `${assets.length} assets`,
        }
      : {
          ok: assetsOk,
          label: "Scan: data/assets.json exists",
        },
    {
      ok: repsCount > 0,
      label: "Reps: some rep JPGs recorded",
      detail: `${repsCount}/${assets.length}`,
    },
    {
      ok: await fileExists(store.binPath),
      label: "Embeddings: data/embeddings.f32 exists",
    },
    {
      ok: await fileExists(store.indexPath),
      label: "Embeddings: data/embeddings.index.json exists",
    },
    {
      ok: await fileExists(store.metaPath),
      label: "Embeddings: data/embeddings.meta.json exists",
    },
    {
      ok: (meta?.count ?? 0) > 0,
      label: "Embeddings: meta.count > 0",
      detail: meta ? `dim=${meta.dim}, count=${meta.count}` : "missing meta",
    },
    {
      ok: Object.keys(idx.idToOffset).length > 0,
      label: "Embeddings: index has entries",
      detail: `${Object.keys(idx.idToOffset).length}`,
    },
    {
      ok: await fileExists(reviewHtml),
      label: "Review: review/review.html exists",
    },
    {
      ok: await fileExists(approved),
      label: "Review: review/approved.json exists (after saving approvals)",
    },
  ];

  return lines;
};

export const formatVerify = (lines: readonly VerifyLine[]): string => {
  const icon = (ok: boolean): string => (ok ? "✅" : "❌");
  const rows = lines.map(
    (l) => `${icon(l.ok)} ${l.label}${l.detail ? ` — ${l.detail}` : ""}`,
  );
  return rows.join("\n");
};
