"""onboarding profile fields on user_preferences

Revision ID: c4f8a2b6d913
Revises: b7d1e4a9c302
"""

import sqlalchemy as sa
from alembic import op

revision = "c4f8a2b6d913"
down_revision = "b7d1e4a9c302"
branch_labels = None
depends_on = None

COLUMNS = [
    ("home_country", 2),
    ("residency_country", 2),
    ("passport_nationality", 2),
    ("trip_type", 16),
    ("pace", 16),
    ("climate", 16),
    ("available_time", 32),
    ("provider_priority", 16),
]


def upgrade() -> None:
    with op.batch_alter_table("user_preferences") as batch:
        for name, size in COLUMNS:
            batch.add_column(sa.Column(name, sa.String(size), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user_preferences") as batch:
        for name, _ in reversed(COLUMNS):
            batch.drop_column(name)
