import gc
import logging
import time
import torch
from typing import Any

logger = logging.getLogger(__name__)

class ModelManager:
    """
    Manages heavy AI models (Faster-Whisper, etc.) to optimize VRAM footprint on 6GB GPUs.
    Ensures sequential execution and proactive VRAM cleanup.
    """
    _loaded_models: dict[str, Any] = {}

    @classmethod
    def clean_vram(cls):
        """Aggressively release GPU memory and collect garbage."""
        start_time = time.time()
        logger.info("Starting aggressive VRAM cleanup...")
        
        # Explicitly remove model references from cache
        keys = list(cls._loaded_models.keys())
        for key in keys:
            logger.info(f"Unloading model: {key}")
            del cls._loaded_models[key]
        
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
            
        # Request LM Studio local API to unload LLM models from VRAM
        try:
            import httpx
            url_list = "http://localhost:1234/api/v1/models"
            url_unload = "http://localhost:1234/api/v1/models/unload"
            with httpx.Client(timeout=3.0) as client:
                res = client.get(url_list)
                if res.status_code == 200:
                    data = res.json()
                    models_list = data.get("data", []) if isinstance(data, dict) else data
                    for model_info in models_list:
                        instances = model_info.get("loaded_instances", [])
                        for inst in instances:
                            inst_id = inst.get("instance_id") or inst.get("id")
                            if inst_id:
                                logger.info(f"Requesting LM Studio to unload model instance: {inst_id}")
                                unload_res = client.post(url_unload, json={"instance_id": inst_id})
                                logger.info(f"LM Studio unload response for {inst_id}: {unload_res.status_code}")
        except Exception as e:
            logger.warning(f"Failed to request LM Studio VRAM cleanup: {e}")
            
        elapsed = time.time() - start_time
        logger.info(f"VRAM cleanup complete in {elapsed:.2f}s.")

    @classmethod
    def load_whisper(cls, model_size: str) -> Any:
        """
        Load Faster-Whisper model into memory (GPU if available, else CPU).
        Ensures any previously loaded models are cleared before loading a new one.
        """
        from faster_whisper import WhisperModel
        
        model_key = f"whisper_{model_size}"
        if model_key in cls._loaded_models:
            logger.info(f"Whisper model '{model_size}' already loaded.")
            return cls._loaded_models[model_key]
            
        # Clean any other loaded models first
        cls.clean_vram()
        
        device = "cuda" if torch.cuda.is_available() else "cpu"
        compute_type = "float16" if device == "cuda" else "int8"
        
        logger.info(f"Loading Faster-Whisper '{model_size}' on {device} (compute={compute_type})...")
        start_time = time.time()
        
        try:
            model = WhisperModel(model_size, device=device, compute_type=compute_type)
            cls._loaded_models[model_key] = model
            elapsed = time.time() - start_time
            logger.info(f"Whisper '{model_size}' loaded successfully in {elapsed:.2f}s.")
            return model
        except Exception as e:
            logger.exception(f"Failed to load Whisper model '{model_size}' on {device}")
            # Fallback to CPU with float32 if CUDA/float16 failed
            if device == "cuda":
                logger.warning("Retrying Whisper loading on CPU...")
                model = WhisperModel(model_size, device="cpu", compute_type="float32")
                cls._loaded_models[model_key] = model
                return model
            raise e
