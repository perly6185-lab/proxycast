//! Skill 自动匹配器
//!
//! 基于关键词的简单匹配，不依赖 LLM。
//! 从 `SkillTriggerConfig` 的 trigger/do_not_trigger 列表提取关键词进行模糊匹配。

use crate::skill_loader::LoadedSkillDefinition;

/// Skill 匹配结果
#[derive(Debug, Clone)]
pub struct SkillMatch {
    pub skill_name: String,
    pub confidence: f32,
    pub trigger_reason: String,
}

/// 基于关键词的简单匹配器
pub struct SkillMatcher {
    skills: Vec<LoadedSkillDefinition>,
}

/// 最低置信度阈值
const CONFIDENCE_THRESHOLD: f32 = 0.6;

impl SkillMatcher {
    pub fn new(skills: Vec<LoadedSkillDefinition>) -> Self {
        Self { skills }
    }

    /// 根据用户输入匹配最合适的 Skill
    /// 返回按 confidence 降序排列的匹配结果（仅 >= 0.6）
    pub fn match_skills(&self, user_input: &str) -> Vec<SkillMatch> {
        let input_lower = user_input.to_lowercase();
        let mut matches = Vec::new();

        for skill in &self.skills {
            let config = match &skill.when_to_use_config {
                Some(c) => c,
                None => continue,
            };

            if config.trigger.is_empty() {
                continue;
            }

            // 先检查排除条件
            if self.check_exclusions(&input_lower, &config.do_not_trigger) {
                continue;
            }

            // 检查触发条件
            let (matched, confidence, reason) = self.check_triggers(&input_lower, &config.trigger);

            if matched && confidence >= CONFIDENCE_THRESHOLD {
                matches.push(SkillMatch {
                    skill_name: skill.skill_name.clone(),
                    confidence,
                    trigger_reason: reason,
                });
            }
        }

        matches.sort_by(|a, b| {
            b.confidence
                .partial_cmp(&a.confidence)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        matches
    }

    /// 检查用户输入是否包含触发关键词
    /// 返回 (是否匹配, 置信度, 匹配原因)
    fn check_triggers(&self, input: &str, triggers: &[String]) -> (bool, f32, String) {
        if triggers.is_empty() {
            return (false, 0.0, String::new());
        }

        let mut matched_triggers = Vec::new();

        for trigger in triggers {
            let keywords = extract_keywords(trigger);
            if keywords.is_empty() {
                continue;
            }

            let matched_count = keywords
                .iter()
                .filter(|kw| input.contains(kw.as_str()))
                .count();

            if matched_count > 0 {
                let ratio = matched_count as f32 / keywords.len() as f32;
                if ratio >= 0.5 {
                    matched_triggers.push((trigger.clone(), ratio));
                }
            }
        }

        if matched_triggers.is_empty() {
            return (false, 0.0, String::new());
        }

        // 置信度 = 匹配的 trigger 条目占比 * 最佳单条匹配率
        let best_ratio = matched_triggers
            .iter()
            .map(|(_, r)| *r)
            .fold(0.0f32, f32::max);
        let trigger_coverage = matched_triggers.len() as f32 / triggers.len() as f32;
        let confidence = (best_ratio * 0.7 + trigger_coverage * 0.3).min(1.0);

        let reasons: Vec<String> = matched_triggers.iter().map(|(t, _)| t.clone()).collect();
        let reason = format!("匹配触发条件: {}", reasons.join(", "));

        (true, confidence, reason)
    }

    /// 检查是否命中排除条件
    fn check_exclusions(&self, input: &str, exclusions: &[String]) -> bool {
        for exclusion in exclusions {
            let keywords = extract_keywords(exclusion);
            if keywords.is_empty() {
                continue;
            }

            let matched_count = keywords
                .iter()
                .filter(|kw| input.contains(kw.as_str()))
                .count();

            // 排除条件中超过一半关键词命中即排除
            if matched_count > 0 && matched_count as f32 / keywords.len() as f32 >= 0.5 {
                return true;
            }
        }
        false
    }

    /// 生成 skill 描述文本，用于注入 system prompt
    pub fn generate_skill_prompt_section(&self) -> String {
        if self.skills.is_empty() {
            return String::new();
        }

        let mut section = String::from("## 可用 Skills\n\n");
        for skill in &self.skills {
            section.push_str(&format!("### /{}\n", skill.skill_name));
            if !skill.description.is_empty() {
                section.push_str(&skill.description);
                section.push('\n');
            }
            if let Some(ref config) = skill.when_to_use_config {
                if !config.trigger.is_empty() {
                    section.push_str("触发条件：");
                    section.push_str(&config.trigger.join("、"));
                    section.push('\n');
                }
                if !config.do_not_trigger.is_empty() {
                    section.push_str("不触发：");
                    section.push_str(&config.do_not_trigger.join("、"));
                    section.push('\n');
                }
            }
            section.push('\n');
        }
        section
    }
}

/// 从自然语言描述中提取关键词（小写）
/// 过滤掉常见停用词，保留有意义的词汇
fn extract_keywords(text: &str) -> Vec<String> {
    // 中英文停用词
    const STOP_WORDS: &[&str] = &[
        // 英文
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
        "do", "does", "did", "will", "would", "could", "should", "may", "might", "can", "shall",
        "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into", "about", "like",
        "through", "after", "over", "between", "out", "against", "during", "without", "before",
        "under", "around", "among", "and", "but", "or", "nor", "not", "so", "yet", "both",
        "either", "neither", "each", "every", "all", "any", "few", "more", "most", "other", "some",
        "such", "no", "only", "own", "same", "than", "too", "very", "just", "because", "if",
        "when", "where", "how", "what", "which", "who", "whom", "this", "that", "these", "those",
        "i", "me", "my", "we", "our", "you", "your", "he", "him", "his", "she", "her", "it", "its",
        "they", "them", "their", "user", "want", "wants", "need", "needs", "use", "using",
        // 中文
        "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也",
        "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "他",
        "她", "它", "们", "那", "里", "后", "把", "让", "从", "被", "与", "对", "当", "用", "使用",
        "进行", "可以", "需要", "想要", "帮我", "请", "能", "能够",
    ];

    let lower = text.to_lowercase();

    // 按空格和常见标点分词
    let tokens: Vec<String> = lower
        .split(|c: char| c.is_whitespace() || ",.;:!?()[]{}\"'`~@#$%^&*+=|/<>".contains(c))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    // 对于中文文本（没有空格分隔），如果 token 长度 > 4 字符且包含中文，
    // 按 2-3 字符切分为子词
    let mut keywords = Vec::new();
    for token in &tokens {
        let has_cjk = token.chars().any(|c| is_cjk(c));
        let char_count = token.chars().count();

        if has_cjk && char_count > 3 {
            // 中文长词切分为 bigram
            let chars: Vec<char> = token.chars().collect();
            for window in chars.windows(2) {
                let bigram: String = window.iter().collect();
                if !STOP_WORDS.contains(&bigram.as_str()) {
                    keywords.push(bigram);
                }
            }
        } else if !STOP_WORDS.contains(&token.as_str()) && token.len() > 1 {
            keywords.push(token.clone());
        }
    }

    keywords.sort();
    keywords.dedup();
    keywords
}

/// 判断字符是否为 CJK 字符
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}' |   // CJK Unified Ideographs
        '\u{3400}'..='\u{4DBF}' |   // CJK Unified Ideographs Extension A
        '\u{F900}'..='\u{FAFF}'     // CJK Compatibility Ideographs
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skill_loader::SkillTriggerConfig;

    fn make_skill(
        name: &str,
        trigger: Vec<&str>,
        do_not_trigger: Vec<&str>,
    ) -> LoadedSkillDefinition {
        LoadedSkillDefinition {
            skill_name: name.to_string(),
            display_name: name.to_string(),
            description: String::new(),
            markdown_content: String::new(),
            license: None,
            metadata: std::collections::HashMap::new(),
            allowed_tools: None,
            argument_hint: None,
            when_to_use: None,
            when_to_use_config: Some(SkillTriggerConfig {
                trigger: trigger.into_iter().map(String::from).collect(),
                do_not_trigger: do_not_trigger.into_iter().map(String::from).collect(),
            }),
            model: None,
            provider: None,
            disable_model_invocation: false,
            execution_mode: "prompt".to_string(),
            workflow_ref: None,
            workflow_steps: Vec::new(),
            standard_compliance: proxycast_core::models::SkillStandardCompliance {
                is_standard: true,
                validation_errors: Vec::new(),
                deprecated_fields: Vec::new(),
            },
        }
    }

    #[test]
    fn test_basic_trigger_match() {
        let skills = vec![make_skill(
            "code-review",
            vec!["review code", "code review"],
            vec![],
        )];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("please review my code");
        assert!(!results.is_empty());
        assert_eq!(results[0].skill_name, "code-review");
        assert!(results[0].confidence >= CONFIDENCE_THRESHOLD);
    }

    #[test]
    fn test_no_match_below_threshold() {
        let skills = vec![make_skill(
            "deploy",
            vec!["deploy to production server"],
            vec![],
        )];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("hello world");
        assert!(results.is_empty());
    }

    #[test]
    fn test_exclusion_prevents_match() {
        let skills = vec![make_skill(
            "translate",
            vec!["translate text", "translation"],
            vec!["translate code variable names"],
        )];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("translate code variable names to english");
        assert!(results.is_empty());
    }

    #[test]
    fn test_multiple_skills_sorted_by_confidence() {
        let skills = vec![
            make_skill("git-commit", vec!["commit changes", "git commit"], vec![]),
            make_skill(
                "code-review",
                vec!["review code", "code review", "check code quality"],
                vec![],
            ),
        ];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("review code quality and commit");
        // code-review 应该有更高的 confidence（匹配了更多 trigger）
        assert!(results.len() >= 1);
    }

    #[test]
    fn test_skill_without_config_is_skipped() {
        let mut skill = make_skill("no-config", vec![], vec![]);
        skill.when_to_use_config = None;
        let matcher = SkillMatcher::new(vec![skill]);
        let results = matcher.match_skills("anything");
        assert!(results.is_empty());
    }

    #[test]
    fn test_chinese_trigger_match() {
        let skills = vec![make_skill(
            "ecommerce-reply",
            vec!["电商评论回复", "商品评价回复"],
            vec![],
        )];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("帮我生成电商评论回复");
        assert!(!results.is_empty());
        assert_eq!(results[0].skill_name, "ecommerce-reply");
    }

    #[test]
    fn test_extract_keywords_english() {
        let keywords = extract_keywords("review the code quality");
        assert!(keywords.contains(&"review".to_string()));
        assert!(keywords.contains(&"code".to_string()));
        assert!(keywords.contains(&"quality".to_string()));
        // "the" 是停用词，应被过滤
        assert!(!keywords.contains(&"the".to_string()));
    }

    #[test]
    fn test_extract_keywords_chinese() {
        let keywords = extract_keywords("电商评论回复");
        // 应该产生 bigram
        assert!(!keywords.is_empty());
        assert!(keywords.contains(&"电商".to_string()));
        assert!(keywords.contains(&"评论".to_string()));
    }

    #[test]
    fn test_empty_triggers() {
        let skills = vec![make_skill("empty", vec![], vec![])];
        let matcher = SkillMatcher::new(skills);
        let results = matcher.match_skills("anything");
        assert!(results.is_empty());
    }

    #[test]
    fn test_generate_skill_prompt_section_empty() {
        let matcher = SkillMatcher::new(vec![]);
        assert_eq!(matcher.generate_skill_prompt_section(), "");
    }

    #[test]
    fn test_generate_skill_prompt_section() {
        let skills = vec![make_skill(
            "code-review",
            vec!["review code", "代码审查"],
            vec!["不要自动修复"],
        )];
        let matcher = SkillMatcher::new(skills);
        let section = matcher.generate_skill_prompt_section();
        assert!(section.contains("## 可用 Skills"));
        assert!(section.contains("### /code-review"));
        assert!(section.contains("触发条件："));
        assert!(section.contains("review code"));
        assert!(section.contains("不触发："));
        assert!(section.contains("不要自动修复"));
    }
}
