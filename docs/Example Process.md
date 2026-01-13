# Example Process

## Example: “Teddy vs Not Teddy” with a 20-file sample in `src1`

This walkthrough assumes:

- you have **~20 images/videos** in a folder named `src1`
- **5** are Teddy
- **5** are other dogs (some similar)
- **10** are unrelated
- you want a **concrete, repeatable demo run** using `media-tagger`

I’ll use placeholders where needed, but everything below is copy/paste-ready.

---

# 1) Prep: install required tools

You need these on macOS:

```bash
brew install ffmpeg exiftool
```

---

# 2) Pick your library root (this is important)

For this demo, we want `PHOTO_LIB` to be your **sample folder**, not your full library.

From your repo root:

```bash
export PHOTO_LIB="$(pwd)/src1"
```

Confirm:

```bash
echo "$PHOTO_LIB"
ls -la "$PHOTO_LIB"
```

---

# 3) Create a simple profile for the demo

Yes: profiles are created **by hand** (but only once). For this demo we’ll keep it minimal.

Create:

```bash
mkdir -p profiles
```

Create `profiles/dogs.json` with this content:

```json
{
  "name": "dogs",
  "tagTemplate": "Dogs|{label}",
  "queryDefaults": {
    "k": 200,
    "minScore": 0.20
  },
  "autoTags": []
}
```

Why these values for the demo:
- `k: 200` is “grab enough” (your sample is tiny anyway)
- `minScore: 0.20` is permissive so you can *see* false positives in a small set

---

# 4) Clean any previous demo outputs (optional but recommended)

This makes the demo easier to reason about:

```bash
rm -rf data review derivatives
mkdir -p data review derivatives/reps
```

---

# 5) Run the prep pipeline on the sample set

## 5.1 Scan

```bash
npm run scan
```

What to look for:
- “Scanned assets: 20” (or close)

If it scans fewer than expected, it’s because some file extensions aren’t in the allowlist yet.

## 5.2 Representatives

```bash
npm run reps
```

This generates representative JPGs in:

```bash
ls -la derivatives/reps | head
```

## 5.3 Embeddings

```bash
npm run embed
```

This writes:

- `data/embeddings.f32`
- `data/embeddings.index.json`
- `data/embeddings.meta.json`

## 5.4 Verify sanity

```bash
npm run verify
```

You want mostly ✅ for scan/reps/embeddings.

---

# 6) (Optional) Dog prefilter using a text prompt (`query-text`)

If you want to get a broad “dog candidates” set **without choosing dog anchors**, you can do a CLIP text prompt query first.

This is **zero-shot retrieval** (it does not train anything): the text prompt is embedded into the same CLIP space as the stored image embeddings and compared by cosine similarity.

```bash
npm run query-text -- \
  --text "a photo of a dog" \
  --k 2000 \
  --minScore 0.22 \
  --out dog_candidates.json

npm run review
npm run review:serve -- --port 8787
# check/uncheck in the UI, then click "Save approvals"

npm run apply -- --tag "Dogs|All" --approved review/approved.json
```

Notes:
- This writes both `data/dog_candidates.json` and `data/last_query.json`.
- You still review; the point is to reduce unrelated media early.

---

# 7) Choose 3 Teddy anchors from the 5 Teddy photos

You need the *actual filenames* for your Teddy images.

## Option A (fast): manually pick 3 files
Just choose 3 Teddy files in Finder and copy their paths.

## Option B (terminal): print the list and pick
```bash
ls -1 "$PHOTO_LIB"
```

Now choose 3 Teddy files you’re confident about. For example (replace these):

```bash
TEDDY1="$PHOTO_LIB/teddy_01.jpg"
TEDDY2="$PHOTO_LIB/teddy_02.jpg"
TEDDY3="$PHOTO_LIB/teddy_03.jpg"
```

Sanity check:

```bash
ls -la "$TEDDY1" "$TEDDY2" "$TEDDY3"
```

---

# 8) Run `tag-this` for Teddy

This is the “demo moment”.

```bash
npm run tag-this -- \
  --anchors "$TEDDY1|$TEDDY2|$TEDDY3" \
  --profile dogs \
  --label "Teddy" \
  --port 8787 \
  --open \
  --apply
```

What happens:
- it searches for images “like Teddy”
- it generates `review/review.html`
- it opens your browser to the review UI
- after you click **Save approvals**, it will auto-apply and write XMP sidecars

---

# 9) Use the review UI (what to do in the browser)

You will see the ranked results.

What you should do:
- Keep the true Teddy images checked
- Uncheck:
  - other dogs (even similar ones)
  - unrelated images

Then click:

✅ **Save approvals**

If you ran with `--apply`, it will automatically apply tags after saving.

---

# 10) Confirm that tags were written (the payoff)

Since we use **basename sidecars**, you should now see `.xmp` files next to approved items.

List sidecars:

```bash
find "$PHOTO_LIB" -maxdepth 1 -name "*.xmp" -print
```

Inspect one:

```bash
sed -n '1,120p' "$PHOTO_LIB/teddy_01.xmp"
```

You should see `Dogs|Teddy` in the XMP subjects/keywords area.

You can also ask exiftool directly:

```bash
exiftool -XMP:Subject "$PHOTO_LIB/teddy_01.xmp"
```

---

# 11) Validate behavior: did it accidentally tag non-Teddy?

Check subjects for all sidecars in the folder:

```bash
for f in "$PHOTO_LIB"/*.xmp; do
  echo "---- $f"
  exiftool -XMP:Subject "$f"
done
```

If you see a non-Teddy file tagged, that means it was checked during review (expected if you forgot to uncheck it).

This is *why review exists*.

---

# 12) What to learn from this demo (the point of the exercise)

If it finds Teddy reliably but includes some false positives:
- That’s normal and expected. You prune in review.

If it misses Teddy images:
- add more anchors (use all 5 Teddy images)
- lower `minScore` slightly (e.g. 0.15)
- ensure reps exist for those missed files

If it returns too many unrelated items:
- increase `minScore` (e.g. 0.25–0.30)
- choose better anchors (clear Teddy, not blurry or partial)
