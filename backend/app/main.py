from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .claude import generate_score
from .config import settings
from .schema import GenerateRequest, MusicScore

app = FastAPI(title="Symphony AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/generate", response_model=MusicScore)
def generate(req: GenerateRequest) -> MusicScore:
    try:
        return generate_score(req.prompt)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
