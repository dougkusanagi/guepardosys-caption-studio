"""
Configuration and constants for the AI Shorts module.
"""

from pathlib import Path

# --- Layout and Video Constants ---
TARGET_ASPECT_RATIO = 9 / 16  # 0.5625
TARGET_WIDTH = 1080
TARGET_HEIGHT = 1920

# Safe Zone bounds (in percentage 0-1) to avoid TikTok/Instagram UI overlaps
SAFE_ZONE_TOP = 0.15     # Avoid channel info or top search
SAFE_ZONE_BOTTOM = 0.20  # Avoid captions, actions, music bars
SAFE_ZONE_LEFT = 0.05
SAFE_ZONE_RIGHT = 0.15   # Avoid right-side buttons (like, comment, share)

# --- Clip Selection Defaults ---
MIN_CLIP_DURATION = 15.0     # seconds
MAX_CLIP_DURATION = 60.0     # seconds
DEFAULT_TARGET_DURATION = 30.0
DEFAULT_CLIP_COUNT = 3

# --- SQLite Persistence ---
DB_FILE_NAME = "job.db"

# --- Models configuration ---
# The models directory is relative to the backend workspace
MODELS_DIR = Path(__file__).parent / "models"
YOLO_MODEL_URL = "https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n.onnx"
YOLO_MODEL_NAME = "yolo11n.onnx"
