import path from "node:path";
import { MediaKind } from "./types.js";

const imageExts = new Set([
  "jpg",
  "jpeg",
  "png",
  "heic",
  "tif",
  "tiff",
  "gif",
  "bmp",
  "webp",
  "psd",
]);

const videoExts = new Set(["mov", "mp4", "m4v", "avi", "mkv", "mts"]);

export const detectKind = (absPath: string): MediaKind | undefined => {
  const ext = path.extname(absPath).toLowerCase().replace(".", "");
  if (imageExts.has(ext)) return "image";
  if (videoExts.has(ext)) return "video";
  return undefined;
};
