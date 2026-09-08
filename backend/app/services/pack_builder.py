import hashlib
import json
import os
from datetime import datetime
from typing import Tuple

from sqlalchemy.orm import Session

from ..config import settings
from ..db import Edge, PackVersion, QrNode
from ..schemas import EdgeOut, OfflinePack, QrNodeOut


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    from math import asin, cos, radians, sin, sqrt

    r = 6371000.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    )
    return 2 * r * asin(sqrt(a))


def build_offline_pack(db: Session) -> Tuple[OfflinePack, str]:
    nodes = db.query(QrNode).all()
    edges = db.query(Edge).filter(Edge.walkable.is_(True)).all()

    node_outs = [QrNodeOut.model_validate(n) for n in nodes]
    edge_outs = [EdgeOut.model_validate(e) for e in edges]

    version = datetime.utcnow().strftime("v%Y%m%d%H%M%S%f")
    # Avoid rare unique collisions if two builds land in the same microsecond
    existing = db.query(PackVersion).filter(PackVersion.version == version).first()
    if existing:
        version = f"{version}_{os.getpid()}"
    payload = {
        "version": version,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "nodes": [n.model_dump(mode="json") for n in node_outs],
        "edges": [e.model_dump(mode="json") for e in edge_outs],
    }
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    signature = hashlib.sha256(raw).hexdigest()

    pack = OfflinePack(
        version=version,
        generated_at=datetime.utcnow(),
        signature=signature,
        nodes=node_outs,
        edges=edge_outs,
    )

    os.makedirs(settings.pack_dir, exist_ok=True)
    path = os.path.join(settings.pack_dir, f"setu_pack_{version}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(
            {
                **payload,
                "signature": signature,
            },
            f,
            indent=2,
        )

    db.add(
        PackVersion(
            version=version,
            file_path=path,
            signature=signature,
            node_count=len(nodes),
            edge_count=len(edges),
        )
    )
    db.commit()
    return pack, path
