import logging
from typing import Any

logger = logging.getLogger(__name__)

def group_segments_semantically(segments: list[dict], max_pause_sec: float = 1.5) -> list[dict]:
    """Group short subtitle segments into semantic paragraphs based on silence gaps."""
    if not segments:
        return []
    
    grouped = []
    current_group = []
    
    for seg in segments:
        if not current_group:
            current_group.append(seg)
            continue
        
        last_seg = current_group[-1]
        pause = seg["start_sec"] - last_seg["end_sec"]
        
        # Merge if the pause between segments is small (implies continuous speech)
        if pause < max_pause_sec:
            current_group.append(seg)
        else:
            # Commit the current group as a single paragraph
            grouped.append(build_paragraph_from_group(current_group, len(grouped)))
            current_group = [seg]
            
    if current_group:
        grouped.append(build_paragraph_from_group(current_group, len(grouped)))
        
    return grouped


def build_paragraph_from_group(group: list[dict], index: int) -> dict:
    start = group[0]["start_sec"]
    end = group[-1]["end_sec"]
    text = " ".join([seg["text"] for seg in group]).strip()
    return {
        "index": index,
        "start_sec": start,
        "end_sec": end,
        "text": text
    }


def select_shorts_fallback(
    segments: list[dict], 
    clip_count: int, 
    target_duration: float, 
    total_duration: float
) -> list[dict]:
    """
    Fallback algorithm that groups speech segments and distributes cuts evenly across the video.
    Returns a list of clips compatible with the LLM selection format.
    """
    logger.info(f"Running fallback selection algorithm for {clip_count} clips (target_duration={target_duration}s)...")
    if not segments:
        # Fallback to simple split if no segments at all
        step = total_duration / (clip_count + 1)
        clips = []
        for i in range(clip_count):
            start = max(0.0, (i + 0.5) * step)
            end = min(total_duration, start + target_duration)
            clips.append({
                "id": f"fallback_{i+1}",
                "start_sec": round(start, 2),
                "end_sec": round(end, 2),
                "headline": f"Corte IA #{i+1} (Algoritmo Local)",
                "storytelling_structure": "Corte gerado automaticamente com base na distribuição de tempo do vídeo original."
            })
        return clips

    # Group segments into semantic chunks
    paragraphs = group_segments_semantically(segments, max_pause_sec=2.0)
    
    # Divide the total duration into `clip_count` buckets to select from different parts of the video
    bucket_size = total_duration / clip_count
    clips = []
    
    for i in range(clip_count):
        bucket_start = i * bucket_size
        bucket_end = bucket_start + bucket_size
        
        # Find paragraphs inside this bucket
        bucket_paragraphs = [p for p in paragraphs if bucket_start <= p["start_sec"] < bucket_end]
        
        if not bucket_paragraphs:
            # Fallback to middle of bucket if no paragraphs
            start = max(0.0, bucket_start + (bucket_size - target_duration) / 2)
            end = min(total_duration, start + target_duration)
            clips.append({
                "id": f"fallback_{i+1}",
                "start_sec": round(start, 2),
                "end_sec": round(end, 2),
                "headline": f"Destaque #{i+1} (Duração do Vídeo)",
                "storytelling_structure": f"Corte de fallback posicionado na marca de {start:.1f}s."
            })
            continue
            
        # Select the longest paragraph (or chain of paragraphs) as the highlight of this bucket
        # Let's pick the paragraph with most text
        best_para = max(bucket_paragraphs, key=lambda p: len(p["text"]))
        
        # Center the target duration window around the best paragraph's midpoint
        midpoint = (best_para["start_sec"] + best_para["end_sec"]) / 2
        start = max(0.0, midpoint - target_duration / 2)
        end = min(total_duration, start + target_duration)
        
        # Adjust start and end to align with actual word boundaries if possible
        # Find closest start segment
        closest_start = min(segments, key=lambda s: abs(s["start_sec"] - start))
        closest_end = min(segments, key=lambda s: abs(s["end_sec"] - end))
        
        final_start = closest_start["start_sec"]
        final_end = closest_end["end_sec"]
        
        # Ensure duration constraints
        if final_end - final_start > target_duration * 1.5 or final_end - final_start < target_duration * 0.5:
            final_start = round(start, 2)
            final_end = round(end, 2)
            
        clips.append({
            "id": f"fallback_{i+1}",
            "start_sec": round(final_start, 2),
            "end_sec": round(final_end, 2),
            "headline": f"Destaque #{i+1}: {best_para['text'][:35]}...",
            "storytelling_structure": f"Destaque local baseado na atividade de fala próxima aos {final_start:.1f}s."
        })
        
    return clips
