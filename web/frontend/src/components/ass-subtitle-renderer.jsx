import JASSUB from 'jassub';
import { memo, useEffect, useRef, useState } from 'react';

import { buildBurnStyle, generateAssSubtitles } from '../lib/subtitles.js';

function AssSubtitleRendererInner({
  videoElement,
  enabled,
  subtitles,
  subtitleStyle,
  onFailureChange,
}) {
  const rendererRef = useRef(null);
  const [canvasElement, setCanvasElement] = useState(null);
  const [videoMetrics, setVideoMetrics] = useState({
    videoWidth: 0,
    videoHeight: 0,
    displayScale: 1,
  });

  const playRes = {
    width: videoMetrics.videoWidth || videoElement?.videoWidth || 1920,
    height: videoMetrics.videoHeight || videoElement?.videoHeight || 1080,
  };
  const burnStyle = buildBurnStyle(subtitleStyle, videoMetrics.displayScale);
  const trackContent = generateAssSubtitles(enabled ? subtitles : [], burnStyle, playRes);

  useEffect(() => {
    if (!videoElement) return undefined;

    function measureVideo() {
      const rect = videoElement.getBoundingClientRect();
      const renderedWidth = rect.width || videoElement.clientWidth || 0;
      const renderedHeight = rect.height || videoElement.clientHeight || 0;
      const videoWidth = videoElement.videoWidth || 0;
      const videoHeight = videoElement.videoHeight || 0;
      const widthScale = renderedWidth > 0 && videoWidth > 0 ? videoWidth / renderedWidth : 0;
      const heightScale = renderedHeight > 0 && videoHeight > 0 ? videoHeight / renderedHeight : 0;
      const scale = Math.min(widthScale || Infinity, heightScale || Infinity);
      const displayScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

      setVideoMetrics((prev) => {
        if (
          prev.videoWidth === videoWidth
          && prev.videoHeight === videoHeight
          && Math.abs(prev.displayScale - displayScale) < 0.01
        ) {
          return prev;
        }
        return {
          videoWidth,
          videoHeight,
          displayScale,
        };
      });
    }

    const resizeObserver = new ResizeObserver(measureVideo);
    resizeObserver.observe(videoElement);
    videoElement.addEventListener('loadedmetadata', measureVideo);
    window.addEventListener('resize', measureVideo);
    measureVideo();

    return () => {
      resizeObserver.disconnect();
      videoElement.removeEventListener('loadedmetadata', measureVideo);
      window.removeEventListener('resize', measureVideo);
    };
  }, [videoElement]);

  useEffect(() => {
    if (!videoElement || !canvasElement) return undefined;

    let cancelled = false;

    async function ensureRenderer() {
      if (rendererRef.current) return;

      try {
        const renderer = new JASSUB({
          video: videoElement,
          canvas: canvasElement,
          subContent: '',
          queryFonts: 'local',
        });

        rendererRef.current = renderer;
        await renderer.ready;
        if (cancelled) {
          rendererRef.current = null;
          await renderer.destroy();
          return;
        }

        await renderer.resize(true);
        onFailureChange(false);
      } catch (error) {
        if (cancelled) return;
        rendererRef.current = null;
        console.error('ASS preview renderer failed to initialize', error);
        onFailureChange(true);
      }
    }

    void ensureRenderer();

    return () => {
      cancelled = true;
      const renderer = rendererRef.current;
      rendererRef.current = null;
      if (renderer) {
        void renderer.destroy().catch(() => {});
      }
    };
  }, [canvasElement, onFailureChange, videoElement]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return undefined;

    let cancelled = false;

    async function syncTrack() {
      try {
        await renderer.ready;
        if (cancelled) return;
        await renderer.renderer.setTrack(trackContent);
        if (cancelled) return;
        await renderer.resize(true);
        onFailureChange(false);
      } catch (error) {
        if (cancelled) return;
        console.error('ASS preview renderer failed to update track', error);
        onFailureChange(true);
      }
    }

    void syncTrack();

    return () => {
      cancelled = true;
    };
  }, [enabled, onFailureChange, playRes.height, playRes.width, trackContent]);

  return (
    <canvas
      ref={setCanvasElement}
      aria-hidden="true"
      className="absolute inset-0 m-auto pointer-events-none z-[12]"
      style={{ display: enabled ? 'block' : 'none' }}
    />
  );
}

export const AssSubtitleRenderer = memo(AssSubtitleRendererInner);
