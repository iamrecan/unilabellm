# unilabellm

**LLM-powered YOLO dataset unification.** Bring multiple datasets with different label vocabularies — get one clean, harmonized dataset out.

```
Dataset A: car, vehicle, auto        ─┐
Dataset B: person, pedestrian, human ─┤─ LLM ─→ car / person / truck  → unified YOLO
Dataset C: truck, lorry              ─┘
```

## Features

- **Semantic harmonization** — Claude groups synonymous labels automatically
- **Drag-and-drop review UI** — reassign aliases between canonical classes before confirming
- **Confidence indicators** — low-confidence suggestions highlighted in yellow
- **Video-aware splitting** — prevents train/val/test leakage for frame-based datasets
- **Near-duplicate detection** — pHash deduplication across sources
- **YOLO export** — produces a valid `data.yaml` + stratified splits

---

## Quickstart

### 1. Install

```bash
git clone https://github.com/your-org/unilabellm
cd unilabellm
pip install -e ".[dev]"
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY
```

### 2. Start the API

```bash
uvicorn api.main:app --reload
```

### 3. Start the UI

```bash
npm install
npm run dev         # → http://localhost:5173
```

### 4. Or use Docker Compose

```bash
ANTHROPIC_API_KEY=sk-ant-... docker compose up
# API: http://localhost:8000
# UI:  http://localhost:3000
```

---

## CLI Usage

```bash
# Create a new session (runs LLM analysis automatically)
unilabellm session new --sources ./ds1 ./ds2 ./ds3

# List sessions
unilabellm session list

# Inspect a session
unilabellm session show <session_id>

# Confirm after reviewing
unilabellm session confirm <session_id>

# Export to unified YOLO dataset
unilabellm export <session_id> --output ./my_unified --split 70 20 10
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sessions` | Create session + run LLM analysis |
| GET | `/sessions` | List all sessions |
| GET | `/sessions/{id}` | Get session detail |
| PATCH | `/sessions/{id}/classes` | Update canonical classes |
| POST | `/sessions/{id}/confirm` | Confirm session |
| POST | `/sessions/{id}/export` | Export unified dataset |
| GET | `/sessions/{id}/export/status` | Export progress |
| POST | `/sources/scan` | Scan a dataset directory |
| GET | `/workspace/datasets` | List workspace datasets |

---

## Project Structure

```
core/parser/      YOLO dataset reader
core/llm/         Anthropic SDK integration + prompts
core/harmonizer/  Class mapping, session CRUD, validation
core/merger/      Image collection, label remapping, dedup
core/exporter/    YOLO writer, stratified splits
api/              FastAPI REST layer
ui/               React + dnd-kit drag-drop UI
cli/              Click CLI commands
workspace/        User data (gitignored)
```

---

## Environment Variables

| Variable | Default | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | — | **Yes** |
| `WORKSPACE_PATH` | `./workspace` | No |
| `API_HOST` | `0.0.0.0` | No |
| `API_PORT` | `8000` | No |
| `LOG_LEVEL` | `INFO` | No |

---

## Development

```bash
pytest tests/            # run tests
ruff check .             # lint
```

---

## Roadmap

| Format | Status |
|--------|--------|
| YOLO v5/v8 | ✅ |
| COCO JSON | Planned |
| Pascal VOC | Planned |
| Roboflow Universe | Planned |
| Kaggle Datasets | Planned |

---

## License

MIT
