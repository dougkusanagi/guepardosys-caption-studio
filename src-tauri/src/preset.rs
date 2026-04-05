use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub style: HashMap<String, serde_json::Value>,
}

const DEFAULT_PRESETS: &[(&str, &str, &[(&str, &str)])] = &[
    (
        "default",
        "Padrão",
        &[
            ("fontName", "Arial"),
            ("fontSize", "24"),
            ("primaryColor", "#ffffff"),
            ("outlineColor", "#000000"),
            ("outline", "2"),
            ("shadow", "1"),
            ("alignment", "2"),
            ("positionY", "88"),
            ("areaHeight", "18"),
            ("bold", "false"),
        ],
    ),
    (
        "youtube",
        "YouTube",
        &[
            ("fontName", "Roboto"),
            ("fontSize", "28"),
            ("primaryColor", "#ffffff"),
            ("outlineColor", "#000000"),
            ("outline", "3"),
            ("shadow", "2"),
            ("alignment", "2"),
            ("positionY", "90"),
            ("areaHeight", "16"),
            ("bold", "true"),
        ],
    ),
    (
        "minimal",
        "Minimalista",
        &[
            ("fontName", "Inter"),
            ("fontSize", "22"),
            ("primaryColor", "#ffffff"),
            ("outlineColor", "#000000"),
            ("outline", "1"),
            ("shadow", "0"),
            ("alignment", "2"),
            ("positionY", "88"),
            ("areaHeight", "18"),
            ("bold", "false"),
        ],
    ),
];

fn presets_path(app_data_dir: &Path) -> std::path::PathBuf {
    app_data_dir.join("presets.json")
}

pub fn init_presets(app_data_dir: &Path) -> Result<(), String> {
    let path = presets_path(app_data_dir);
    if !path.exists() {
        let presets: Vec<Preset> = DEFAULT_PRESETS
            .iter()
            .map(|(id, name, style)| {
                let style_map: HashMap<String, serde_json::Value> = style
                    .iter()
                    .map(|(k, v)| {
                        let val = match *v {
                            "true" => serde_json::Value::Bool(true),
                            "false" => serde_json::Value::Bool(false),
                            _ if v.chars().all(|c| c.is_ascii_digit()) => {
                                serde_json::Value::Number(v.parse().unwrap())
                            }
                            _ => serde_json::Value::String(v.to_string()),
                        };
                        (k.to_string(), val)
                    })
                    .collect();
                Preset {
                    id: id.to_string(),
                    name: name.to_string(),
                    style: style_map,
                }
            })
            .collect();

        let json = serde_json::to_string_pretty(&presets).map_err(|e| e.to_string())?;
        std::fs::write(&path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn load_presets(app_data_dir: &Path) -> Result<Vec<Preset>, String> {
    let path = presets_path(app_data_dir);
    if !path.exists() {
        init_presets(app_data_dir)?;
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn save_presets(app_data_dir: &Path, presets: &[Preset]) -> Result<(), String> {
    let path = presets_path(app_data_dir);
    let json = serde_json::to_string_pretty(presets).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn list_presets(app_data_dir: &Path) -> Result<Vec<Preset>, String> {
    load_presets(app_data_dir)
}

pub fn create_preset(
    app_data_dir: &Path,
    name: &str,
    style: HashMap<String, serde_json::Value>,
) -> Result<Preset, String> {
    let mut presets = load_presets(app_data_dir)?;
    let new_preset = Preset {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.to_string(),
        style,
    };
    presets.push(new_preset.clone());
    save_presets(app_data_dir, &presets)?;
    Ok(new_preset)
}

pub fn update_preset(
    app_data_dir: &Path,
    preset_id: &str,
    name: Option<String>,
    style: Option<HashMap<String, serde_json::Value>>,
) -> Result<Preset, String> {
    let mut presets = load_presets(app_data_dir)?;
    for preset in &mut presets {
        if preset.id == preset_id {
            if preset_id == "default" && preset.name == "Padrão" {
                return Err("Não é possível editar o preset padrão".into());
            }
            if let Some(n) = name {
                preset.name = n;
            }
            if let Some(s) = style {
                preset.style = s;
            }
            let cloned = preset.clone();
            save_presets(app_data_dir, &presets)?;
            return Ok(cloned);
        }
    }
    Err("Preset não encontrado".into())
}

pub fn delete_preset(app_data_dir: &Path, preset_id: &str) -> Result<(), String> {
    let mut presets = load_presets(app_data_dir)?;
    let len_before = presets.len();
    presets.retain(|p| p.id != preset_id);
    if presets.len() == len_before {
        return Err("Preset não encontrado".into());
    }
    if preset_id == "default"
        && presets
            .iter()
            .any(|p| p.id == "default" && p.name == "Padrão")
    {
        return Err("Não é possível excluir o preset padrão".into());
    }
    save_presets(app_data_dir, &presets)
}
