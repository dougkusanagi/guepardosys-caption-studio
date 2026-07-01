import asyncio
import logging
import sys
from pathlib import Path

# Add project root to python path to import modules correctly
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from web.shorts import store
from web.shorts.pipeline import ShortsPipeline
from web.shorts.render import render_clip

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("test_pipeline")

async def test_run():
    # Setup test params
    project_id = "test_project_id"
    job_id = "test_job_id"
    # Let's use one of the smaller files in uploads/
    filename = "be4d2d5c-9582-4a3f-abf0-9492176440e5.mp4"
    client_id = "test_client_id"
    
    config = {
        "clipCount": 2,
        "targetDuration": 15.0,
        "language": "pt",
        "subtitleStyle": {
            "fontName": "Arial",
            "fontSize": 40,
            "primaryColor": "&H00FFFFFF",
            "highlightColor": "&H0008B3EA"
        },
        "reframeMode": "blur",
        "whisperModel": "small",
        "breathPadding": 0.05
    }
    
    logger.info("Initializing test job...")
    store.create_job(project_id, job_id, filename, config)
    
    # Progress callback mock
    async def progress_cb(stage: str, progress: int, message: str):
        logger.info(f"PROGRESS MOCK - Stage: {stage} | Progress: {progress}% | Message: {message}")
        
    pipeline = ShortsPipeline()
    
    logger.info("Running pipeline analysis...")
    await pipeline.run_analysis(project_id, job_id, client_id, progress_cb)
    
    logger.info("Analysis complete! Fetching generated clips...")
    clips = store.get_clips(project_id, job_id)
    for idx, c in enumerate(clips):
        logger.info(f"Clip {idx+1}: ID={c['id']}, Range={c['start_sec']}s - {c['end_sec']}s, Headline='{c['headline']}'")
        
    if clips:
        clip_id_to_render = clips[0]["id"]
        logger.info(f"Rendering first clip: {clip_id_to_render}...")
        render_result = render_clip(project_id, job_id, clip_id_to_render)
        logger.info(f"Render complete! Result: {render_result}")
    else:
        logger.error("No clips were generated.")

if __name__ == "__main__":
    asyncio.run(test_run())
