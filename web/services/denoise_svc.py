"""
Audio Denoising Service — AI background noise removal using DeepFilterNet3.
"""

import sys
import types
import logging
import subprocess
import os
import tempfile
from pathlib import Path
from collections import namedtuple
import torch
import numpy as np

# Setup logging
logger = logging.getLogger(__name__)

# Monkey-patch loguru to prevent "Level 'WARNONCE' already exists" crash on re-import/reload
try:
    from loguru import logger as loguru_logger
    _orig_level = loguru_logger.level
    def _safe_level(name, no=None, color=None, icon=None):
        try:
            return _orig_level(name, no=no, color=color, icon=icon)
        except ValueError as e:
            if "already exists" in str(e):
                return _orig_level(name)
            raise
    loguru_logger.level = _safe_level
except Exception:
    pass

# Mock torchaudio.backend.common BEFORE importing deepfilternet to avoid import errors
# due to API changes/removals in newer torchaudio versions.
if "torchaudio.backend.common" not in sys.modules:
    AudioMetaData = namedtuple("AudioMetaData", ["sample_rate", "num_frames", "num_channels", "bits_per_sample", "encoding"])
    
    backend_module = types.ModuleType("torchaudio.backend")
    common_module = types.ModuleType("torchaudio.backend.common")
    common_module.AudioMetaData = AudioMetaData
    backend_module.common = common_module
    
    sys.modules["torchaudio.backend"] = backend_module
    sys.modules["torchaudio.backend.common"] = common_module
    logger.debug("torchaudio.backend.common mock injected for deepfilternet compatibility")

# Lazy deepfilternet imports to avoid initial startup overhead
df_model = None
df_state = None

def init_denoise_model():
    """Load and cache the DeepFilterNet model."""
    global df_model, df_state
    if df_model is None:
        from df.enhance import init_df
        logger.info("Initializing DeepFilterNet3 model...")
        df_model, df_state, _ = init_df()
        logger.info("DeepFilterNet3 model loaded successfully.")
    return df_model, df_state

def unload_denoise_model():
    """Unload the DeepFilterNet model to release VRAM/RAM."""
    global df_model, df_state
    if df_model is not None:
        logger.info("Unloading DeepFilterNet3 model from memory...")
        df_model = None
        df_state = None
        import gc
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

def load_audio_ffmpeg(input_path: str | Path, target_sr: int) -> torch.Tensor:
    """Load audio file and convert to 1-channel float32 tensor using FFmpeg."""
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as tmp:
        tmp_name = tmp.name
    try:
        # Resolve ffmpeg binary path dynamically
        from web.services.ffmpeg_svc import _resolve_binary
        ffmpeg_bin = _resolve_binary("ffmpeg")
        
        # Convert to raw float32 PCM mono at target_sr
        subprocess.run([
            ffmpeg_bin, "-y", "-v", "error", "-i", str(input_path),
            "-ar", str(target_sr), "-ac", "1",
            "-f", "f32le", tmp_name
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        
        with open(tmp_name, "rb") as f:
            data = f.read()
        arr = np.frombuffer(data, dtype=np.float32).copy()
        tensor = torch.from_numpy(arr).unsqueeze(0) # Shape: [1, T]
        return tensor
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except Exception:
                pass

def save_audio_ffmpeg(output_path: str | Path, audio_tensor: torch.Tensor, sr: int):
    """Save audio tensor to output path using FFmpeg."""
    arr = audio_tensor.squeeze(0).cpu().numpy()
    raw_data = arr.tobytes()
    with tempfile.NamedTemporaryFile(suffix=".raw", delete=False) as tmp:
        tmp.write(raw_data)
        tmp_name = tmp.name
    try:
        from web.services.ffmpeg_svc import _resolve_binary
        ffmpeg_bin = _resolve_binary("ffmpeg")
        
        # Convert raw float32 PCM back to target audio format
        subprocess.run([
            ffmpeg_bin, "-y", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1",
            "-i", tmp_name, str(output_path)
        ], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    finally:
        if os.path.exists(tmp_name):
            try:
                os.unlink(tmp_name)
            except Exception:
                pass

def denoise_audio_file(input_path: str | Path, output_path: str | Path) -> None:
    """Enhance input audio path using DeepFilterNet and save to output path."""
    logger.info(f"Denoising audio file: {input_path} -> {output_path}")
    model, state = init_denoise_model()
    
    # Load audio at model's sample rate (usually 48kHz)
    audio = load_audio_ffmpeg(input_path, state.sr())
    
    # Enhance
    from df.enhance import enhance
    logger.debug("Running DeepFilterNet inference...")
    enhanced = enhance(model, state, audio)
    
    # Save output
    save_audio_ffmpeg(output_path, enhanced, state.sr())
    logger.info("Denoising complete.")
