"""Databasemodeller (PostgreSQL via SQLAlchemy 2.0)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text,
                        UniqueConstraint, func)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# ---------- Brugere & sikkerhed ----------
class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(100), default="")
    language: Mapped[str] = mapped_column(String(5), default="da")
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuthSession(Base, TimestampMixin):
    __tablename__ = "auth_sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    ip: Mapped[str] = mapped_column(String(64), default="")
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Secret(Base, TimestampMixin):
    """Krypterede API-nøgler (Fernet). Klarteksten forlader aldrig backend."""
    __tablename__ = "secrets"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    ciphertext: Mapped[str] = mapped_column(Text)


class Setting(Base, TimestampMixin):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor: Mapped[str] = mapped_column(String(50))          # user / agent:<navn> / system
    action: Mapped[str] = mapped_column(String(100), index=True)
    target: Mapped[str] = mapped_column(String(300), default="")
    decision: Mapped[str] = mapped_column(String(30), default="")
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str] = mapped_column(String(64), default="")


class Approval(Base, TimestampMixin):
    """Handlinger AI'en har foreslået, som venter på din godkendelse."""
    __tablename__ = "approvals"
    id: Mapped[int] = mapped_column(primary_key=True)
    agent: Mapped[str] = mapped_column(String(50))
    tool: Mapped[str] = mapped_column(String(100))
    args: Mapped[dict] = mapped_column(JSON)
    risk: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text, default="")
    summary: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending/approved/rejected/executed/failed
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    conversation_id: Mapped[int | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# ---------- Samtaler ----------
class Conversation(Base, TimestampMixin):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="Ny samtale")
    agent: Mapped[str] = mapped_column(String(50), default="main")
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan",
                                                     order_by="Message.id")


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # user/assistant/tool/system
    content: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(100), default="")
    agent: Mapped[str] = mapped_column(String(50), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)  # kilder, værktøjskald, tokens
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    conversation: Mapped[Conversation] = relationship(back_populates="messages")


# ---------- Hukommelse ----------
class Memory(Base, TimestampMixin):
    __tablename__ = "memories"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)  # preference/fact/project/decision/plan/person/task
    content: Mapped[str] = mapped_column(Text)
    tier: Mapped[str] = mapped_column(String(10), default="short", index=True)  # short / long
    importance: Mapped[float] = mapped_column(Float, default=0.5)
    access_count: Mapped[int] = mapped_column(Integer, default=0)
    last_accessed: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    source_conversation_id: Mapped[int | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    superseded_by: Mapped[int | None] = mapped_column(Integer, nullable=True)


# ---------- Projekter, opgaver, kalender ----------
class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="active")
    folder: Mapped[str] = mapped_column(String(500), default="")  # sti under /workspace
    deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="todo", index=True)  # todo/doing/done
    priority: Mapped[int] = mapped_column(Integer, default=2)  # 1 høj – 4 lav
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    estimate_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    remind_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reminded: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CalendarEvent(Base, TimestampMixin):
    """Lokal cache + egne aftaler. Synkroniseres med CalDAV (Apple/Google/Nextcloud)."""
    __tablename__ = "calendar_events"
    __table_args__ = (UniqueConstraint("uid", name="uq_event_uid"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(300))
    calendar: Mapped[str] = mapped_column(String(200), default="local")
    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(300), default="")
    start: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    end: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    remote_href: Mapped[str] = mapped_column(String(500), default="")
    remind_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reminded: Mapped[bool] = mapped_column(Boolean, default=False)


# ---------- Dokumenter & research ----------
class Document(Base, TimestampMixin):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(300))
    path: Mapped[str] = mapped_column(String(500))
    mime: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    folder: Mapped[str] = mapped_column(String(200), default="")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    summary: Mapped[str] = mapped_column(Text, default="")
    text_preview: Mapped[str] = mapped_column(Text, default="")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="processing")
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)


class ResearchItem(Base, TimestampMixin):
    __tablename__ = "research_items"
    id: Mapped[int] = mapped_column(primary_key=True)
    query: Mapped[str] = mapped_column(Text)
    report: Mapped[str] = mapped_column(Text, default="")
    sources: Mapped[list] = mapped_column(JSON, default=list)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)


# ---------- Modeller ----------
class ModelConfig(Base, TimestampMixin):
    __tablename__ = "models"
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(30))     # ollama / openai / anthropic / openai_compatible
    model: Mapped[str] = mapped_column(String(150))
    label: Mapped[str] = mapped_column(String(150), default="")
    tier: Mapped[str] = mapped_column(String(20), default="local_small")  # local_small/local_large/local_code/cloud
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    context_window: Mapped[int] = mapped_column(Integer, default=8192)
    cost_in_dkk_per_mtok: Mapped[float] = mapped_column(Float, default=0.0)
    cost_out_dkk_per_mtok: Mapped[float] = mapped_column(Float, default=0.0)
    base_url: Mapped[str] = mapped_column(String(300), default="")
    secret_name: Mapped[str] = mapped_column(String(100), default="")
    capabilities: Mapped[list] = mapped_column(JSON, default=list)  # tools, vision, code, reasoning


class UsageRecord(Base):
    __tablename__ = "usage"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    provider: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(150))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_dkk: Mapped[float] = mapped_column(Float, default=0.0)
    agent: Mapped[str] = mapped_column(String(50), default="")


# ---------- Automatisering ----------
class Automation(Base, TimestampMixin):
    __tablename__ = "automations"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30))   # agent_prompt / daily_report / url_check / notify
    cron: Mapped[str] = mapped_column(String(100))  # standard 5-felts cron, Europe/Copenhagen
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_status: Mapped[str] = mapped_column(String(20), default="")
    last_output: Mapped[str] = mapped_column(Text, default="")


class AutomationRun(Base):
    __tablename__ = "automation_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    automation_id: Mapped[int] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    output: Mapped[str] = mapped_column(Text, default="")


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text, default="")
    level: Mapped[str] = mapped_column(String(20), default="info")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    link: Mapped[str] = mapped_column(String(300), default="")
