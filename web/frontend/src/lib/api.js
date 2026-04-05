import * as tauri from './tauri';

let _mode = typeof window !== 'undefined' && window.__TAURI__ ? 'tauri' : 'browser';

export async function init() {
  const isT = tauri.init();
  _mode = isT ? 'tauri' : 'browser';
  return isT;
}

function isTauri() {
  return typeof window !== 'undefined' && window.__TAURI__ ? true : _mode === 'tauri';
}

const BASE_URL = '';

export async function uploadVideo(file, { onUploadProgress, onProcessingState } = {}) {
  if (isTauri()) {
    const path = typeof file === 'string' ? file : file.path;
    if (!path) throw new Error('File path not available in Tauri mode. Use file dialog.');
    onUploadProgress?.(10);
    const result = await tauri.uploadVideo(path);
    onUploadProgress?.(100);
    onProcessingState?.();
    return result;
  }

  const formData = new FormData();
  formData.append('video', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let processingNotified = false;
    xhr.open('POST', `${BASE_URL}/api/upload`);

    function notifyProcessing() {
      if (processingNotified) return;
      processingNotified = true;
      onProcessingState?.();
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onUploadProgress) {
        onUploadProgress(Math.round((event.loaded / event.total) * 100));
      }
      if (event.lengthComputable && event.loaded >= event.total) notifyProcessing();
    };
    xhr.upload.onload = notifyProcessing;
    xhr.upload.onloadend = notifyProcessing;

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error || 'Upload failed'));
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

export async function removeSilence(params) {
  if (isTauri()) return tauri.removeSilence(params);
  return postJson('/api/process/remove-silence', params, 'Processing failed');
}

export async function generateSubtitles(params) {
  if (isTauri()) return tauri.generateSubtitles(params);
  return postJson('/api/process/subtitles', params, 'Subtitle generation failed');
}

export async function burnSubtitles(params) {
  if (isTauri()) return tauri.burnSubtitles(params);
  return postJson('/api/process/burn-subtitles', params, 'Burn subtitles failed');
}

export async function cropVideoRequest(params) {
  if (isTauri()) return tauri.cropVideo(params);
  return postJson('/api/process/crop', params, 'Crop failed');
}

export async function exportVideo(params) {
  if (isTauri()) {
    return tauri.exportVideo(params);
  }
  const res = await fetch(`${BASE_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}

export async function saveProject(data) {
  if (isTauri()) return tauri.saveProject(data);
  return postJson('/api/project/save', data, 'Save failed');
}

export async function saveProjectDialog(data) {
  if (isTauri()) return tauri.saveProjectDialog(data);
  return postJson('/api/project/save', data, 'Save failed');
}

export async function loadProject(projectName) {
  if (isTauri()) return tauri.loadProject(projectName);
  const res = await fetch(`${BASE_URL}/api/project/load/${encodeURIComponent(projectName)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Load failed');
  }
  return res.json();
}

export async function listProjects() {
  if (isTauri()) return tauri.listProjects();
  const res = await fetch(`${BASE_URL}/api/project/list`);
  if (!res.ok) throw new Error('Failed to list projects');
  return res.json();
}

export async function deleteProject(projectName) {
  if (isTauri()) return tauri.deleteProject(projectName);
  const res = await fetch(`${BASE_URL}/api/project/delete/${encodeURIComponent(projectName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

export async function listPresets() {
  if (isTauri()) return tauri.listPresets();
  const res = await fetch(`${BASE_URL}/api/presets`);
  if (!res.ok) throw new Error('Failed to list presets');
  return res.json();
}

export async function createPreset(name, style) {
  if (isTauri()) return tauri.createPreset(name, style);
  const res = await fetch(`${BASE_URL}/api/presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, style }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to create preset');
  }
  return res.json();
}

export async function updatePreset(presetId, data) {
  if (isTauri()) return tauri.updatePreset(presetId, data);
  const res = await fetch(`${BASE_URL}/api/presets/${encodeURIComponent(presetId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to update preset');
  }
  return res.json();
}

export async function deletePreset(presetId) {
  if (isTauri()) return tauri.deletePreset(presetId);
  const res = await fetch(`${BASE_URL}/api/presets/${encodeURIComponent(presetId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to delete preset');
  }
  return res.json();
}

export async function listModels() {
  if (isTauri()) return tauri.listModels();
  const res = await fetch(`${BASE_URL}/api/models/list`);
  if (!res.ok) throw new Error('Failed to list models');
  return res.json();
}

export async function downloadModel(modelName) {
  if (isTauri()) return tauri.downloadModel(modelName);
  const res = await fetch(`${BASE_URL}/api/models/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to download model');
  }
  return res.json();
}

export async function sendNativeNotification(title, body) {
  if (isTauri()) return tauri.sendNotification(title, body);
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}

async function postJson(path, payload, defaultError) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || defaultError);
  }

  return res.json();
}
