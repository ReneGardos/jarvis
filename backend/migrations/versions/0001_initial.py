"""Initialt skema (version 1.0).

Revision ID: 0001
"""
from alembic import op

from app.db.models import Base

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Basisskemaet oprettes direkte fra modellerne; senere ændringer laves som autogenererede migrationer.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
