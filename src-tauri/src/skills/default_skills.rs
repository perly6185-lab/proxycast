use std::fs;
use std::path::Path;

#[cfg(test)]
use std::path::PathBuf;

use proxycast_core::app_paths;
use proxycast_core::models::parse_skill_manifest_from_content;
use proxycast_core::models::{
    BROADCAST_GENERATE_SKILL_DIRECTORY, COVER_GENERATE_SKILL_DIRECTORY,
    IMAGE_GENERATE_SKILL_DIRECTORY, LIBRARY_SKILL_DIRECTORY, MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
    RESEARCH_SKILL_DIRECTORY, SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY, TYPESETTING_SKILL_DIRECTORY,
    URL_PARSE_SKILL_DIRECTORY, VIDEO_GENERATE_SKILL_DIRECTORY,
};

const VIDEO_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/video_generate/SKILL.md");

const BROADCAST_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/broadcast_generate/SKILL.md");

const COVER_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/cover_generate/SKILL.md");

const MODAL_RESOURCE_SEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/modal_resource_search/SKILL.md");

const IMAGE_GENERATE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/image_generate/SKILL.md");

const LIBRARY_SKILL_CONTENT: &str = include_str!("../../resources/default-skills/library/SKILL.md");

const URL_PARSE_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/url_parse/SKILL.md");

const RESEARCH_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/research/SKILL.md");

const TYPESETTING_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/typesetting/SKILL.md");

const SOCIAL_POST_WITH_COVER_SKILL_CONTENT: &str =
    include_str!("../../resources/default-skills/social_post_with_cover/SKILL.md");

const SOCIAL_POST_WITH_COVER_WORKFLOW_CONTENT: &str =
    include_str!("../../resources/default-skills/social_post_with_cover/references/workflow.json");

#[derive(Clone, Copy)]
struct BundledSkillFile {
    relative_path: &'static str,
    content: &'static str,
}

#[derive(Clone, Copy)]
struct BundledSkillDefinition {
    directory: &'static str,
    skill_content: &'static str,
    extra_files: &'static [BundledSkillFile],
}

const SOCIAL_POST_WITH_COVER_EXTRA_FILES: &[BundledSkillFile] = &[BundledSkillFile {
    relative_path: "references/workflow.json",
    content: SOCIAL_POST_WITH_COVER_WORKFLOW_CONTENT,
}];

fn default_skills() -> [BundledSkillDefinition; 10] {
    [
        BundledSkillDefinition {
            directory: VIDEO_GENERATE_SKILL_DIRECTORY,
            skill_content: VIDEO_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: BROADCAST_GENERATE_SKILL_DIRECTORY,
            skill_content: BROADCAST_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: COVER_GENERATE_SKILL_DIRECTORY,
            skill_content: COVER_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: MODAL_RESOURCE_SEARCH_SKILL_DIRECTORY,
            skill_content: MODAL_RESOURCE_SEARCH_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: IMAGE_GENERATE_SKILL_DIRECTORY,
            skill_content: IMAGE_GENERATE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: LIBRARY_SKILL_DIRECTORY,
            skill_content: LIBRARY_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: URL_PARSE_SKILL_DIRECTORY,
            skill_content: URL_PARSE_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: RESEARCH_SKILL_DIRECTORY,
            skill_content: RESEARCH_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: TYPESETTING_SKILL_DIRECTORY,
            skill_content: TYPESETTING_SKILL_CONTENT,
            extra_files: &[],
        },
        BundledSkillDefinition {
            directory: SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY,
            skill_content: SOCIAL_POST_WITH_COVER_SKILL_CONTENT,
            extra_files: SOCIAL_POST_WITH_COVER_EXTRA_FILES,
        },
    ]
}

#[cfg(test)]
fn skills_root_from_base(base_dir: &Path) -> PathBuf {
    base_dir.join("skills")
}

/// 从 SKILL.md 内容中提取版本号，返回 (major, minor, patch)
fn parse_skill_version(content: &str) -> Option<(u32, u32, u32)> {
    let manifest = parse_skill_manifest_from_content(content).ok()?;
    let version_str = manifest
        .metadata
        .metadata
        .get("proxycast_version")
        .cloned()
        .or_else(|| manifest.raw_string("version"))?;
    let parts: Vec<&str> = version_str.split('.').collect();
    if parts.len() == 3 {
        let major = parts[0].trim().parse::<u32>().ok()?;
        let minor = parts[1].trim().parse::<u32>().ok()?;
        let patch = parts[2].trim().parse::<u32>().ok()?;
        return Some((major, minor, patch));
    }
    None
}

fn ensure_default_local_skills_in_dir(skills_root: &Path) -> Result<Vec<String>, String> {
    fs::create_dir_all(&skills_root)
        .map_err(|e| format!("创建技能目录失败 {}: {e}", skills_root.display()))?;

    let mut installed = Vec::new();
    for bundled_skill in default_skills() {
        let skill_name = bundled_skill.directory;
        let skill_content = bundled_skill.skill_content;
        let skill_dir = skills_root.join(skill_name);
        let skill_md_path = skill_dir.join("SKILL.md");
        if skill_md_path.exists() {
            // 比较版本号，若内置版本更新则自动升级
            let existing_content = fs::read_to_string(&skill_md_path).unwrap_or_default();
            let existing_version = parse_skill_version(&existing_content);
            let embedded_version = parse_skill_version(skill_content);
            match (existing_version, embedded_version) {
                (Some(ev), Some(bv)) if bv > ev => {
                    // 内置版本更新，覆盖升级
                    fs::write(&skill_md_path, skill_content).map_err(|e| {
                        format!("升级默认技能失败 {}: {e}", skill_md_path.display())
                    })?;
                    sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
                    installed.push(skill_name.to_string());
                }
                _ => {
                    sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
                    continue;
                } // 版本相同或无法比较，跳过
            }
            continue;
        }

        fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("创建默认技能目录失败 {}: {e}", skill_dir.display()))?;
        fs::write(&skill_md_path, skill_content)
            .map_err(|e| format!("写入默认技能失败 {}: {e}", skill_md_path.display()))?;
        sync_bundled_skill_files(&skill_dir, bundled_skill.extra_files)?;
        installed.push(skill_name.to_string());
    }
    Ok(installed)
}

fn sync_bundled_skill_files(
    skill_dir: &Path,
    extra_files: &[BundledSkillFile],
) -> Result<(), String> {
    for extra_file in extra_files {
        let target_path = skill_dir.join(extra_file.relative_path);
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("创建技能资源目录失败 {}: {e}", parent.display()))?;
        }
        fs::write(&target_path, extra_file.content)
            .map_err(|e| format!("写入技能资源失败 {}: {e}", target_path.display()))?;
    }
    Ok(())
}

pub fn ensure_default_local_skills() -> Result<Vec<String>, String> {
    let skills_root = app_paths::resolve_skills_dir()?;
    ensure_default_local_skills_in_dir(&skills_root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_install_default_skill_when_missing() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()));

        let skill_md_path = skills_root
            .join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY)
            .join("SKILL.md");
        assert!(skill_md_path.exists());
    }

    #[test]
    fn should_not_overwrite_existing_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let skill_dir = skills_root.join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 无版本号的自定义内容不应被覆盖
        let existing_content = "custom skill content";
        fs::write(&skill_md_path, existing_content).expect("write custom skill");

        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(
            !installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "无版本信息的已存在 skill 不应被重新安装"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_eq!(current_content, existing_content);
    }

    #[test]
    fn should_upgrade_skill_when_newer_version_available() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        let skill_dir = skills_root.join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY);
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let skill_md_path = skill_dir.join("SKILL.md");
        // 旧版本内容
        let old_content = "---\nname: social_post_with_cover\nversion: 1.0.0\n---\nold content";
        fs::write(&skill_md_path, old_content).expect("write old skill");

        let installed = ensure_default_local_skills_in_dir(&skills_root).expect("install");
        assert!(
            installed.contains(&SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY.to_string()),
            "内置版本更新时应自动升级"
        );

        let current_content = fs::read_to_string(&skill_md_path).expect("read skill");
        assert_ne!(current_content, old_content, "旧版本内容应被替换");
        assert!(
            current_content.contains("proxycast_workflow_ref"),
            "升级后应包含 workflow 引用字段"
        );
    }

    #[test]
    fn should_parse_skill_version() {
        assert_eq!(
            parse_skill_version("---\nversion: 1.3.0\n---\n"),
            Some((1, 3, 0))
        );
        assert_eq!(
            parse_skill_version("---\nname: test\nversion: 2.10.5\n---\n"),
            Some((2, 10, 5))
        );
        assert_eq!(parse_skill_version("no version here"), None);
    }

    #[test]
    fn should_embed_social_image_tool_contract_in_default_skill() {
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT
            .contains("allowed-tools: social_generate_cover_image, search_query"));
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT.contains("**配图说明**"));
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT.contains("状态：{成功/失败}"));
        assert!(SOCIAL_POST_WITH_COVER_SKILL_CONTENT.contains("proxycast_workflow_ref"));
        assert!(SOCIAL_POST_WITH_COVER_WORKFLOW_CONTENT.contains("\"id\": \"research\""));
    }

    #[test]
    fn should_embed_core_default_skills() {
        assert!(VIDEO_GENERATE_SKILL_CONTENT.contains("name: video_generate"));
        assert!(BROADCAST_GENERATE_SKILL_CONTENT.contains("name: broadcast_generate"));
        assert!(COVER_GENERATE_SKILL_CONTENT.contains("name: cover_generate"));
        assert!(MODAL_RESOURCE_SEARCH_SKILL_CONTENT.contains("name: modal_resource_search"));
        assert!(IMAGE_GENERATE_SKILL_CONTENT.contains("name: image_generate"));
        assert!(LIBRARY_SKILL_CONTENT.contains("name: library"));
        assert!(URL_PARSE_SKILL_CONTENT.contains("name: url_parse"));
        assert!(RESEARCH_SKILL_CONTENT.contains("name: research"));
        assert!(TYPESETTING_SKILL_CONTENT.contains("name: typesetting"));
    }

    #[test]
    fn should_sync_extra_files_for_social_post_skill() {
        let temp = tempfile::tempdir().expect("create temp dir");
        let skills_root = skills_root_from_base(temp.path());
        ensure_default_local_skills_in_dir(&skills_root).expect("install");

        let workflow_path = skills_root
            .join(SOCIAL_POST_WITH_COVER_SKILL_DIRECTORY)
            .join("references")
            .join("workflow.json");
        assert!(workflow_path.exists());
        let workflow_content = fs::read_to_string(workflow_path).expect("read workflow");
        assert!(workflow_content.contains("\"cover\""));
    }
}
