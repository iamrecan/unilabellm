# UniLabelLM

**LLM-powered YOLO dataset unification and harmonization.** Combine multiple datasets with different label vocabularies into one clean, harmonized dataset — with visual review, multimodal validation, and smart label suggestions.

```
FPV drone dataset:  bmp, btr, kamaz, tank  ─┐
Military dataset:   person, vehicle         ─┤─ LLM ──→ armored-vehicle / truck / infantry / vehicle → unified YOLO
Aerial dataset:     car, truck, pedestrian  ─┘
```

---

## Features

### Dataset Harmonization
- **LLM semantic analysis** — Claude maps synonymous labels across datasets automatically (`bmp` + `btr` + `tank` → `armored-vehicle`)
- **Drag-and-drop review UI** — reassign aliases between canonical classes before confirming
- **Confidence indicators** — low-confidence LLM suggestions highlighted
- **Multi-source support** — add datasets incrementally to an existing session
- **YOLO & COCO input** — auto-detects format from directory structure
- **Stratified YOLO export** — produces `data.yaml` + train/val/test splits with configurable ratio
- **Near-duplicate detection** — pHash deduplication across sources at export time

### Visual Label Preview
- **Sample grid** — stratified sample of images per source with annotations overlaid in HUD style
- **Lightbox** — full-screen image view with zoom (scroll wheel) and pan (drag)
- **Keyboard shortcuts** — `←`/`→` navigate images, `E` edit labels, `V` validate, `D` detect, `Esc` close
- **Label editor** — add, move, resize, relabel bounding boxes in-browser and save back to the session

### Multimodal Validation
Three pluggable backends to verify label quality:

| Backend | Model | Speed (CPU) | Best for |
|---------|-------|-------------|----------|
| **OWL-ViT** *(default)* | `google/owlvit-base-patch32` ~92M | ~200ms/img | Detection-tuned; per-box crop scoring + open-vocabulary detection |
| **SigLIP** | `google/siglip-base-patch16-224` ~400MB | ~80ms/img | Drop-in CLIP replacement; sigmoid-based independent class scores |
| **CLIP** *(legacy)* | `openai/clip-vit-base-patch32` ~151M | ~60ms/img | Fast baseline; softmax image-text matching |

- **Batch validation** — score all sampled images in a session; progress bar + phase indicator
- **Per-image validation** — validate a single image from the lightbox (no batch run needed)
- **Suspicion detection** — flags images where the assigned label scores below threshold
- **Per-box score sidebar** — confidence bar per annotation, cross-highlighted on hover
- **Open-vocabulary detection** — suggest new bounding boxes from class names (OWL-ViT); client-side threshold slider filters results without re-running the model
- **IOU deduplication** — suggested boxes overlapping existing annotations are suppressed automatically

### Dataset Statistics
- **Class distribution** — full annotation counts per canonical class (scans all label files, not just samples)
- **Source breakdown** — images, labels, and avg annotations per image per source
- **Per-source class matrix** — see exactly which source contributes which classes (critical for spotting imbalance after harmonization)

### Bounding Box Quality Checks
Automatic rule-based checks on every annotation, visible as badges in the preview grid and banners in the lightbox:

| Check | Condition |
|-------|-----------|
| Too small | Box area < 0.4% of image |
| Too large | Box area > 88% of image |
| Extreme ratio | Aspect ratio > 7:1 |
| Edge clipped | Box touches image border (< 1.8% margin) |

### YOLO Inference
- **Single-image inference** — run any local YOLO model on an image path
- **Batch inference** — run on all images in a directory, results overlaid in the same HUD

---

## Quickstart

### 1. Clone & install

```bash
git clone https://github.com/your-org/unilabellm
cd unilabellm
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# Edit .env — set OPENROUTER_API_KEY (or ANTHROPIC_API_KEY)
```

### 2. Start the API

```bash
uvicorn api.main:app --reload --port 8000
```

### 3. Start the UI

```bash
cd ui
npm install
npm run dev   # → http://localhost:5173
```

The UI proxies API requests to `localhost:8000` via Vite's dev proxy.

---

## Typical Workflow

```
1. New Session
   └─ Select dataset folders (YOLO / COCO directories)
   └─ LLM analysis runs → canonical classes proposed

2. Review & Edit
   └─ Drag aliases between classes (e.g. move "btr" under "armored-vehicle")
   └─ Rename classes, add new ones, remove empties
   └─ Check Stats tab — class distribution, source breakdown

3. Validate Labels  (optional)
   └─ Run OWL-ViT / SigLIP validation on sampled images
   └─ Review suspicious images in filtered view
   └─ Per-image: Validate or Detect from lightbox

4. Preview & Fix
   └─ Open Label Preview → inspect sample images
   └─ Edit labels directly in browser
   └─ Accept / dismiss AI-suggested boxes

5. Confirm & Export
   └─ Confirm session (locks canonical mapping)
   └─ Set output path + train/val/test split ratio
   └─ Export → unified YOLO dataset with data.yaml
```

---

## API Reference

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions` | Create session + run LLM analysis |
| `GET` | `/sessions` | List all sessions |
| `GET` | `/sessions/{id}` | Get session detail |
| `PATCH` | `/sessions/{id}/classes` | Update canonical classes |
| `POST` | `/sessions/{id}/confirm` | Lock and confirm session |
| `DELETE` | `/sessions/{id}` | Delete session |
| `POST` | `/sessions/{id}/sources` | Add more dataset sources |
| `GET` | `/sessions/{id}/samples` | Get sampled images with annotations |
| `GET` | `/sessions/{id}/stats` | Full dataset statistics (per-class annotation counts) |
| `POST` | `/sessions/{id}/annotations` | Save annotation overrides for an image |
| `DELETE` | `/sessions/{id}/annotations` | Clear annotation overrides for an image |
| `POST` | `/sessions/{id}/export` | Start async export |
| `GET` | `/sessions/{id}/export/status` | Poll export progress |
| `POST` | `/sessions/{id}/package-zip` | Package export as ZIP |

### Validation

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sessions/{id}/validate` | Start batch validation (OWL-ViT / SigLIP / CLIP) |
| `GET` | `/sessions/{id}/validate/status` | Poll batch validation progress |
| `GET` | `/sessions/{id}/validate/suspicious` | Get suspicious images from last run |
| `POST` | `/sessions/{id}/validate/image` | Validate a single image synchronously |
| `POST` | `/sessions/{id}/detect-boxes` | Open-vocabulary box detection on one image |

### Inference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/inference` | Single-image YOLO inference |
| `POST` | `/inference/batch` | Batch YOLO inference on a directory |

### Filesystem

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sources/scan` | Scan a directory as a dataset source |
| `GET` | `/filesystem/browse` | Browse filesystem for folder picker |
| `GET` | `/filesystem/image` | Serve an image by absolute path (for UI preview) |

---

## Project Structure

```
api/
├── main.py              FastAPI app, CORS, router mounting
└── routes/
    ├── sessions.py      Session CRUD, samples, stats, export, annotations
    ├── validation.py    Multimodal validation + detection endpoints
    ├── inference.py     YOLO inference endpoints
    └── filesystem.py    Folder browser + image serving

core/
├── harmonizer/          Session model, CRUD, YOLO/COCO parsers
├── llm/                 OpenRouter / Anthropic prompt + class mapping
├── merger/              Image collection, label remapping, deduplication
├── exporter/            YOLO writer, stratified train/val/test splits
└── multimodal/
    ├── base.py          Shared dataclasses (BoxValidation, ImageValidationResult…)
    ├── owl_scorer.py    OWL-ViT backend — detection-tuned, per-box scoring + detect_boxes()
    ├── siglip_scorer.py SigLIP backend — sigmoid-based image-text matching
    ├── clip_scorer.py   CLIP backend (legacy) — softmax image-text matching
    └── __init__.py      Backend factory: get_scorer(backend, threshold)

ui/src/
├── App.tsx              Root: session routing, layout
├── api/client.ts        Typed axios wrappers for all endpoints
└── components/
    ├── HarmonizationView.tsx   Canonical classes panel + Stats tab
    ├── DatasetStats.tsx        Class distribution, source breakdown, per-source matrix
    ├── SampleViewer.tsx        Label preview grid + lightbox + validation + detection
    ├── HudOverlay.tsx          Military-style HUD box renderer (SVG)
    ├── LabelEditor.tsx         In-browser bounding box editor
    ├── CanonicalClassCard.tsx  Draggable class card with alias chips
    ├── ExportPanel.tsx         Export configuration + progress
    ├── InferencePanel.tsx      YOLO inference UI
    ├── AddSourcePanel.tsx      Add dataset source to existing session
    └── FolderBrowser.tsx       Filesystem folder picker

training/                Local training notebooks (gitignored — not part of the repo)
workspace/               Session data, annotation overrides (gitignored)
```

---

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `OPENROUTER_API_KEY` | — | **Yes** | LLM API key (OpenRouter recommended) |
| `ANTHROPIC_API_KEY` | — | Alt. | Direct Anthropic API key |
| `OPENROUTER_MODEL` | `anthropic/claude-3.5-sonnet` | No | Model to use for harmonization |
| `WORKSPACE_PATH` | `./workspace` | No | Where session JSON files are stored |
| `API_HOST` | `0.0.0.0` | No | Uvicorn bind host |
| `API_PORT` | `8000` | No | Uvicorn bind port |

---

## Validation Backends

### OWL-ViT (default)
Fine-tuned on object detection rather than image-text matching, giving better spatial calibration — especially for small objects and domain-specific categories. Crops each annotated box and scores it against all canonical class names via a detection head.

Also powers **open-vocabulary detection**: given class names, proposes new bounding boxes on an image (useful for finding missed objects).

Threshold default: **0.10** (sigmoid scores, lower than CLIP).

### SigLIP
Google's successor to CLIP. Uses sigmoid loss (not softmax), so class scores are independent — a box can score high for multiple classes simultaneously, making it more suitable for multi-label or ambiguous scenarios. Same crop-based approach as CLIP.

Threshold default: **0.15**.

### CLIP (legacy)
The original OpenAI CLIP model with softmax normalization. Scores are relative (zero-sum across classes), which can suppress valid classes in multi-class images. Still useful as a fast sanity check.

Threshold default: **0.25**.

---

## Development

```bash
# Lint
ruff check .

# Type check (frontend)
cd ui && npx tsc --noEmit

# Run backend tests
pytest tests/
```

---

## License

MIT
