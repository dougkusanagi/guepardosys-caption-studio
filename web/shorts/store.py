"""
SQLite store for project-specific Shorts jobs, artifacts, and clips.
"""

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Generator

from web.shorts.config import DB_FILE_NAME

# The processed folder is relative to the backend server directory
PROCESSED_DIR = Path(__file__).parent.parent / "processed"


def get_db_path(project_id: str) -> Path:
    """Get the path to the project's Shorts SQLite database."""
    shorts_dir = PROCESSED_DIR / project_id / "shorts"
    shorts_dir.mkdir(parents=True, exist_ok=True)
    return shorts_dir / DB_FILE_NAME


def init_db(conn: sqlite3.Connection):
    """Initialize the database schema."""
    cursor = conn.cursor()
    
    # 1. Jobs Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shorts_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        status TEXT NOT NULL,  -- pending | analyzing | ready | generating | done | error
        config_json TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    )
    """)

    # 2. Artifacts Table (tracks intermediate JSONs/files created by skills)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shorts_artifacts (
        job_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        path TEXT NOT NULL,
        checksum TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (job_id, skill_name)
    )
    """)

    # 3. Clips Table (tracks selected short clips)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS shorts_clips (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        index_num INTEGER NOT NULL,
        start_sec REAL NOT NULL,
        end_sec REAL NOT NULL,
        score REAL DEFAULT 0.0,
        output_path TEXT,
        status TEXT DEFAULT 'pending'  -- pending | processing | done | error
    )
    """)

    conn.commit()


@contextmanager
def get_db(project_id: str) -> Generator[sqlite3.Connection, None, None]:
    """Context manager for SQLite connection with automatically initialized tables."""
    db_path = get_db_path(project_id)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        init_db(conn)
        yield conn
    finally:
        conn.close()


# --- CRUD Helpers ---

def create_job(project_id: str, job_id: str, filename: str, config: dict) -> dict[str, Any]:
    """Create a new Shorts job entry."""
    config_json = json.dumps(config)
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO shorts_jobs (id, project_id, filename, status, config_json)
            VALUES (?, ?, ?, ?, ?)
            """,
            (job_id, project_id, filename, "pending", config_json)
        )
        conn.commit()
    return {
        "id": job_id,
        "projectId": project_id,
        "filename": filename,
        "status": "pending",
        "config": config
    }


def get_job(project_id: str, job_id: str) -> dict[str, Any] | None:
    """Fetch a job details."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT id, project_id, filename, status, config_json, created_at, updated_at FROM shorts_jobs WHERE id = ?",
            (job_id,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "filename": row["filename"],
            "status": row["status"],
            "config": json.loads(row["config_json"]) if row["config_json"] else {},
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"]
        }


def update_job_status(project_id: str, job_id: str, status: str):
    """Update job status and set the updated_at timestamp."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            UPDATE shorts_jobs
            SET status = ?, updated_at = datetime('now')
            WHERE id = ?
            """,
            (status, job_id)
        )
        conn.commit()


def save_artifact(project_id: str, job_id: str, skill_name: str, path: str, checksum: str = None):
    """Record a skill output artifact."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT OR REPLACE INTO shorts_artifacts (job_id, skill_name, path, checksum, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            """,
            (job_id, skill_name, path, checksum)
        )
        conn.commit()


def get_artifacts(project_id: str, job_id: str) -> dict[str, str]:
    """Retrieve all artifacts mapping skill_name to file path."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT skill_name, path FROM shorts_artifacts WHERE job_id = ?",
            (job_id,)
        )
        return {row["skill_name"]: row["path"] for row in cursor.fetchall()}


def save_clips(project_id: str, job_id: str, clips: list[dict[str, Any]]):
    """Save or update candidate clips."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        # Delete existing ones to avoid duplicates if re-running
        cursor.execute("DELETE FROM shorts_clips WHERE job_id = ?", (job_id,))
        for idx, clip in enumerate(clips):
            clip_id = clip.get("id") or f"{job_id}_{idx}"
            cursor.execute(
                """
                INSERT INTO shorts_clips (id, job_id, index_num, start_sec, end_sec, score, output_path, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    clip_id,
                    job_id,
                    idx,
                    clip["start_sec"],
                    clip["end_sec"],
                    clip.get("score", 0.0),
                    clip.get("output_path"),
                    clip.get("status", "pending")
                )
            )
        conn.commit()


def get_clips(project_id: str, job_id: str) -> list[dict[str, Any]]:
    """Retrieve all clips belonging to a job."""
    with get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT id, index_num, start_sec, end_sec, score, output_path, status 
            FROM shorts_clips 
            WHERE job_id = ?
            ORDER BY index_num ASC
            """,
            (job_id,)
        )
        return [
            {
                "id": row["id"],
                "index": row["index_num"],
                "start_sec": row["start_sec"],
                "end_sec": row["end_sec"],
                "score": row["score"],
                "outputPath": row["output_path"],
                "status": row["status"]
            }
            for row in cursor.fetchall()
        ]
