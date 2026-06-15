#!/usr/bin/env python3
"""Export FastAPI OpenAPI spec for Mintlify API playground."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "openapi.json"
PRODUCTION_API_URL = "https://solarmoney.up.railway.app"

# Import app without requiring a running server.
os.environ.setdefault("ALLOW_DEV_ADMIN_SECRET", "1")
os.environ.setdefault("GBA_DISABLE_FALLBACK", "1")
sys.path.insert(0, str(ROOT))

from backend.main import app  # noqa: E402

TAG_RULES: list[tuple[str, str]] = [
    ("/healthz", "Health"),
    ("/api/buildings", "Buildings"),
    ("/api/shadow", "Shadows"),
    ("/api/shadows", "Shadows"),
    ("/api/usable-fraction", "Shadows"),
    ("/api/dem/", "Terrain & Climate"),
    ("/api/township", "Terrain & Climate"),
    ("/api/climate/", "Terrain & Climate"),
    ("/api/sun-times/", "Terrain & Climate"),
    ("/api/region-", "Terrain & Climate"),
    ("/api/topsis", "Terrain & Climate"),
    ("/api/assessments", "Assessments"),
    ("/api/auth/", "Authentication"),
    ("/api/me/", "User Account"),
    ("/api/vendors", "Vendors"),
    ("/api/admin/", "Admin"),
    ("/api/places/", "Places"),
    ("/api/address-township", "Places"),
]

JWT_PREFIXES = ("/api/me/", "/api/admin/")


def tag_for_path(path: str) -> str:
    for prefix, tag in TAG_RULES:
        if path.startswith(prefix) or path == prefix.rstrip("/"):
            return tag
    return "Other"


def needs_bearer(path: str) -> bool:
    return any(path.startswith(p) for p in JWT_PREFIXES)


def sanitize_for_mdx(text: str) -> str:
    """Prevent OpenAPI descriptions from breaking Mintlify MDX compilation."""
    if not text or ("{" not in text and "}" not in text):
        return text
    # Curly braces are parsed as JSX in MDX; use parentheses in pseudo-JSON examples.
    return text.replace("{", "(").replace("}", ")")


def enrich_spec(spec: dict) -> dict:
    spec["info"]["description"] = (
        "Rooftop solar assessment API — buildings, shadows, climate, assessments, and vendor matching."
    )

    servers: list[dict[str, str]] = [
        {"url": PRODUCTION_API_URL, "description": "Production"},
    ]
    if os.environ.get("DOCS_INCLUDE_LOCAL") == "1":
        servers.append({"url": "http://localhost:8000", "description": "Local development"})
    spec["servers"] = servers

    components = spec.setdefault("components", {})
    security_schemes = components.setdefault("securitySchemes", {})
    security_schemes["bearerAuth"] = {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT",
        "description": "JWT from POST /api/auth/login",
    }

    tag_descriptions = {
        "Health": "Service health checks",
        "Buildings": "Building footprint queries (GBA DB → fallback → OSM)",
        "Shadows": "Shadow geometry and usable roof area",
        "Terrain & Climate": "DEM tiles, township climate, and tilt optimization",
        "Assessments": "Anonymous and authenticated assessment records",
        "Authentication": "User registration and login",
        "User Account": "Endpoints for logged-in users (JWT required)",
        "Vendors": "Vendor listings, applications, and inquiries",
        "Admin": "Admin-only operations (JWT or X-Admin-Secret)",
        "Places": "Address autocomplete and geocoding proxies",
        "Other": "Miscellaneous endpoints",
    }

    used_tags: set[str] = set()
    http_methods = {"get", "post", "put", "patch", "delete", "head", "options"}

    for path, path_item in spec.get("paths", {}).items():
        tag = tag_for_path(path)
        used_tags.add(tag)
        for method, operation in path_item.items():
            if method not in http_methods or not isinstance(operation, dict):
                continue
            operation["tags"] = [tag]
            if needs_bearer(path):
                operation["security"] = [{"bearerAuth": []}]
            if operation.get("description"):
                operation["description"] = sanitize_for_mdx(operation["description"])

    spec["tags"] = [
        {"name": name, "description": tag_descriptions.get(name, "")}
        for name in sorted(used_tags)
    ]

    return spec


def main() -> None:
    spec = enrich_spec(app.openapi())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8") as f:
        json.dump(spec, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"Wrote {OUT} ({len(spec.get('paths', {}))} paths)")


if __name__ == "__main__":
    main()
