"""
Create or upgrade the database once, before the API workers start
(`python -m app.migrate`). Several workers doing it at the same moment race on
Postgres (CREATE TABLE / ALTER TABLE) and one of them fails.
"""
from .config import production_problems, settings
from .db import init_db
from .seed import seed


def main() -> None:
    problems = production_problems(settings)
    if problems:
        raise SystemExit("Unsafe production settings: " + "; ".join(problems))
    init_db()
    seed()
    from .services.river_guard import load_water_index, water_dir

    if load_water_index() is None:
        print(
            f"WARNING: no water data in {water_dir()} — routes are NOT checked for crossing "
            "the Godavari. Run: python scripts/import_osm.py all"
        )
    print("Database ready.")


if __name__ == "__main__":
    main()
