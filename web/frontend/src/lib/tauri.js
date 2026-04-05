const { invoke } = window.__TAURI__?.core || {};
const { listen } = window.__TAURI__?.event || {};

let _isTauri = typeof window !== 'undefined' && !!window.__TAURI__;

export function init() {
  _isTauri = !!window.__TAURI__;
  return _isTauri;
}

export function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI__;
}

export async function getAppDataDir() {
  if (!_isTauri) return '';
  return invoke('get_app_data_dir');
}

export async function openFilePicker() {
  if (!_isTauri) return null;
  const { open } = window.__TAURI__?.dialog || {};
  return open({
    multiple: false,
    filters: [{
      name: 'Video',
      extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'flv', 'wmv'],
    }],
  });
}

export async function onProgress(callback) {
  if (!_isTauri) return () => {};
  return listen('processing_progress', (event) => {
    callback(event.payload);
  });
}

export async function onModelDownloadProgress(callback) {
  if (!_isTauri) return () => {};
  return listen('model_download_progress', (event) => {
    callback(event.payload);
  });
}

// --- Tauri command wrappers ---

export async function uploadVideo(path) {
  return invoke('upload_video', { path });
}

export async function removeSilence(params) {
  return invoke('remove_silence', {
    req: {
      filename: params.filename,
      projectId: params.projectId,
      clientId: params.clientId || '',
      model: params.model || 'small',
      language: params.language || 'pt',
      minGap: params.minGap ?? 0.8,
      padStart: params.padStart ?? 0.12,
      padEnd: params.padEnd ?? 0.18,
      minKeep: params.minKeep ?? 0.12,
    },
  });
}

export async function generateSubtitles(params) {
  return invoke('generate_subtitles', {
    req: {
      filename: params.filename,
      projectId: params.projectId,
      clientId: params.clientId || '',
      model: params.model || 'small',
      language: params.language || 'pt',
      style: params.style || null,
    },
  });
}

export async function burnSubtitles(params) {
  return invoke('burn_subtitles', {
    req: {
      filename: params.filename,
      projectId: params.projectId,
      clientId: params.clientId || '',
      sourceFile: params.sourceFile || '',
      subtitles: params.subtitles || null,
      style: params.style || null,
    },
  });
}

export async function cropVideo(params) {
  return invoke('crop_video', {
    req: {
      filename: params.filename,
      projectId: params.projectId,
      clientId: params.clientId || '',
      x: params.x,
      y: params.y,
      width: params.width,
      height: params.height,
    },
  });
}

export async function exportVideo(params) {
  return invoke('export_video', {
    req: {
      projectId: params.projectId,
      sourceFile: params.sourceFile,
      originalName: params.originalName || null,
      subtitleContent: params.subtitleContent || null,
      subtitles: params.subtitles || null,
      style: params.style || null,
    },
  });
}

export async function saveProject(data) {
  return invoke('save_project', { data });
}

export async function saveProjectDialog(data) {
  return invoke('save_project_dialog', { data });
}

export async function listProjects() {
  return invoke('list_projects');
}

export async function loadProject(name) {
  return invoke('load_project', { projectName: name });
}

export async function deleteProject(name) {
  return invoke('delete_project', { projectName: name });
}

export async function listPresets() {
  return invoke('list_presets');
}

export async function createPreset(name, style) {
  return invoke('create_preset', { name, style });
}

export async function updatePreset(id, data) {
  return invoke('update_preset', {
    presetId: id,
    name: data.name || null,
    style: data.style || null,
  });
}

export async function deletePreset(id) {
  return invoke('delete_preset', { presetId: id });
}

export async function listModels() {
  return invoke('list_models');
}

export async function downloadModel(model) {
  return invoke('download_model', { model });
}

export async function sendNotification(title, body) {
  return invoke('send_notification', { title, body });
}
