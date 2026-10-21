"""Simple FastAPI proxy server serving SparkleWash frontend + API routes from port 8081."""
import uvicorn, sys

from fastapi import FastAPI, File, UploadFile, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from api.main import app as api_app

# Mount static files (the built frontend) and API routes
spa = FastAPI()

# Allow CORS for the built-in browser
spa.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True)

@spa.get("/")
async def root():
    """Serve the React app homepage."""
    return {"status": "ok", "service": "SparkleWash Frontend"}

@spa.get("/api")
@spa.get("/api/{path:path}")
async def api_pass_through(path: str):
    """Proxy API requests to the FastAPI backend on port 8123."""
    return api_app.routes[0].router.routes[0].method.__doc__ or {"detail": f"Not Found - try /index.html"}

# Add static directory mount
spa.mount("/", StaticFiles(directory="/Users/jorgeflores/github/carwash/frontend/dist"), name="static")

@spa.get("/api/api/health")
@spa.get("/api/api/upload")
@spa.post("/api/api/upload")
async def proxy_health_upload():
    """Proxy to the /api endpoint of the backend."""
    return api_app.routes[0].router.routes[-1].method.__doc__

# Start uvicorn for this SPA app on port 8081
if __name__ == "__main__":
    uvicorn.run("__main__:spa", host="0.0.0.0", port=8081, log_level="info")
