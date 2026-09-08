from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
)
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


class QrNode(Base):
    __tablename__ = "qr_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), unique=True, nullable=False, index=True)
    name = Column(String(128), nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    node_type = Column(String(32), nullable=False, default="junction")
    # ghat | parking | medical | lost_found | toilet | transport | junction | help
    icon = Column(String(32), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Edge(Base):
    __tablename__ = "edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    to_code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    distance_m = Column(Float, nullable=False)
    surface = Column(String(32), nullable=False, default="paved")  # paved | sand | steps
    walkable = Column(Boolean, nullable=False, default=True)
    bidirectional = Column(Boolean, nullable=False, default=True)


class AuditPhoto(Base):
    __tablename__ = "audit_photos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String(32), ForeignKey("qr_nodes.code"), nullable=False, index=True)
    object_key = Column(String(256), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class PackVersion(Base):
    __tablename__ = "pack_versions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    version = Column(String(32), unique=True, nullable=False)
    file_path = Column(String(512), nullable=False)
    signature = Column(String(128), nullable=False)
    node_count = Column(Integer, nullable=False, default=0)
    edge_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


def _make_engine():
    if settings.use_sqlite:
        url = f"sqlite:///{settings.sqlite_path}"
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(settings.database_url, pool_pre_ping=True)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
