# media-tagger — Deep Operational Backgrounder  
*(For non-ML users, written from first principles)*

---

## 0. The Most Important Clarification (Read This First)

> **You are not training an ML model.**  
> You are **using a pretrained visual similarity engine**.

You do **not**:
- label thousands of images up front
- tune weights
- retrain anything
- need ML math knowledge

Instead, you are doing something much closer to:

> “Show me things that look like this, and I’ll confirm.”

That’s it.

Everything else exists to make that safe, repeatable, and durable.

---

## 1. What You Must Do Manually vs What Is Automatic

Let’s be very explicit.

### Things you **must** decide manually
- What conceptual category you are tagging (dogs, people, places, art references, etc.)
- What the label name is (“Teddy”, “Luna”, “Paris”, “Mom”, etc.)
- Which **example images** best represent that thing (anchors)
- Which results are correct (review step)

### Things the system does automatically
- File discovery
- Format normalization
- Feature extraction (embeddings)
- Similarity math
- Ranking
- Metadata writing

If you remember only one sentence:

> **You supply intent and judgment. The system supplies scale and recall.**

---

## 2. What a “Profile” Really Is (No ML Involved)

### Short version
A **profile** is just a **named preset** that answers:

> “When I tag something of this *kind*, what tag structure and defaults should I use?”

It is **not**:
- a model
- a classifier
- training data

It’s closer to:
- a config file
- a template
- a saved workflow

---

### Why profiles exist at all

Without profiles, every tagging session would require you to repeatedly specify:

- tag format
- similarity thresholds
- how many results to retrieve
- whether to auto-add year/camera/location tags

Profiles let you say:

> “When I’m tagging *subjects*, I want it done this way.”

---

## 3. Do You Need to Create Profiles by Hand?

### Yes — but they are **simple, small, and stable**

You typically create profiles **once**, early on, and then reuse them for months or years.

A profile is a **tiny JSON file** stored in:

```
profiles/
```

Example:

```
profiles/subjects.json
```

### Minimal example (this is enough to start)

```json
{
  "name": "subjects",
  "tagTemplate": "Subjects|{label}",
  "queryDefaults": {
    "k": 700,
    "minScore": 0.25
  },
  "autoTags": []
}
```

That’s it.

You do **not** need:
- multiple profiles
- perfect values
- tuning at the start

You can add more later.

---

## 4. What the Fields in a Profile Actually Mean

Let’s go line by line.

### `name`
```json
"name": "subjects"
```

- Used by the CLI: `--profile subjects`
- Should match the filename (`subjects.json`)
- Think of it as an identifier

---

### `tagTemplate`
```json
"tagTemplate": "Subjects|{label}"
```

This answers:

> “When I say the label is `Teddy`, what tag should be written?”

So:
- label = `"Teddy"`
- result = `"Subjects|Teddy"`

This is how hierarchical tags are constructed.

Examples:
- `"Dogs|{label}"`
- `"People|Family|{label}"`
- `"Places|{label}"`

---

### `queryDefaults.k`

```json
"k": 700
```

This means:

> “When searching, show me the **top 700 most similar items**.”

Why so high?
- Similarity search is *approximate*
- Recall is more important than precision
- You will prune manually

You can safely think of this as:

> “How wide do I cast the net?”

---

### `queryDefaults.minScore`

```json
"minScore": 0.25
```

This means:

> “Ignore anything that is *clearly unrelated*.”

This prevents:
- totally random images
- empty backgrounds
- extreme false positives

You do **not** need to tune this initially.

---

### `autoTags` (optional)

```json
"autoTags": ["year", "camera"]
```

If enabled, this tells the system:

> “Also add these metadata-derived tags automatically.”

Examples:
- `year` → `Year|2019`
- `camera` → `Camera|iPhone 12`
- `location` → GPS-based tags (if present)

You can ignore this entirely at first.

---

## 5. The Correct Mental Model for Using media-tagger

This is crucial.

### ❌ Wrong mental model
> “I’m building a classifier that must be correct.”

### ✅ Correct mental model
> “I’m building **candidate sets** that I confirm.”

media-tagger is **a recall engine + review loop**, not an oracle.

---

## 6. The Full End-to-End Workflow (With Rationale)

### Step 1 — Scan (inventory)

```bash
npm run scan
```

**What this does**
- Builds a catalog of *what exists*
- Does not modify your files

**You do this once** (unless files move)

---

### Step 2 — Representatives (normalization)

```bash
npm run reps
```

**Why this exists**
- ML models require consistent input
- Videos need a still frame
- Huge files need downsizing

This is like generating thumbnails — but for machines.

---

### Step 3 — Embeddings (feature extraction)

```bash
npm run embed
```

**What’s happening**
- Each representative image is passed through CLIP
- Output is a vector (list of numbers)
- Stored efficiently on disk

After this step:
> Your entire library has a **visual fingerprint**.

This step is slow — that’s normal.

---

## 7. Anchors: The Most Important User Input

### What an anchor is
An **anchor** is an example image that says:

> “This is what I mean.”

For dogs, anchors should:
- clearly show the dog
- cover different contexts
- include different ages if relevant

### How many anchors?
- Minimum: 1
- Good: 3–5
- Excellent: 5–8

More anchors = better recall.

---

## 7A. Optional: Text prompt prefilter (`query-text`)

If you want a broad candidate set without picking anchor images (for example: “show me dog photos”), you can run a text prompt query.

This is **zero-shot retrieval** (no training): the prompt is embedded into the same CLIP space and compared to every stored image embedding.

```bash
npm run query-text -- \
  --text "a photo of a dog" \
  --k 2000 \
  --minScore 0.22 \
  --out dog_candidates.json
```

Then use the existing review/apply steps (unchanged), because `query-text` writes `data/last_query.json`:

```bash
npm run review
npm run review:serve -- --port 8787
npm run apply -- --tag "Dogs|All" --approved review/approved.json
```

---

## 8. Querying: What Actually Happens

When you run:

```bash
npm run tag-this -- \
  --anchors "a.jpg|b.jpg|c.jpg" \
  --profile subjects \
  --label "Teddy"
```

The system does this internally:

1. Load embeddings for all assets
2. Embed each anchor image
3. For each asset:
   - compute similarity to each anchor
   - keep the **maximum similarity**
4. Sort by similarity
5. Keep top `k`
6. Write results to `data/last_query.json`
7. Generate review UI
8. Start server

Nothing is written to your photos yet.

---

## 9. Review: Why This Step Exists

The review UI exists because:

- ML is probabilistic
- Similar-looking things exist
- Your intent is subjective

During review you:
- visually inspect candidates
- uncheck false positives
- confirm true matches

This is **human judgment**, not ML.

---

## 10. Apply: What Happens When You Click “Apply”

When you apply tags:

- The system reads `approved.json`
- For each approved file:
  - reads existing XMP (if any)
  - adds the new hierarchical tag
  - writes a `.xmp` sidecar

Your original files are **never modified**.

---

## 11. Why This Is Safe and Reversible

Because:
- tags live in sidecars
- you can delete sidecars
- you can re-run tagging
- you can retag differently later

Nothing is destructive.

---

## 12. Common Beginner Questions (Answered Directly)

### “Do I have to do everything in one session?”
No. Sessions are resumable.

### “What if I pick bad anchors?”
You just get worse candidates — nothing breaks.

### “What if I mis-tag something?”
Uncheck it, or remove the tag later.

### “Is this replacing Photo Supreme?”
No. It **feeds** Photo Supreme.

### “Am I doing ML?”
You are **using** ML, not **doing** ML.

---

## 13. A Simple First-Time Checklist (Print This)

1. Create `profiles/subjects.json`
2. Run:
   ```bash
   scan → reps → embed
   ```
3. (Optional) Prefilter with `query-text` (example: dogs)
4. Pick 3–5 clear photos of one subject (anchors)
5. Run `tag-this`
6. Review results
7. Apply tags
8. Import into your DAM
9. Repeat for next subject

---

## 14. Final Reassurance

You are not behind.
You are not missing something obvious.
This *is* complex — but you now have:

- the right mental model
- the right safety rails
- the right workflow

Once you do this **one full time**, it will feel routine.

If you want next, I can:
- walk through a **concrete example** (fake paths, real commands)
- help you pick good default profile values
- or write a **“first run” script** that guides you step by step interactively

Just say the word.

