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

## Text prompt queries (prefilter)

`query-text` runs **zero-shot retrieval** with a CLIP text prompt. It does not train anything; it embeds your text into the same space as the stored image embeddings and ranks every asset by cosine similarity.

Example (dog prefilter):

```bash
media-tagger query-text --text "a photo of a dog" --k 2000 --minScore 0.22 --out dog_candidates.json
```

This writes:
- `data/dog_candidates.json`
- `data/last_query.json` (used by the review pipeline)

Recommended flow:

```bash
npm run query-text -- --text "a photo of a dog" --k 2000 --minScore 0.22 --out dog_candidates.json
npm run review
npm run review:serve -- --port 8787
# check/uncheck, then Save approvals
npm run apply -- --tag "Dogs|All" --approved review/approved.json
```

Notes:
- Run `scan` → `reps` → `embed` first; `query-text` needs the on-disk embeddings store.
- You can use any subject prompt (e.g. "a photo of a car", "a photo of a beach").
