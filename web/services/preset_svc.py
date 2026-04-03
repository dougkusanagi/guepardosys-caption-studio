"""
Preset Service — Save, load, and manage subtitle style presets.
Uses a simple JSON file for storage.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

from fastapi import HTTPException

DEFAULT_PRESETS: list[dict] = [
    {
        "id": "default",
        "name": "Padrão",
        "style": {
            "fontName": "Arial",
            "fontSize": 24,
            "primaryColor": "#ffffff",
            "outlineColor": "#000000",
            "outline": 2,
            "shadow": 1,
            "alignment": 2,
            "positionY": 88,
            "areaHeight": 18,
            "bold": False,
        },
    },
    {
        "id": "youtube",
        "name": "YouTube",
        "style": {
            "fontName": "Roboto",
            "fontSize": 28,
            "primaryColor": "#ffffff",
            "outlineColor": "#000000",
            "outline": 3,
            "shadow": 2,
            "alignment": 2,
            "positionY": 90,
            "areaHeight": 16,
            "bold": True,
        },
    },
    {
        "id": "minimal",
        "name": "Minimalista",
        "style": {
            "fontName": "Inter",
            "fontSize": 22,
            "primaryColor": "#ffffff",
            "outlineColor": "#000000",
            "outline": 1,
            "shadow": 0,
            "alignment": 2,
            "positionY": 88,
            "areaHeight": 18,
            "bold": False,
        },
    },
]


def _get_presets_path() -> Path:
    return Path(__file__).parent.parent / "presets.json"


def _load_all() -> list[dict]:
    path = _get_presets_path()
    if not path.exists():
        return list(DEFAULT_PRESETS)
    try:
        data = json.loads(path.read_text("utf-8"))
        return data if isinstance(data, list) else list(DEFAULT_PRESETS)
    except (json.JSONDecodeError, ValueError):
        return list(DEFAULT_PRESETS)


def _save_all(presets: list[dict]) -> None:
    path = _get_presets_path()
    path.write_text(json.dumps(presets, ensure_ascii=False, indent=2), encoding="utf-8")


def list_presets() -> list[dict]:
    return _load_all()


def get_preset(preset_id: str) -> dict | None:
    for preset in _load_all():
        if preset["id"] == preset_id:
            return preset
    return None


def create_preset(name: str, style: dict) -> dict:
    presets = _load_all()
    new_preset = {
        "id": str(uuid.uuid4()),
        "name": name,
        "style": style,
    }
    presets.append(new_preset)
    _save_all(presets)
    return new_preset


def update_preset(preset_id: str, name: str | None = None, style: dict | None = None) -> dict:
    presets = _load_all()
    for i, preset in enumerate(presets):
        if preset["id"] == preset_id:
            if preset_id == "default" and preset.get("name") == "Padrão":
                raise HTTPException(status_code=400, detail="Não é possível editar o preset padrão")
            if name is not None:
                presets[i]["name"] = name
            if style is not None:
                presets[i]["style"] = style
            _save_all(presets)
            return presets[i]
    raise HTTPException(status_code=404, detail="Preset não encontrado")


def delete_preset(preset_id: str) -> None:
    presets = _load_all()
    for i, preset in enumerate(presets):
        if preset["id"] == preset_id:
            if preset_id == "default" and preset.get("name") == "Padrão":
                raise HTTPException(status_code=400, detail="Não é possível excluir o preset padrão")
            presets.pop(i)
            _save_all(presets)
            return
    raise HTTPException(status_code=404, detail="Preset não encontrado")
