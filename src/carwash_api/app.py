#!/usr/bin/env python3
"""SparkleWash FastAPI server and SPA gateway."""

import os, json
from pathlib import Path
from typing import Any
from fastapi import FastAPI, Query, Request, File, UploadFile
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, PlainTextResponse
from contextlib import asynccontextmanager

VERSION = "1.0.0"
HOST = "0.0.0.0"
PORT = 8123

KPI = {
    "daily_jobs_completed": 37.21,
    "total_revenue_2026_01": "$2,985.41",
    "avg_job_duration_minutes": 62.4,
    "on_time_rate_pct": 94.0,
    "top_performer_name": "Maria Garcia"
}

DEMO_JOBS = [
    {"job_id": 1, "type": "basic",     "plate": "AB-123-CD", "car_model": "Honda Civic", "color": "red"},
    {"job_id": 2, "type": "ceramic",   "plate": "XY-789-ZA", "car_model": "Tesla Model 3", "color": "white"},
    {"job_id": 3, "type": "basic",     "plate": "EF-456-GH", "car_model": "Toyota Camry", "color": "blue"},
]

DEMO_EMPLOYEES = [
    {"rank": 1, "name": "Maria Garcia",   "jobs_completed": 23, "revenue": "$1,890.00"},
    {"rank": 2, "name": "Alex Chen",      "jobs_completed": 18, "revenue": "$1,456.00"},
    {"rank": 3, "name": "Sarah Kumar",    "jobs_completed": 14, "revenue": "$1,102.50"},
]

@asynccontextmanager
async def lifespan(app: FastAPI) -> None:
    yield

APP = FastAPI(title="SparkleWash Inference & Analytics API", version=VERSION, lifespan=lifespan)

@APP.get("/health")
async def health() -> dict:
    return {"status": "healthy", "timestamp": str(os.popen("date -u %c").readline()), "version": VERSION}

@APP.get("/")
async def root(request: Request) -> HTMLResponse:
    return HTMLResponse(b"<div id='root'><h1>SPA Shell</h1></div>")

@APP.get("/spa")
async def spa() -> HTMLResponse:
    return HTMLResponse(open("/Users/jorgeflores/github/carwash/spa-web/index.html", "r").read())

@APP.get("/api/kpi/summary")
async def kpi() -> JSONResponse:
    return JSONResponse(content=KPI)

@APP.get("/api/jobs/history")
async def jobs_history() -> list:
    return DEMO_JOBS

@APP.get("/api/employees/leaderboard")
async def leaderboard() -> dict:
    return {"employees": DEMO_EMPLOYEES}

@APP.get("/api/revenue/by-category/")
async def revenue_by_category(category: str) -> JSONResponse:
    """Return revenue for a given category. category path param is required."""
    category_types = {"basic": 1, "ceramic": 2, "premium": 3, "express": 0}
    if category not in category_types:
        return JSONResponse({"error": "unknown category", "available": list(category_types.keys())}, status_code=404)
    n = category_types[category]
    import random
    n_washes = int((KPI["daily_jobs_completed"] * 20 / (n or 1)) + random.randint(-3, 3))
    return JSONResponse(content={"category": category, "washes": n_washes})

@APP.post("/api/upload")
async def upload_image(image: UploadFile = File(...)):
    data = await image.read()
    return JSONResponse(content={"received": True, "size_bytes": len(data), "status": "ok"})

@APP.get("/api/settings")
async def settings() -> dict:
    return {"endpoint": HOST + ":" + str(PORT), "demo_mode": True, "version": VERSION}

if __name__ == "__main__":
    import uvicorn
    print(f"SparkleWash FastAPI server v{VERSION}")
    print(f"  Listening on {HOST}:{PORT}")
    uvicorn.run(APP, host=HOST, port=PORT, reload=False)
