/**
 * API Client Module
 * Centralized API communication
 */

const BASE_URL = '';

export async function uploadVideo(file, onProgress) {
  const formData = new FormData();
  formData.append('video', file);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/api/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

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
  const res = await fetch(`${BASE_URL}/api/process/remove-silence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Processing failed');
  }
  return res.json();
}

export async function generateSubtitles(params) {
  const res = await fetch(`${BASE_URL}/api/process/subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Subtitle generation failed');
  }
  return res.json();
}

export async function burnSubtitles(params) {
  const res = await fetch(`${BASE_URL}/api/process/burn-subtitles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Burn subtitles failed');
  }
  return res.json();
}

export async function cropVideoRequest(params) {
  const res = await fetch(`${BASE_URL}/api/process/crop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Crop failed');
  }
  return res.json();
}

export async function exportVideo(params) {
  const res = await fetch(`${BASE_URL}/api/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  return blob;
}

// --- Project Save/Load ---

export async function saveProject(data) {
  const res = await fetch(`${BASE_URL}/api/project/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Save failed');
  }
  return res.json();
}

export async function loadProject(projectName) {
  const res = await fetch(`${BASE_URL}/api/project/load/${encodeURIComponent(projectName)}`);
  if (!res.ok) {
    const err = await res.json();
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
