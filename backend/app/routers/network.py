"""LAN / phone access info for QR deep links."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Query

from ..network_info import lan_ipv4_addresses

router = APIRouter(prefix="/api", tags=["network"])

_PUBLIC_FILE = Path(
    os.environ.get(
        "PUBLIC_URL_FILE",
        str(Path(__file__).resolve().parents[3] / ".run-logs" / "public-url.txt"),
    )
)


def _public_app_url() -> str | None:
    env = (os.environ.get("PUBLIC_APP_URL") or "").strip().rstrip("/")
    if env:
        return env
    try:
        if _PUBLIC_FILE.is_file():
            text = _PUBLIC_FILE.read_text(encoding="utf-8").strip().rstrip("/")
            if text.startswith("http"):
                return text
    except OSError:
        pass
    return None


@router.get("/network")
def network_info(
    frontend_port: int = Query(5173, ge=1, le=65535),
    scheme: str = Query("http"),
):
    """IPs and phone URLs so the PC can print QRs that open on a phone."""
    ips = lan_ipv4_addresses()
    proto = "https" if scheme.lower() == "https" else "http"
    lan_urls = [f"{proto}://{ip}:{frontend_port}" for ip in ips]
    public = _public_app_url()
    phone_urls = ([public] if public else []) + lan_urls
    return {
        "ips": ips,
        "frontend_port": frontend_port,
        "scheme": proto,
        "public_url": public,
        "phone_urls": phone_urls,
    }
