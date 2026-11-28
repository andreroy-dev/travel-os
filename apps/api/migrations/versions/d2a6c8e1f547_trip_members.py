"""trip members, with one owner row per existing trip

Revision ID: d2a6c8e1f547
Revises: c4f8a2b6d913
"""

import uuid

import sqlalchemy as sa
from alembic import op

revision = "d2a6c8e1f547"
down_revision = "c4f8a2b6d913"
branch_labels = None
depends_on = None


def upgrade() -> None:
    members = op.create_table(
        "trip_members",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("travel_space_id", sa.Uuid(), sa.ForeignKey("travel_spaces.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(32), nullable=False),
        sa.Column("invited_by_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("travel_space_id", "user_id", name="uq_trip_member"),
    )
    op.create_index("ix_trip_members_travel_space_id", "trip_members", ["travel_space_id"])
    op.create_index("ix_trip_members_user_id", "trip_members", ["user_id"])

    connection = op.get_bind()
    rows = connection.execute(sa.text("SELECT id, user_id FROM travel_spaces")).fetchall()
    if rows:
        op.bulk_insert(
            members,
            [
                {"id": uuid.uuid4(), "travel_space_id": space_id, "user_id": user_id, "role": "owner"}
                for space_id, user_id in rows
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_trip_members_user_id", table_name="trip_members")
    op.drop_index("ix_trip_members_travel_space_id", table_name="trip_members")
    op.drop_table("trip_members")
