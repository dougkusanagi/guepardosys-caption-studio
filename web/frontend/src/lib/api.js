const BASE_URL = '';

export async function uploadVideo(file, { onUploadProgress, onProcessingState } = {}) {
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

export function removeSilence(params) {
  return postJson('/api/process/remove-silence', params, 'Processing failed');
}

export function generateSubtitles(params) {
  return postJson('/api/process/subtitles', params, 'Subtitle generation failed');
}

export function burnSubtitles(params) {
  return postJson('/api/process/burn-subtitles', params, 'Burn subtitles failed');
}

export function cropVideoRequest(params) {
  return postJson('/api/process/crop', params, 'Crop failed');
}

export async function exportVideo(params) {
  const res = await fetch(`${BASE_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
}

export function saveProject(data) {
  return postJson('/api/project/save', data, 'Save failed');
}

export async function loadProject(projectName) {
  const res = await fetch(`${BASE_URL}/api/project/load/${encodeURIComponent(projectName)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Load failed');
  }
  return res.json();
}

export async function listProjects() {
  const res = await fetch(`${BASE_URL}/api/project/list`);
  if (!res.ok) throw new Error('Failed to list projects');
  return res.json();
}

export async function deleteProject(projectName) {
  const res = await fetch(`${BASE_URL}/api/project/delete/${encodeURIComponent(projectName)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}
