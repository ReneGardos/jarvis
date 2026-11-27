"""Ren tidslogik uden afhængigheder (testbar)."""
from __future__ import annotations

from datetime import datetime, timedelta


def find_free_slots(events: list[tuple[datetime, datetime]], day_start: datetime, day_end: datetime,
                    min_minutes: int = 30) -> list[tuple[datetime, datetime]]:
    """Ren funktion: ledige tidsrum mellem aftaler (bruges til dagsplanlægning)."""
    slots, cursor = [], day_start
    for s, e in sorted(events):
        if e <= cursor:
            continue
        if s > cursor and (s - cursor) >= timedelta(minutes=min_minutes):
            slots.append((cursor, min(s, day_end)))
        cursor = max(cursor, e)
        if cursor >= day_end:
            break
    if day_end - cursor >= timedelta(minutes=min_minutes):
        slots.append((cursor, day_end))
    return slots
