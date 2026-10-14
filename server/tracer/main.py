"""FastAPI app: POST /api/trace. Run: uvicorn tracer.main:app --app-dir server"""
from __future__ import annotations

import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import __version__, embed
from .pipeline import trace
from .search import provider
from .wayback import WaybackClient

app = FastAPI(title="Tracer", version=__version__)
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("TRACER_CORS", "*").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


class Candidate(BaseModel):
    url: str | None = None
    text: str | None = None
    label: str | None = None
    claimed: dict | None = None


class TraceRequest(BaseModel):
    text: str = Field(min_length=20, max_length=50_000)
    candidates: list[Candidate] = Field(default_factory=list, max_length=30)
    search: bool = False


@app.get("/api/health")
def health():
    return {"ok": True, "version": __version__, "search": provider(),
            "embeddings": embed.available() if os.environ.get("TRACER_EMBED", "1") == "1" else False}


@app.post("/api/trace")
async def api_trace(req: TraceRequest):
    if not req.candidates and not req.search:
        raise HTTPException(400, "give candidates or set search=true")
    async with httpx.AsyncClient() as client:
        return await trace(req.text, [c.model_dump(exclude_none=True) for c in req.candidates],
                           do_search=req.search, client=client, wayback=WaybackClient(client),
                           use_embeddings=os.environ.get("TRACER_EMBED", "1") == "1")
