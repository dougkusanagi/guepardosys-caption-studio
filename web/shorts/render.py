import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any

from web.services import ffmpeg_svc, subtitle_svc
from web.shorts import store

logger = logging.getLogger(__name__)

# The uploads/processed directories
UPLOADS_DIR = Path(__file__).parent.parent / "uploads"
PROCESSED_DIR = Path(__file__).parent.parent / "processed"


def map_time_to_cut_timeline(t: float, intervals: list[tuple[float, float]]) -> float:
    """Map a timestamp from the original video timeline to the silence-removed timeline."""
    cumulative_time = 0.0
    for start, end in intervals:
        if start <= t <= end:
            return cumulative_time + (t - start)
        elif t < start:
            # If falls in silence, clamp to the start of the next speech segment
            return cumulative_time
        cumulative_time += (end - start)
    return cumulative_time


def compute_silence_removed_intervals(
    words: list[dict],
    clip_start: float,
    clip_end: float,
    breath_padding: float
) -> list[tuple[float, float]]:
    """
    Get the speech intervals within [clip_start, clip_end] with breath padding applied,
    narrowing down silent gaps.
    """
    # 1. Collect all words in the range, ignoring music notes, sound descriptions and noise
    clip_words = []
    for w in words:
        w_start = float(w.get("start", 0))
        w_end = float(w.get("end", 0))
        
        # Check if the word overlaps with the clip range
        if w_end > clip_start and w_start < clip_end:
            word_text = w.get("word", "")
            cleaned = word_text.strip().lower()
            # Clean symbols for comparison
            cleaned_clean = re.sub(r'[^\w\s♪♫♩♬\[\]()]', '', cleaned)
            if not cleaned_clean:
                continue
            # Filter music symbols
            if any(sym in cleaned_clean for sym in ["♪", "♫", "♩", "♬"]):
                continue
            # Filter music/lyrics markers
            if "música" in cleaned_clean or "music" in cleaned_clean:
                continue
            # Filter action/noise markers in brackets or parenthesis
            if (cleaned_clean.startswith("[") and cleaned_clean.endswith("]")) or (cleaned_clean.startswith("(") and cleaned_clean.endswith(")")):
                continue
            clip_words.append(w)
    
    if not clip_words:
        # No words found, return the full clip range as a single interval
        return [(clip_start, clip_end)]
        
    # 2. Build initial intervals around each word with half padding on each side
    raw_intervals = []
    for w in clip_words:
        w_start = float(w["start"])
        w_end = float(w["end"])
        
        # Apply padding on each side
        s = max(clip_start, w_start - breath_padding)
        e = min(clip_end, w_end + breath_padding)
        if e > s:
            raw_intervals.append((s, e))
            
    if not raw_intervals:
        return [(clip_start, clip_end)]
        
    # 3. Merge overlapping or close intervals
    raw_intervals.sort(key=lambda x: x[0])
    merged = [list(raw_intervals[0])]
    for cur_start, cur_end in raw_intervals[1:]:
        last = merged[-1]
        # Since we applied padding, if they overlap or touch, merge them
        if cur_start <= last[1]:
            last[1] = max(last[1], cur_end)
        else:
            merged.append([cur_start, cur_end])
            
    return [(round(s, 3), round(e, 3)) for s, e in merged]


def render_clip(project_id: str, job_id: str, clip_id: str) -> dict[str, Any]:
    """
    Render a single clip:
    1. Cut silence (breath removal)
    2. Reframe (center crop/blur background)
    3. Generate and burn subtitles
    """
    logger.info(f"Rendering clip {clip_id} for project {project_id}...")
    
    # 1. Fetch clip and job info from database
    clip = None
    with store.get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM shorts_clips WHERE id = ?", (clip_id,))
        row = cursor.fetchone()
        if row:
            clip = dict(row)
            
    if not clip:
        raise ValueError(f"Clip {clip_id} not found in database.")
        
    job = store.get_job(project_id, job_id)
    if not job:
        raise ValueError(f"Job {job_id} not found.")
        
    config = job.get("config", {})
    breath_padding = float(config.get("breathPadding", 0.1))
    reframe_mode = config.get("reframeMode", "smart")
    subtitle_style = config.get("subtitleStyle", {})
    
    # Paths
    filename = job["filename"]
    video_path = UPLOADS_DIR / filename
    work_dir = PROCESSED_DIR / project_id / "shorts"
    work_dir.mkdir(parents=True, exist_ok=True)
    
    # Get raw transcription artifact
    artifacts = store.get_artifacts(project_id, job_id)
    transcription_path_str = artifacts.get("shorts:transcribe")
    if not transcription_path_str or not Path(transcription_path_str).exists():
        raise FileNotFoundError("Raw transcription artifact not found. Please re-run analysis.")
        
    with open(transcription_path_str, "r", encoding="utf-8") as f:
        transcription = json.load(f)
        
    # Extract all words from transcription
    all_words = []
    for seg in transcription.get("segments", []):
        for w in seg.get("words", []):
            all_words.append(w)
            
    # 2. Compute the silence-removed intervals for this clip
    clip_start = float(clip["start_sec"])
    clip_end = float(clip["end_sec"])
    intervals = compute_silence_removed_intervals(all_words, clip_start, clip_end, breath_padding)
    
    # 3. Filter and map subtitles
    clip_subtitles = []
    for seg in transcription.get("segments", []):
        seg_start = float(seg["start"])
        seg_end = float(seg["end"])
        
        # Check if the segment overlaps with the clip range
        if seg_start < clip_end and seg_end > clip_start:
            # Clamp boundaries to clip range
            sub_start = max(clip_start, seg_start)
            sub_end = min(clip_end, seg_end)
            
            # Map start/end to new timeline
            mapped_start = map_time_to_cut_timeline(sub_start, intervals)
            mapped_end = map_time_to_cut_timeline(sub_end, intervals)
            
            # Filter and map words
            mapped_words = []
            for w in seg.get("words", []):
                w_start = float(w["start"])
                w_end = float(w["end"])
                if clip_start <= w_start <= clip_end:
                    mapped_words.append({
                        "word": w["word"],
                        "start": map_time_to_cut_timeline(w_start, intervals),
                        "end": map_time_to_cut_timeline(w_end, intervals)
                    })
                    
            if mapped_end > mapped_start:
                clip_subtitles.append({
                    "start": mapped_start,
                    "end": mapped_end,
                    "text": seg["text"],
                    "words": mapped_words
                })
                
    # Generate ASS subtitle file
    ass_path = work_dir / f"subs_{clip_id}.ass"
    # Ensure vertical subtitle layout presets
    if "fontSize" not in subtitle_style:
        subtitle_style["fontSize"] = 42
    if "positionY" not in subtitle_style:
        subtitle_style["positionY"] = 75  # Safe zone vertical alignment
        
    subtitle_svc.write_ass(clip_subtitles, ass_path, style=subtitle_style, play_res=(1080, 1920))
    
    # 4. Run FFmpeg command to cut, reframe and burn subtitles in a single execution
    output_name = f"short_{clip_id}_{uuid.uuid4().hex[:6]}.mp4"
    output_path = work_dir / output_name
    
    # Check video properties to see if landscape or vertical
    video_info = ffmpeg_svc.get_video_info(video_path)
    video_stream = video_info.get("video")
    is_landscape = True
    if video_stream:
        w = video_stream.get("width", 1920)
        h = video_stream.get("height", 1080)
        if w / h <= 0.6:  # already 9:16 vertical
            is_landscape = False
            
    # Resolve reframing filter
    if is_landscape:
        if reframe_mode == "blur":
            # Scale background to fill 1080x1920, blur it, scale foreground to fit, overlay it
            reframe_vf = (
                "split=2[bg][fg];"
                "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=30:10[bg_blurred];"
                "[fg]scale=1080:1920:force_original_aspect_ratio=decrease[fg_scaled];"
                "[bg_blurred][fg_scaled]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2"
            )
        else:
            # Default to center crop
            reframe_vf = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920"
    else:
        # Just normalize/scale to 1080x1920
        reframe_vf = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(1080-iw)/2:(1920-ih)/2"

    # Build single filter complex
    filter_complex = ffmpeg_svc.build_filter_complex(intervals)
    
    # Resolve ASS subtitle filter path for FFmpeg (needs escape)
    escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:")
    
    # Chain reframe and ASS burning onto the output of cut concat
    filter_complex += f";[outv]{reframe_vf},ass='{escaped_ass}'[outv_final]"
    
    ffmpeg_bin = ffmpeg_svc._resolve_binary("ffmpeg")
    cmd = [
        ffmpeg_bin, "-y", "-i", str(video_path),
        "-filter_complex", filter_complex,
        "-map", "[outv_final]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-c:a", "aac", "-b:a", "192k",
        str(output_path)
    ]
    
    logger.info(f"Executing FFmpeg render cmd for {clip_id}...")
    try:
        ffmpeg_svc._run(cmd, error_message=f"Falha ao renderizar clipe {clip_id}")
    finally:
        # Clean up temporary ASS file
        ass_path.unlink(missing_ok=True)
        
    # Update clip output path and status in database
    relative_output_path = f"/processed/{project_id}/shorts/{output_name}"
    with store.get_db(project_id) as conn:
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE shorts_clips SET output_path = ?, status = 'done' WHERE id = ?",
            (relative_output_path, clip_id)
        )
        conn.commit()
        
    return {
        "clipId": clip_id,
        "outputPath": relative_output_path,
        "status": "done"
    }
