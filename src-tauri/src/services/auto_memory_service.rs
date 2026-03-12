//! 自动记忆服务
//!
//! 提供自动记忆目录定位、入口索引读取与笔记更新能力。

use chrono::Local;
use proxycast_core::app_paths;
use proxycast_core::config::{MemoryAutoConfig, MemoryConfig};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// 自动记忆索引项
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoMemoryIndexItem {
    pub title: String,
    pub relative_path: String,
    pub exists: bool,
    pub summary: Option<String>,
}

/// 自动记忆索引响应
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoMemoryIndexResponse {
    pub enabled: bool,
    pub root_dir: String,
    pub entrypoint: String,
    pub max_loaded_lines: u32,
    pub entry_exists: bool,
    pub total_lines: u32,
    pub preview_lines: Vec<String>,
    pub items: Vec<AutoMemoryIndexItem>,
}

/// 读取自动记忆索引
pub fn get_auto_memory_index(
    memory_config: &MemoryConfig,
    working_dir: &Path,
) -> Result<AutoMemoryIndexResponse, String> {
    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        "MEMORY.md"
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);

    let mut response = AutoMemoryIndexResponse {
        enabled: auto.enabled,
        root_dir: root_dir.to_string_lossy().to_string(),
        entrypoint: entry_name.to_string(),
        max_loaded_lines: auto.max_loaded_lines,
        entry_exists: entry_path.is_file(),
        total_lines: 0,
        preview_lines: Vec::new(),
        items: Vec::new(),
    };

    if !entry_path.is_file() {
        return Ok(response);
    }

    let raw = fs::read_to_string(&entry_path)
        .map_err(|e| format!("读取自动记忆入口失败 {}: {e}", entry_path.display()))?;
    let lines: Vec<String> = raw.lines().map(|s| s.to_string()).collect();
    response.total_lines = lines.len() as u32;
    response.preview_lines = lines
        .iter()
        .take(auto.max_loaded_lines as usize)
        .cloned()
        .collect();
    response.items = parse_index_items(&lines, &root_dir);

    Ok(response)
}

/// 更新自动记忆笔记
pub fn update_auto_memory_note(
    memory_config: &MemoryConfig,
    working_dir: &Path,
    note: &str,
    topic: Option<&str>,
) -> Result<AutoMemoryIndexResponse, String> {
    let trimmed_note = note.trim();
    if trimmed_note.is_empty() {
        return Err("note 不能为空".to_string());
    }

    let auto = &memory_config.auto;
    let root_dir = resolve_auto_memory_root(working_dir, auto);
    fs::create_dir_all(&root_dir)
        .map_err(|e| format!("创建自动记忆目录失败 {}: {e}", root_dir.display()))?;

    let entry_name = auto.entrypoint.trim();
    let entry_name = if entry_name.is_empty() {
        "MEMORY.md"
    } else {
        entry_name
    };
    let entry_path = root_dir.join(entry_name);

    if let Some(topic_name) = topic.map(str::trim).filter(|v| !v.is_empty()) {
        let topic_file = normalize_topic_filename(topic_name);
        let topic_path = root_dir.join(&topic_file);
        append_topic_note(&topic_path, topic_name, trimmed_note)?;
        ensure_entry_link(&entry_path, topic_name, &topic_file)?;
    } else {
        append_entry_note(&entry_path, trimmed_note)?;
    }

    get_auto_memory_index(memory_config, working_dir)
}

/// 解析自动记忆根目录
pub fn resolve_auto_memory_root(working_dir: &Path, auto: &MemoryAutoConfig) -> PathBuf {
    if let Some(custom_root) = auto.root_dir.as_deref().map(str::trim) {
        if !custom_root.is_empty() {
            return expand_path(custom_root, Some(working_dir));
        }
    }

    let project_anchor = find_git_root(working_dir).unwrap_or_else(|| working_dir.to_path_buf());
    let slug = project_anchor
        .to_string_lossy()
        .replace(['\\', '/', ':', ' '], "_")
        .trim_matches('_')
        .to_string();
    let project_slug = if slug.is_empty() {
        "default".to_string()
    } else {
        slug
    };

    app_paths::best_effort_runtime_subdir("projects")
        .join(project_slug)
        .join("memory")
}

fn parse_index_items(lines: &[String], root_dir: &Path) -> Vec<AutoMemoryIndexItem> {
    let mut items = Vec::new();

    for line in lines {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Markdown link: - [title](path)
        if let Some((title, relative_path)) = parse_markdown_link(trimmed) {
            let path = root_dir.join(&relative_path);
            items.push(AutoMemoryIndexItem {
                title,
                relative_path,
                exists: path.is_file(),
                summary: None,
            });
            continue;
        }

        // import 风格：@topic.md
        if let Some(import_target) = trimmed.strip_prefix('@') {
            let relative_path = import_target.trim().to_string();
            if relative_path.is_empty() {
                continue;
            }
            let path = root_dir.join(&relative_path);
            items.push(AutoMemoryIndexItem {
                title: relative_path.clone(),
                relative_path,
                exists: path.is_file(),
                summary: None,
            });
        }
    }

    items
}

fn parse_markdown_link(line: &str) -> Option<(String, String)> {
    let cleaned = line
        .trim_start_matches("- ")
        .trim_start_matches("* ")
        .trim();
    let title_start = cleaned.find('[')?;
    let title_end = cleaned[title_start + 1..].find(']')? + title_start + 1;
    let path_start = cleaned[title_end + 1..].find('(')? + title_end + 1;
    let path_end = cleaned[path_start + 1..].find(')')? + path_start + 1;

    let title = cleaned[title_start + 1..title_end].trim().to_string();
    let path = cleaned[path_start + 1..path_end].trim().to_string();
    if title.is_empty() || path.is_empty() {
        return None;
    }
    Some((title, path))
}

fn append_entry_note(entry_path: &Path, note: &str) -> Result<(), String> {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let line = format!("- [{timestamp}] {note}\n");
    let mut existing = if entry_path.is_file() {
        fs::read_to_string(entry_path)
            .map_err(|e| format!("读取 MEMORY 入口失败 {}: {e}", entry_path.display()))?
    } else {
        "# Auto Memory Index\n\n".to_string()
    };
    if !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&line);
    fs::write(entry_path, existing)
        .map_err(|e| format!("写入 MEMORY 入口失败 {}: {e}", entry_path.display()))
}

fn append_topic_note(topic_path: &Path, topic_name: &str, note: &str) -> Result<(), String> {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
    let mut content = if topic_path.is_file() {
        fs::read_to_string(topic_path)
            .map_err(|e| format!("读取主题记忆失败 {}: {e}", topic_path.display()))?
    } else {
        format!("# {topic_name}\n\n")
    };
    if !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!("## {timestamp}\n\n{note}\n\n"));
    fs::write(topic_path, content)
        .map_err(|e| format!("写入主题记忆失败 {}: {e}", topic_path.display()))
}

fn ensure_entry_link(entry_path: &Path, topic_name: &str, topic_file: &str) -> Result<(), String> {
    let mut content = if entry_path.is_file() {
        fs::read_to_string(entry_path)
            .map_err(|e| format!("读取 MEMORY 入口失败 {}: {e}", entry_path.display()))?
    } else {
        "# Auto Memory Index\n\n".to_string()
    };
    let marker = format!("({topic_file})");
    if !content.contains(&marker) {
        if !content.ends_with('\n') {
            content.push('\n');
        }
        content.push_str(&format!("- [{topic_name}]({topic_file})\n"));
    }
    fs::write(entry_path, content)
        .map_err(|e| format!("写入 MEMORY 入口失败 {}: {e}", entry_path.display()))
}

fn normalize_topic_filename(topic: &str) -> String {
    let lowered = topic.trim().to_lowercase();
    let mut slug = String::with_capacity(lowered.len() + 3);
    for ch in lowered.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
        } else if ch == '-' || ch == '_' || ch == ' ' {
            slug.push('-');
        }
    }
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        "notes.md".to_string()
    } else if slug.ends_with(".md") {
        slug.to_string()
    } else {
        format!("{slug}.md")
    }
}

fn expand_path(path: &str, working_dir: Option<&Path>) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(path.trim_start_matches("~/"));
        }
    }

    let p = PathBuf::from(path);
    if p.is_absolute() {
        return p;
    }

    if let Some(base) = working_dir {
        return base.join(p);
    }
    p
}

fn find_git_root(start: &Path) -> Option<PathBuf> {
    let mut current = if start.is_file() {
        start.parent()?.to_path_buf()
    } else {
        start.to_path_buf()
    };

    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn should_create_entry_when_update_note_without_topic() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result =
            update_auto_memory_note(&cfg, tmp.path(), "记下这个偏好", None).expect("update note");
        assert!(result.entry_exists);
        assert!(!result.preview_lines.is_empty());
    }

    #[test]
    fn should_add_topic_and_index_link() {
        let tmp = TempDir::new().expect("create temp dir");
        let mut cfg = MemoryConfig::default();
        cfg.auto.root_dir = Some(tmp.path().to_string_lossy().to_string());
        cfg.auto.entrypoint = "MEMORY.md".to_string();
        cfg.auto.enabled = true;

        let result = update_auto_memory_note(&cfg, tmp.path(), "pnpm only", Some("workflow"))
            .expect("update topic note");
        assert!(result
            .items
            .iter()
            .any(|item| item.relative_path == "workflow.md"));
    }
}
