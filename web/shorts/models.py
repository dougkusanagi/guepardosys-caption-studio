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
        
        # Unload DeepFilterNet model if loaded
        try:
            from web.services.denoise_svc import unload_denoise_model
            unload_denoise_model()
        except Exception as e:
            logger.warning(f"Failed to unload DeepFilterNet model: {e}")

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
                    models_list = []
                    if isinstance(data, dict):
                        models_list = data.get("models") or data.get("data") or []
                    elif isinstance(data, list):
                        models_list = data
                        
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
    def load_face_detector(cls) -> Any:
        """
        Load YuNet face detector model. Downloads the ONNX model from OpenCV Zoo if not cached.
        """
        import cv2
        from web.shorts.config import MODELS_DIR
        
        model_name = "yunet.onnx"
        model_path = MODELS_DIR / model_name
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        
        if not model_path.exists():
            import urllib.request
            url = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
            logger.info(f"Downloading YuNet face detector ONNX model to {model_path}...")
            urllib.request.urlretrieve(url, model_path)
            logger.info("YuNet face detector downloaded successfully.")
            
        model_key = "yunet"
        if model_key in cls._loaded_models:
            return cls._loaded_models[model_key]
            
        detector = cv2.FaceDetectorYN.create(
            str(model_path),
            "",
            (320, 320), # initial dummy input size
            0.6,
            0.3,
            500
        )
        cls._loaded_models[model_key] = detector
        return detector

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
