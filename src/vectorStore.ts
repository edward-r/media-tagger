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
  metaPath: path.join(dataDir, "embeddings.meta.json"),
});

export const loadVectorMeta = async (
  paths: VectorStorePaths,
): Promise<VectorMeta | null> => {
  if (!(await fileExists(paths.metaPath))) return null;
  return await readJson<VectorMeta>(paths.metaPath);
};

export const loadVectorIndex = async (
  paths: VectorStorePaths,
): Promise<VectorIndex> => {
  if (!(await fileExists(paths.indexPath))) return { idToOffset: {} };
  return await readJson<VectorIndex>(paths.indexPath);
};

export const saveVectorIndex = async (
  paths: VectorStorePaths,
  idx: VectorIndex,
): Promise<void> => {
  await writeJson(paths.indexPath, idx);
};

export const saveVectorMeta = async (
  paths: VectorStorePaths,
  meta: VectorMeta,
): Promise<void> => {
  await writeJson(paths.metaPath, meta);
};

export const appendVector = async (
  paths: VectorStorePaths,
  id: string,
  vec: readonly number[],
  expectedDim?: number,
): Promise<void> => {
  const idx = await loadVectorIndex(paths);
  if (typeof idx.idToOffset[id] === "number") return;

  const meta = await loadVectorMeta(paths);
  const dim = expectedDim ?? meta?.dim ?? vec.length;

  if (vec.length !== dim) {
    throw new Error(
      `Vector dim mismatch for ${id}: got ${vec.length}, expected ${dim}`,
    );
  }

  await ensureBinExists(paths.binPath);

  const offset = meta?.count ?? 0;
  const nextCount = offset + 1;

  const f32 = new Float32Array(dim);
  for (let i = 0; i < dim; i += 1) f32[i] = vec[i] ?? 0;

  await fs.appendFile(paths.binPath, Buffer.from(f32.buffer));

  const nextIdx: VectorIndex = {
    idToOffset: { ...idx.idToOffset, [id]: offset },
  };
  const nextMeta: VectorMeta = { dim, count: nextCount };

  await saveVectorIndex(paths, nextIdx);
  await saveVectorMeta(paths, nextMeta);
};

export const streamAllVectors = async (
  paths: VectorStorePaths,
  dim: number,
  onVector: (offset: number, vec: Float32Array) => void | Promise<void>,
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

      const arrBuf = buf.buffer.slice(
        buf.byteOffset,
        buf.byteOffset + buf.byteLength,
      );
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
