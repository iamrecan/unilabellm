from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import export, filesystem, inference, sessions, sources, validation, workspace

app = FastAPI(
    title="unilabellm API",
    description="LLM-powered YOLO dataset unification",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router)
app.include_router(sources.router)
app.include_router(export.router)
app.include_router(workspace.router)
app.include_router(filesystem.router)
app.include_router(inference.router)
app.include_router(validation.router)


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}
