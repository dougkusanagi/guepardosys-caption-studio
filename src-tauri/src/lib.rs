use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::CommandChild;

struct BackendState(Mutex<Option<CommandChild>>);

#[tauri::command]
async fn export_video_to_local(
  project_id: String,
  source_file: String,
  default_name: String,
) -> Result<String, String> {
  // 1. Abre a caixa de diálogo nativa para salvar arquivo
  let file_handle = rfd::AsyncFileDialog::new()
    .set_file_name(&default_name)
    .add_filter("Vídeo MP4", &["mp4"])
    .save_file()
    .await;

  let dest_path = match file_handle {
    Some(handle) => handle.path().to_path_buf(),
    None => return Ok("cancelled".to_string()),
  };

  // 2. Faz o download do vídeo gerado diretamente do servidor backend local
  let client = reqwest::Client::new();

  #[derive(serde::Serialize)]
  struct ExportPayload {
    #[serde(rename = "projectId")]
    project_id: String,
    #[serde(rename = "sourceFile")]
    source_file: String,
  }

  let payload = ExportPayload {
    project_id,
    source_file,
  };

  let response = client.post("http://127.0.0.1:3000/api/export")
    .json(&payload)
    .send()
    .await
    .map_err(|e| format!("Erro de conexão com o backend: {}", e))?;

  if !response.status().is_success() {
    let error_text = response.text().await.unwrap_or_default();
    return Err(format!("Falha no backend ao exportar: {}", error_text));
  }

  // 3. Salva o stream de bytes no destino escolhido
  let mut file = std::fs::File::create(&dest_path)
    .map_err(|e| format!("Não foi possível criar o arquivo de destino: {}", e))?;

  let content = response.bytes().await
    .map_err(|e| format!("Erro ao baixar dados do vídeo: {}", e))?;

  use std::io::Write;
  file.write_all(&content)
    .map_err(|e| format!("Erro ao escrever o arquivo no disco: {}", e))?;

  Ok("success".to_string())
}

#[tauri::command]
async fn pick_directory() -> Result<String, String> {
  let folder_handle = rfd::AsyncFileDialog::new()
    .pick_folder()
    .await;

  match folder_handle {
    Some(handle) => Ok(handle.path().to_string_lossy().to_string()),
    None => Ok("cancelled".to_string()),
  }
}

#[tauri::command]
async fn save_file_to_directory(
  source_url: String,
  target_dir: String,
  file_name: String,
) -> Result<String, String> {
  let client = reqwest::Client::new();
  let response = client.get(&source_url)
    .send()
    .await
    .map_err(|e| format!("Erro de conexão com o backend: {}", e))?;

  if !response.status().is_success() {
    return Err(format!("Falha ao obter o arquivo do backend: {}", response.status()));
  }

  let dest_path = std::path::Path::new(&target_dir).join(&file_name);
  
  let mut file = std::fs::File::create(&dest_path)
    .map_err(|e| format!("Não foi possível criar o arquivo de destino: {}", e))?;

  let content = response.bytes().await
    .map_err(|e| format!("Erro ao obter bytes do vídeo: {}", e))?;

  use std::io::Write;
  file.write_all(&content)
    .map_err(|e| format!("Erro ao escrever o arquivo no disco: {}", e))?;

  Ok("success".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      export_video_to_local,
      pick_directory,
      save_file_to_directory
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Registra o estado para gerenciar o sidecar
      app.manage(BackendState(Mutex::new(None)));

      #[cfg(not(debug_assertions))]
      {
        use tauri_plugin_shell::ShellExt;
        let sidecar = app.shell().sidecar("backend");
        match sidecar {
          Ok(cmd) => {
            match cmd.spawn() {
              Ok((mut rx, child)) => {
                // Armazena o child no estado gerenciado
                if let Some(state) = app.try_state::<BackendState>() {
                  if let Ok(mut guard) = state.0.lock() {
                    *guard = Some(child);
                  }
                }

                // Cria uma task assíncrona para consumir a saída (stdout/stderr) do sidecar,
                // prevenindo que o buffer do pipe do sistema operacional encha e trave o processo.
                tauri::async_runtime::spawn(async move {
                  while let Some(_event) = rx.recv().await {
                    // Drena os eventos continuamente
                  }
                });
              }
              Err(e) => {
                eprintln!("Falha ao iniciar o sidecar do backend: {:?}", e);
              }
            }
          }
          Err(e) => {
            eprintln!("Falha ao instanciar o sidecar: {:?}", e);
          }
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  // Roda a aplicação tauri e intercepta o encerramento para finalizar o backend
  app.run(|app_handle, event| {
    if let tauri::RunEvent::ExitRequested { .. } = event {
      if let Some(state) = app_handle.try_state::<BackendState>() {
        if let Ok(mut guard) = state.0.lock() {
          if let Some(child) = guard.take() {
            let _ = child.kill();
          }
        }
      }
    }
  });
}

