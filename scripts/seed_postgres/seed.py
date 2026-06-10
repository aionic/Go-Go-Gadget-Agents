"""Post-provision schema build + sample data seed for the agents demo database.

Reads connection settings from environment variables (set by Terraform's local-exec):
  PGHOST, PGDATABASE, PGUSER, PGPASSWORD, ENABLE_PGVECTOR

Idempotent: applies schema.sql (CREATE ... IF NOT EXISTS) and only seeds when tables are empty.
Run via:  uv run seed.py
"""

from __future__ import annotations

import os
import sys
import random
from decimal import Decimal
from pathlib import Path

import psycopg
from faker import Faker

fake = Faker()
HERE = Path(__file__).parent


def connect() -> psycopg.Connection:
    host = os.environ["PGHOST"]
    dbname = os.environ.get("PGDATABASE", "agentdb")
    user = os.environ["PGUSER"]
    password = os.environ["PGPASSWORD"]
    conninfo = (
        f"host={host} port=5432 dbname={dbname} "
        f"user={user} password={password} sslmode=require"
    )
    return psycopg.connect(conninfo, autocommit=True)


def apply_schema(conn: psycopg.Connection) -> None:
    schema = (HERE / "schema.sql").read_text(encoding="utf-8")
    enable_vector = os.environ.get("ENABLE_PGVECTOR", "true").lower() == "true"
    with conn.cursor() as cur:
        for statement in [s.strip() for s in schema.split(";") if s.strip()]:
            if statement.upper().startswith("CREATE EXTENSION") and not enable_vector:
                print("Skipping pgvector extension (ENABLE_PGVECTOR=false)")
                continue
            try:
                cur.execute(statement)
            except psycopg.errors.FeatureNotSupported as exc:
                if "vector" in statement.lower():
                    print(f"WARNING: pgvector not available, skipping: {exc}")
                    continue
                raise
    print("Schema applied.")


def table_is_empty(conn: psycopg.Connection, table: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        return cur.fetchone()[0] == 0


def seed(conn: psycopg.Connection) -> None:
    if not table_is_empty(conn, "customers"):
        print("Sample data already present; skipping seed.")
        return

    categories = ["Widgets", "Gadgets", "Gizmos", "Tools", "Accessories"]
    with conn.cursor() as cur:
        # Products
        product_ids: list[int] = []
        for _ in range(40):
            cur.execute(
                "INSERT INTO products (sku, name, category, price, in_stock) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (
                    fake.unique.bothify("SKU-#####"),
                    fake.catch_phrase(),
                    random.choice(categories),
                    Decimal(random.randint(500, 50000)) / 100,
                    random.randint(0, 500),
                ),
            )
            product_ids.append(cur.fetchone()[0])

        # Customers + orders + tickets
        for _ in range(60):
            cur.execute(
                "INSERT INTO customers (full_name, email, company, country) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (fake.name(), fake.unique.email(), fake.company(), fake.country()),
            )
            customer_id = cur.fetchone()[0]

            for _ in range(random.randint(0, 4)):
                cur.execute(
                    "INSERT INTO orders (customer_id, status, total) VALUES (%s, %s, 0) RETURNING id",
                    (customer_id, random.choice(["pending", "shipped", "delivered", "cancelled"])),
                )
                order_id = cur.fetchone()[0]
                total = Decimal(0)
                for _ in range(random.randint(1, 5)):
                    pid = random.choice(product_ids)
                    qty = random.randint(1, 6)
                    cur.execute("SELECT price FROM products WHERE id = %s", (pid,))
                    price = cur.fetchone()[0]
                    cur.execute(
                        "INSERT INTO order_items (order_id, product_id, quantity, unit_price) "
                        "VALUES (%s, %s, %s, %s)",
                        (order_id, pid, qty, price),
                    )
                    total += price * qty
                cur.execute("UPDATE orders SET total = %s WHERE id = %s", (total, order_id))

            for _ in range(random.randint(0, 2)):
                cur.execute(
                    "INSERT INTO support_tickets (customer_id, subject, body, priority, status) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (
                        customer_id,
                        fake.sentence(nb_words=6),
                        fake.paragraph(nb_sentences=4),
                        random.choice(["low", "normal", "high", "urgent"]),
                        random.choice(["open", "pending", "resolved"]),
                    ),
                )

        # Knowledge documents (no embeddings; vectorized later by the RAG pipeline)
        for _ in range(30):
            cur.execute(
                "INSERT INTO knowledge_documents (title, content) VALUES (%s, %s)",
                (fake.sentence(nb_words=5), fake.paragraph(nb_sentences=8)),
            )

    print("Sample data seeded.")


def main() -> int:
    try:
        with connect() as conn:
            apply_schema(conn)
            seed(conn)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR during seed: {exc}", file=sys.stderr)
        return 1
    print("Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
