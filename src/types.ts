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
