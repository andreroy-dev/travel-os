"""Copy every row from one Travel OS database into another (e.g. local SQLite -> Supabase Postgres).

Usage (from apps/api):
    DATABASE_URL=<target> uv run alembic upgrade head          # create the schema first
    uv run python scripts/copy_database.py <source-url> <target-url>

The target must be empty. Tables are copied parents-first so foreign keys hold.
"""

import sys

from sqlalchemy import create_engine, func, select

from app.models import Base


def copy(source_url: str, target_url: str) -> dict[str, int]:
    source = create_engine(source_url)
    target = create_engine(target_url)
    counts: dict[str, int] = {}
    with source.connect() as read, target.begin() as write:
        for table in Base.metadata.sorted_tables:
            existing = write.execute(select(func.count()).select_from(table)).scalar_one()
            if existing:
                raise SystemExit(f"Target table {table.name} is not empty ({existing} rows). Aborting.")
        for table in Base.metadata.sorted_tables:
            rows = [dict(row._mapping) for row in read.execute(select(table))]
            if table.name == "destinations":
                # Self-referencing: insert without parents, then set them.
                parents = {row["id"]: row.get("parent_id") for row in rows}
                for row in rows:
                    row["parent_id"] = None
                if rows:
                    write.execute(table.insert(), rows)
                for row_id, parent in parents.items():
                    if parent is not None:
                        write.execute(table.update().where(table.c.id == row_id).values(parent_id=parent))
            elif rows:
                write.execute(table.insert(), rows)
            counts[table.name] = len(rows)
    return counts


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    for name, count in copy(sys.argv[1], sys.argv[2]).items():
        print(f"{name}: {count}")
