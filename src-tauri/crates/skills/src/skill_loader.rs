//! Skill 定义加载器
//!
//! 负责从标准 Agent Skills 包中加载并解析 Skill 定义。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use proxycast_core::app_paths;
use proxycast_core::models::{
    parse_skill_manifest_from_content, split_skill_frontmatter, ParsedSkillManifest,
    SkillStandardCompliance,
};
use proxycast_services::skill_service::SkillService;
use serde::{Deserialize, Serialize};

/// Skill 自动触发条件配置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillTriggerConfig {
    /// 触发条件描述列表（自然语言）
    #[serde(default)]
    pub trigger: Vec<String>,
    /// 不触发条件描述列表
    #[serde(default)]
    pub do_not_trigger: Vec<String>,
}

/// Workflow 步骤定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStep {
    /// 步骤 ID
    pub id: String,
    /// 步骤名称
    pub name: String,
    /// 步骤提示词（作为该步骤的 system_prompt 或追加指令）
    pub prompt: String,
    /// 可选的模型覆盖
    pub model: Option<String>,
    /// 可选的温度参数
    pub temperature: Option<f32>,
    /// 执行模式：prompt（默认）、elicitation
    #[serde(default = "default_step_execution_mode")]
    pub execution_mode: String,
}

fn default_step_execution_mode() -> String {
    "prompt".to_string()
}

/// Skill 前置元数据
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillFrontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub license: Option<String>,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
    pub allowed_tools: Option<Vec<String>>,
    pub argument_hint: Option<String>,
    pub when_to_use: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub disable_model_invocation: Option<String>,
    pub execution_mode: Option<String>,
    pub steps_json: Option<String>,
    pub workflow_ref: Option<String>,
    #[serde(default)]
    pub deprecated_fields: Vec<String>,
    #[serde(default)]
    pub validation_errors: Vec<String>,
}

/// 内部 Skill 定义（用于加载和执行）
#[derive(Debug, Clone)]
pub struct LoadedSkillDefinition {
    pub skill_name: String,
    pub display_name: String,
    pub description: String,
    pub markdown_content: String,
    pub license: Option<String>,
    pub metadata: HashMap<String, String>,
    pub allowed_tools: Option<Vec<String>>,
    pub argument_hint: Option<String>,
    pub when_to_use: Option<String>,
    /// 结构化的自动触发条件配置
    pub when_to_use_config: Option<SkillTriggerConfig>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub disable_model_invocation: bool,
    pub execution_mode: String,
    pub workflow_ref: Option<String>,
    /// Workflow 步骤定义（仅 execution_mode == "workflow" 时有效）
    pub workflow_steps: Vec<WorkflowStep>,
    pub standard_compliance: SkillStandardCompliance,
}

#[derive(Debug, Deserialize)]
struct WorkflowDocument {
    #[serde(default)]
    steps: Vec<WorkflowStep>,
}

pub fn parse_skill_frontmatter(content: &str) -> (SkillFrontmatter, String) {
    let Some((_frontmatter, body)) = split_skill_frontmatter(content) else {
        return (SkillFrontmatter::default(), content.to_string());
    };

    match parse_skill_manifest_from_content(content) {
        Ok(parsed) => {
            let frontmatter = build_skill_frontmatter_from_manifest(&parsed);
            (frontmatter, body.to_string())
        }
        Err(error) => (
            SkillFrontmatter {
                validation_errors: vec![error],
                ..SkillFrontmatter::default()
            },
            body.to_string(),
        ),
    }
}

fn build_skill_frontmatter_from_manifest(parsed: &ParsedSkillManifest) -> SkillFrontmatter {
    let metadata = parsed.metadata.metadata.clone();
    let version = metadata
        .get("proxycast_version")
        .cloned()
        .or_else(|| parsed.raw_string("version"));
    let argument_hint = metadata
        .get("proxycast_argument_hint")
        .cloned()
        .or_else(|| parsed.raw_string("argument-hint"))
        .or_else(|| parsed.raw_string("argument_hint"));
    let when_to_use = metadata
        .get("proxycast_when_to_use")
        .cloned()
        .or_else(|| parsed.raw_string("when-to-use"))
        .or_else(|| parsed.raw_string("when_to_use"));
    let model = metadata
        .get("proxycast_model_preference")
        .cloned()
        .or_else(|| parsed.raw_string("model"));
    let provider = metadata
        .get("proxycast_provider_preference")
        .cloned()
        .or_else(|| parsed.raw_string("provider"));
    let workflow_ref = metadata
        .get("proxycast_workflow_ref")
        .cloned()
        .filter(|value| !value.trim().is_empty());
    let execution_mode = metadata
        .get("proxycast_execution_mode")
        .cloned()
        .or_else(|| parsed.raw_string("execution-mode"))
        .or_else(|| workflow_ref.as_ref().map(|_| "workflow".to_string()));

    let disable_model_invocation = metadata
        .get("proxycast_disable_model_invocation")
        .cloned()
        .or_else(|| {
            parsed
                .raw_bool("disable-model-invocation")
                .map(|value| value.to_string())
        });

    SkillFrontmatter {
        name: parsed.metadata.name.clone(),
        description: parsed.metadata.description.clone(),
        license: parsed.metadata.license.clone(),
        metadata,
        allowed_tools: (!parsed.metadata.allowed_tools.is_empty())
            .then(|| parsed.metadata.allowed_tools.clone()),
        argument_hint,
        when_to_use,
        version,
        model,
        provider,
        disable_model_invocation,
        execution_mode,
        steps_json: parsed.raw_string("steps-json"),
        workflow_ref,
        deprecated_fields: parsed.compliance.deprecated_fields.clone(),
        validation_errors: parsed.compliance.validation_errors.clone(),
    }
}

pub fn parse_allowed_tools(value: Option<&str>) -> Option<Vec<String>> {
    value.and_then(|v| {
        if v.is_empty() {
            return None;
        }
        if v.contains(',') {
            Some(
                v.split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect(),
            )
        } else {
            Some(vec![v.trim().to_string()])
        }
    })
}

pub fn parse_boolean(value: Option<&str>, default: bool) -> bool {
    value
        .map(|v| match v.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "enabled" => true,
            "false" | "0" | "no" | "disabled" => false,
            _ => default,
        })
        .unwrap_or(default)
}

pub fn parse_workflow_steps(steps_json: Option<&str>, markdown_content: &str) -> Vec<WorkflowStep> {
    if let Some(json) = steps_json {
        if let Ok(steps) = serde_json::from_str::<Vec<WorkflowStep>>(json) {
            return steps;
        }
        if let Ok(document) = serde_json::from_str::<WorkflowDocument>(json) {
            if !document.steps.is_empty() {
                return document.steps;
            }
        }
    }

    let re = regex::Regex::new(r"<!--\s*steps:\s*([\s\S]*?)-->").unwrap();
    if let Some(captures) = re.captures(markdown_content) {
        if let Some(json_match) = captures.get(1) {
            if let Ok(steps) = serde_json::from_str::<Vec<WorkflowStep>>(json_match.as_str().trim())
            {
                return steps;
            }
        }
    }

    Vec::new()
}

fn parse_workflow_steps_from_reference(
    base_dir: &Path,
    workflow_ref: Option<&str>,
) -> Vec<WorkflowStep> {
    let Some(workflow_ref) = workflow_ref else {
        return Vec::new();
    };
    if workflow_ref.trim().is_empty() {
        return Vec::new();
    }

    let workflow_path = base_dir.join(workflow_ref);
    let Ok(canonical_base) = base_dir.canonicalize() else {
        return Vec::new();
    };
    let Ok(canonical_workflow) = workflow_path.canonicalize() else {
        return Vec::new();
    };
    if !canonical_workflow.starts_with(&canonical_base) {
        return Vec::new();
    }

    let Ok(content) = std::fs::read_to_string(&canonical_workflow) else {
        return Vec::new();
    };

    if let Ok(steps) = serde_yaml::from_str::<Vec<WorkflowStep>>(&content) {
        return steps;
    }
    if let Ok(document) = serde_yaml::from_str::<WorkflowDocument>(&content) {
        return document.steps;
    }

    Vec::new()
}

pub fn load_skill_from_file(
    skill_name: &str,
    file_path: &Path,
) -> Result<LoadedSkillDefinition, String> {
    let content =
        std::fs::read_to_string(file_path).map_err(|e| format!("读取 Skill 文件失败: {}", e))?;

    let (mut frontmatter, markdown_content) = parse_skill_frontmatter(&content);
    let base_dir = file_path
        .parent()
        .ok_or_else(|| "Skill 文件缺少父目录".to_string())?;
    let inspection = SkillService::inspect_skill_dir(base_dir)
        .map_err(|e| format!("检查 Skill 包失败: {}", e))?;

    frontmatter.license = inspection.license.clone();
    frontmatter.metadata = inspection.metadata.clone();
    if !inspection.allowed_tools.is_empty() {
        frontmatter.allowed_tools = Some(inspection.allowed_tools.clone());
    }
    frontmatter.deprecated_fields = inspection.standard_compliance.deprecated_fields.clone();
    frontmatter.validation_errors = inspection.standard_compliance.validation_errors.clone();

    let display_name = frontmatter
        .name
        .clone()
        .unwrap_or_else(|| skill_name.to_string());
    let description = frontmatter.description.clone().unwrap_or_default();
    let allowed_tools = frontmatter.allowed_tools.clone().or_else(|| {
        parse_allowed_tools(
            frontmatter
                .metadata
                .get("allowed_tools")
                .map(|value| value.as_str()),
        )
    });
    let disable_model_invocation =
        parse_boolean(frontmatter.disable_model_invocation.as_deref(), false);
    let mut execution_mode = frontmatter
        .execution_mode
        .clone()
        .unwrap_or_else(|| "prompt".to_string());

    let workflow_steps = {
        let referenced =
            parse_workflow_steps_from_reference(base_dir, frontmatter.workflow_ref.as_deref());
        if referenced.is_empty() {
            parse_workflow_steps(frontmatter.steps_json.as_deref(), &markdown_content)
        } else {
            referenced
        }
    };

    if !workflow_steps.is_empty() && execution_mode == "prompt" {
        execution_mode = "workflow".to_string();
    }

    let when_to_use_config = frontmatter
        .when_to_use
        .as_deref()
        .and_then(|value| serde_json::from_str::<SkillTriggerConfig>(value).ok());

    Ok(LoadedSkillDefinition {
        skill_name: skill_name.to_string(),
        display_name,
        description,
        markdown_content,
        license: inspection.license,
        metadata: frontmatter.metadata,
        allowed_tools,
        argument_hint: frontmatter.argument_hint,
        when_to_use: frontmatter.when_to_use,
        when_to_use_config,
        model: frontmatter.model,
        provider: frontmatter.provider,
        disable_model_invocation,
        execution_mode,
        workflow_ref: frontmatter.workflow_ref,
        workflow_steps,
        standard_compliance: inspection.standard_compliance,
    })
}

pub fn get_proxycast_skills_dir() -> Option<PathBuf> {
    app_paths::resolve_skills_dir().ok()
}

pub fn get_project_skills_dir() -> Option<PathBuf> {
    app_paths::resolve_project_skills_dir()
}

pub fn get_skill_roots() -> Vec<PathBuf> {
    app_paths::resolve_proxycast_skill_roots().unwrap_or_else(|_| {
        let mut roots = Vec::new();
        if let Some(project_dir) = get_project_skills_dir() {
            roots.push(project_dir);
        }
        if let Some(user_dir) = get_proxycast_skills_dir() {
            roots.push(user_dir);
        }
        roots
    })
}

pub fn load_skills_from_directory(dir_path: &Path) -> Vec<LoadedSkillDefinition> {
    let mut results = Vec::new();

    if !dir_path.exists() {
        return results;
    }

    if let Ok(entries) = std::fs::read_dir(dir_path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let skill_file = path.join("SKILL.md");
            if !skill_file.exists() {
                continue;
            }

            let skill_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();

            if let Ok(skill) = load_skill_from_file(&skill_name, &skill_file) {
                if skill.standard_compliance.validation_errors.is_empty() {
                    results.push(skill);
                } else {
                    tracing::warn!(
                        "[load_skills_from_directory] 跳过无效 Skill: name={}, errors={}",
                        skill.skill_name,
                        skill.standard_compliance.validation_errors.join("; ")
                    );
                }
            }
        }
    }

    results
}

pub fn find_skill_by_name(skill_name: &str) -> Result<LoadedSkillDefinition, String> {
    for skills_dir in get_skill_roots() {
        let skill_file = skills_dir.join(skill_name).join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }
        return load_skill_from_file(skill_name, &skill_file);
    }

    Err(format!("Skill 不存在: {}", skill_name))
}

#[cfg(test)]
mod tests {
    use super::{load_skill_from_file, load_skills_from_directory};
    use tempfile::TempDir;

    #[test]
    fn load_skill_from_file_should_surface_invalid_workflow_reference() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("workflow-skill");
        std::fs::create_dir(&skill_dir).unwrap();

        let skill_file = skill_dir.join("SKILL.md");
        std::fs::write(
            &skill_file,
            r#"---
name: workflow-skill
description: Workflow skill
metadata:
  proxycast_workflow_ref: references/missing.json
---

# Workflow Skill
"#,
        )
        .unwrap();

        let skill = load_skill_from_file("workflow-skill", &skill_file).unwrap();

        assert!(!skill.standard_compliance.is_standard);
        assert!(skill
            .standard_compliance
            .validation_errors
            .iter()
            .any(|error| error.contains("metadata.proxycast_workflow_ref")));
        assert!(skill.workflow_steps.is_empty());
    }

    #[test]
    fn load_skills_from_directory_should_skip_invalid_skill_packages() {
        let temp_dir = TempDir::new().unwrap();
        let skills_dir = temp_dir.path();

        let valid_dir = skills_dir.join("skill-valid");
        std::fs::create_dir(&valid_dir).unwrap();
        std::fs::write(
            valid_dir.join("SKILL.md"),
            r#"---
name: skill-valid
description: Valid skill
---
Valid content
"#,
        )
        .unwrap();

        let invalid_dir = skills_dir.join("skill-invalid");
        std::fs::create_dir(&invalid_dir).unwrap();
        std::fs::write(
            invalid_dir.join("SKILL.md"),
            r#"---
name: skill-invalid
description: Invalid skill
metadata:
  proxycast_workflow_ref: references/missing.json
---
Invalid content
"#,
        )
        .unwrap();

        let skills = load_skills_from_directory(skills_dir);

        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].skill_name, "skill-valid");
    }
}
