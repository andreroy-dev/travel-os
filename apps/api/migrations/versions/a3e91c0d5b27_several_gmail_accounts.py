"""several gmail accounts per user

Revision ID: a3e91c0d5b27
Revises: cc2260ea161b
Create Date: 2026-11-25 13:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3e91c0d5b27'
down_revision: Union[str, Sequence[str], None] = 'cc2260ea161b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Allow one integration row per connected account instead of one per provider."""
    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.drop_constraint('uq_integrations_user_provider', type_='unique')
        batch_op.create_unique_constraint(
            'uq_integrations_user_provider_account', ['user_id', 'provider', 'external_account']
        )
    # Older rows stored the Travel OS sign-in email, not the Gmail address that was connected.
    # Clear it; the real address is read from Google the next time the accounts are listed.
    op.execute("UPDATE integrations SET external_account = NULL WHERE provider = 'gmail'")


def downgrade() -> None:
    with op.batch_alter_table('integrations', schema=None) as batch_op:
        batch_op.drop_constraint('uq_integrations_user_provider_account', type_='unique')
        batch_op.create_unique_constraint('uq_integrations_user_provider', ['user_id', 'provider'])
