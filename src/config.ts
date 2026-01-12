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
    videoFrameSecond: 3,
  };
};

const parseOptionalInt = (v: string | undefined): number | undefined => {
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
