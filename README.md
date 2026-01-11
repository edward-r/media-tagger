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
