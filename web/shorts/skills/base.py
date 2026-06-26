"""
Base classes and context definitions for the pipeline skills.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Awaitable


@dataclass
class SkillContext:
    project_id: str
    job_id: str
    video_path: Path
    work_dir: Path
    client_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    artifacts: dict[str, str] = field(default_factory=dict)
    # Async progress update callback: (stage, progress_percent, message)
    progress_callback: Callable[[str, int, str], Awaitable[None]] | None = None


@dataclass
class SkillResult:
    success: bool
    output_path: Path | None = None
    error_message: str | None = None
    data: dict[str, Any] = field(default_factory=dict)


class BaseSkill(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """The identifier name of the skill (e.g. 'transcribe', 'vad')."""
        pass

    @abstractmethod
    async def run(self, ctx: SkillContext) -> SkillResult:
        """Execute the skill core logic."""
        pass
