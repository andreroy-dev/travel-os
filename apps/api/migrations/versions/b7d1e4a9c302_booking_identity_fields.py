"""booking identity fields

Revision ID: b7d1e4a9c302
Revises: a3e91c0d5b27
Create Date: 2026-11-28 10:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'b7d1e4a9c302'
down_revision: Union[str, Sequence[str], None] = 'a3e91c0d5b27'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('bookings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('source_channel', sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column('sender_domain', sa.String(length=255), nullable=True))
        batch_op.add_column(sa.Column('booking_url', sa.String(length=500), nullable=True))
        batch_op.add_column(sa.Column('dedup_key', sa.String(length=64), nullable=True))
        batch_op.create_index('ix_bookings_dedup_key', ['dedup_key'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('bookings', schema=None) as batch_op:
        batch_op.drop_index('ix_bookings_dedup_key')
        batch_op.drop_column('dedup_key')
        batch_op.drop_column('booking_url')
        batch_op.drop_column('sender_domain')
        batch_op.drop_column('source_channel')
