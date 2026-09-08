"""Helpers for phone / LAN access."""

from __future__ import annotations

import socket
from typing import List


def lan_ipv4_addresses() -> List[str]:
    """Best-effort list of non-loopback IPv4 addresses on this machine."""
    found: set[str] = set()

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        found.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass

    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                found.add(ip)
    except OSError:
        pass

    return sorted(ip for ip in found if not ip.startswith("127."))
