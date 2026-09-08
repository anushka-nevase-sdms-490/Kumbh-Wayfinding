"""Seed a small demo site graph (campus-scale) for offline testing."""

from sqlalchemy.orm import Session

from .db import Edge, QrNode, SessionLocal, init_db
from .services.pack_builder import build_offline_pack, haversine_m

# Demo grid near Nashik Godavari (approx) — for local demos use relative campus coords.
# These are fictional micro-site points ~40–60 m apart.
SEED_NODES = [
    {"code": "SETU-A01", "name": "Ram Kund Ghat", "lat": 19.9975, "lon": 73.7898, "node_type": "ghat", "icon": "ghat"},
    {"code": "SETU-A02", "name": "Junction East", "lat": 19.9978, "lon": 73.7902, "node_type": "junction", "icon": "junction"},
    {"code": "SETU-A03", "name": "Medical Camp", "lat": 19.9981, "lon": 73.7905, "node_type": "medical", "icon": "medical"},
    {"code": "SETU-B01", "name": "Toilet Block A", "lat": 19.9972, "lon": 73.7901, "node_type": "toilet", "icon": "toilet"},
    {"code": "SETU-B02", "name": "Help Desk", "lat": 19.9976, "lon": 73.7906, "node_type": "help", "icon": "help"},
    {"code": "SETU-C01", "name": "Parking P1", "lat": 19.9969, "lon": 73.7895, "node_type": "parking", "icon": "parking"},
    {"code": "SETU-C02", "name": "Lost & Found", "lat": 19.9980, "lon": 73.7896, "node_type": "lost_found", "icon": "lost_found"},
    {"code": "SETU-D01", "name": "Bus Stand", "lat": 19.9968, "lon": 73.7904, "node_type": "transport", "icon": "transport"},
]

# Walkable connections (undirected)
SEED_LINKS = [
    ("SETU-A01", "SETU-A02", "paved"),
    ("SETU-A02", "SETU-A03", "paved"),
    ("SETU-A01", "SETU-B01", "sand"),
    ("SETU-B01", "SETU-B02", "paved"),
    ("SETU-A02", "SETU-B02", "paved"),
    ("SETU-A03", "SETU-C02", "paved"),
    ("SETU-A01", "SETU-C02", "paved"),
    ("SETU-C01", "SETU-A01", "paved"),
    ("SETU-C01", "SETU-B01", "sand"),
    ("SETU-B01", "SETU-D01", "paved"),
    ("SETU-B02", "SETU-D01", "steps"),
    ("SETU-A02", "SETU-C02", "paved"),
]


def seed(db: Session | None = None):
    close = False
    if db is None:
        init_db()
        db = SessionLocal()
        close = True
    try:
        if db.query(QrNode).count() > 0:
            print("Already seeded — skipping nodes.")
        else:
            for n in SEED_NODES:
                db.add(QrNode(**n))
            db.commit()
            print(f"Seeded {len(SEED_NODES)} nodes.")

        if db.query(Edge).count() > 0:
            print("Already seeded — skipping edges.")
        else:
            by_code = {n.code: n for n in db.query(QrNode).all()}
            for a, b, surface in SEED_LINKS:
                na, nb = by_code[a], by_code[b]
                dist = haversine_m(na.lat, na.lon, nb.lat, nb.lon)
                db.add(
                    Edge(
                        from_code=a,
                        to_code=b,
                        distance_m=round(dist, 1),
                        surface=surface,
                        walkable=True,
                        bidirectional=True,
                    )
                )
            db.commit()
            print(f"Seeded {len(SEED_LINKS)} edges.")

        from .db import PackVersion

        if db.query(PackVersion).count() == 0:
            pack, path = build_offline_pack(db)
            print(f"Built pack {pack.version} → {path}")
        else:
            print("Pack already exists — skipping rebuild on seed.")
    finally:
        if close:
            db.close()


if __name__ == "__main__":
    seed()
