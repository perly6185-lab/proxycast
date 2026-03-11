import { useMemo } from "react";
import styled from "styled-components";
import {
  ChevronRight,
  FileText,
  Image,
  PanelRightClose,
  Search,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Skill } from "@/lib/api/skills";

type SkillGroupKey = "text" | "visual" | "audio" | "video" | "resource";
type ThemeWorkbenchRunState = "idle" | "auto_running" | "await_user_decision";

interface SkillGroup {
  key: SkillGroupKey;
  title: string;
  items: Skill[];
}

interface CurrentGate {
  key: string;
  title: string;
  status: "running" | "waiting" | "idle" | "done";
  description: string;
}

interface ThemeWorkbenchWorkspaceSummary {
  activeContextCount: number;
  searchResultCount: number;
  versionCount: number;
  runState: ThemeWorkbenchRunState;
}

const PanelContainer = styled.aside`
  width: 320px;
  min-width: 320px;
  height: 100%;
  border-left: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.14);
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const PanelHeader = styled.div`
  padding: 14px 14px 12px;
  border-bottom: 1px solid hsl(var(--border) / 0.75);
  background: hsl(var(--background) / 0.92);
  backdrop-filter: blur(12px);
`;

const PanelHeaderTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
`;

const PanelCollapseButton = styled.button`
  width: 28px;
  height: 28px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: hsl(var(--foreground));
    border-color: hsl(var(--primary) / 0.35);
    background: hsl(var(--accent) / 0.45);
  }
`;

const PanelEyebrow = styled.div`
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: hsl(var(--muted-foreground));
`;

const PanelTitle = styled.div`
  margin-top: 4px;
  font-size: 16px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const PanelDescription = styled.div`
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: hsl(var(--muted-foreground));
`;

const Section = styled.section`
  padding: 12px 14px;
  border-bottom: 1px solid hsl(var(--border) / 0.72);
`;

const ScrollSection = styled(Section)`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  color: hsl(var(--muted-foreground));
  margin-bottom: 8px;
`;

const GateCard = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: linear-gradient(
    180deg,
    hsl(var(--background)) 0%,
    hsl(var(--muted) / 0.36) 100%
  );
  padding: 12px;
`;

const GateHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const GateTitle = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const GateStatus = styled.span<{ $status: "running" | "waiting" | "idle" | "done" }>`
  margin-left: auto;
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  background: ${(props) =>
    props.$status === "waiting"
      ? "hsl(38 96% 90%)"
      : props.$status === "running"
        ? "hsl(var(--primary) / 0.16)"
        : props.$status === "idle"
          ? "hsl(var(--muted) / 0.7)"
          : "hsl(142 76% 90%)"};
  color: ${(props) =>
    props.$status === "waiting"
      ? "hsl(30 90% 35%)"
      : props.$status === "running"
        ? "hsl(var(--primary))"
        : props.$status === "idle"
          ? "hsl(var(--muted-foreground))"
          : "hsl(142 76% 30%)"};
`;

const GateDesc = styled.div`
  margin-top: 8px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.45;
`;

const MetricGrid = styled.div`
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const MetricCard = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--background));
  padding: 10px;
`;

const MetricValue = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: hsl(var(--foreground));
  line-height: 1.2;
  word-break: break-word;
`;

const MetricLabel = styled.div`
  margin-top: 4px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
`;

const HintText = styled.div`
  margin-top: 8px;
  font-size: 11px;
  line-height: 1.45;
  color: hsl(var(--muted-foreground));
`;

const ActionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ActionCard = styled.div<{ $featured?: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$featured ? "hsl(var(--primary) / 0.35)" : "hsl(var(--border))"};
  border-radius: 14px;
  background: ${(props) =>
    props.$featured ? "hsl(var(--primary) / 0.06)" : "hsl(var(--background))"};
  padding: 12px;
`;

const ActionHead = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 10px;
`;

const ActionIconWrap = styled.div<{ $featured?: boolean }>`
  width: 30px;
  height: 30px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$featured ? "hsl(var(--primary) / 0.14)" : "hsl(var(--muted) / 0.8)"};
  color: ${(props) =>
    props.$featured ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  flex-shrink: 0;
`;

const ActionMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const ActionName = styled.div`
  font-size: 13px;
  font-weight: 700;
  color: hsl(var(--foreground));
  line-height: 1.35;
`;

const ActionDescription = styled.div`
  margin-top: 4px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.45;
`;

const ActionTag = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-top: 8px;
  padding: 0 8px;
  height: 22px;
  border-radius: 999px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 600;
`;

const ActionButton = styled.button`
  margin-top: 10px;
  width: 100%;
  height: 34px;
  border-radius: 10px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: hsl(var(--primary) / 0.4);
    background: hsl(var(--primary) / 0.08);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const GroupTitle = styled.div`
  margin: 14px 0 8px;
  font-size: 12px;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

function resolveSkillGroup(skill: Skill): SkillGroupKey {
  const feature = `${skill.key} ${skill.name} ${skill.description}`.toLowerCase();
  if (
    feature.includes("cover") ||
    feature.includes("image") ||
    feature.includes("illustration") ||
    feature.includes("poster")
  ) {
    return "visual";
  }
  if (
    feature.includes("broadcast") ||
    feature.includes("audio") ||
    feature.includes("podcast") ||
    feature.includes("music")
  ) {
    return "audio";
  }
  if (feature.includes("video")) {
    return "video";
  }
  if (
    feature.includes("resource") ||
    feature.includes("research") ||
    feature.includes("library") ||
    feature.includes("url") ||
    feature.includes("search")
  ) {
    return "resource";
  }
  return "text";
}

function getGroupTitle(groupKey: SkillGroupKey): string {
  if (groupKey === "text") return "文字能力";
  if (groupKey === "visual") return "视觉能力";
  if (groupKey === "audio") return "音频能力";
  if (groupKey === "video") return "视频能力";
  return "检索与资源";
}

function resolveGateStatusText(status: CurrentGate["status"]): string {
  if (status === "waiting") return "等待决策";
  if (status === "running") return "自动执行";
  if (status === "idle") return "待启动";
  return "已完成";
}

function resolveRunStateText(runState: ThemeWorkbenchRunState): string {
  if (runState === "auto_running") return "执行中";
  if (runState === "await_user_decision") return "待决策";
  return "空闲";
}

function resolveSkillIcon(skill: Skill): LucideIcon {
  const group = resolveSkillGroup(skill);
  if (group === "resource") {
    return Search;
  }
  if (group === "visual") {
    return Image;
  }
  if (group === "text") {
    return FileText;
  }
  return Sparkles;
}

function resolveSkillActionLabel(skill: Skill): string {
  const group = resolveSkillGroup(skill);
  if (group === "resource") {
    return "开始检索";
  }
  if (group === "visual") {
    return "生成素材";
  }
  return "立即执行";
}

function buildSkillFeatureProbe(skill: Skill): string {
  return `${skill.key} ${skill.name} ${skill.description || ""}`.toLowerCase();
}

function pickRecommendedSkills(skills: Skill[], gateKey: string): Skill[] {
  const tagsByGate: Record<string, string[]> = {
    topic_select: ["research", "social_post_with_cover"],
    write_mode: ["social_post_with_cover", "typesetting", "cover"],
    publish_confirm: ["typesetting", "cover", "social_post_with_cover"],
  };

  const preferredTags = tagsByGate[gateKey] || ["social_post_with_cover", "research"];
  const selected: Skill[] = [];

  preferredTags.forEach((tag) => {
    const found = skills.find((skill) => {
      if (selected.some((item) => item.key === skill.key)) {
        return false;
      }
      return buildSkillFeatureProbe(skill).includes(tag);
    });
    if (found) {
      selected.push(found);
    }
  });

  if (selected.length < 2) {
    skills.forEach((skill) => {
      if (selected.length >= 2) {
        return;
      }
      if (!selected.some((item) => item.key === skill.key)) {
        selected.push(skill);
      }
    });
  }

  return selected.slice(0, 2);
}

interface ThemeWorkbenchSkillsPanelProps {
  skills: Skill[];
  currentGate: CurrentGate;
  disabled?: boolean;
  workspaceSummary?: ThemeWorkbenchWorkspaceSummary;
  onTriggerSkill?: (skill: Skill) => void;
  onRequestCollapse?: () => void;
}

export function ThemeWorkbenchSkillsPanel({
  skills,
  currentGate,
  disabled = false,
  workspaceSummary,
  onTriggerSkill,
  onRequestCollapse,
}: ThemeWorkbenchSkillsPanelProps) {
  const fallbackSkills: Skill[] = useMemo(
    () => [
      {
        key: "social_post_with_cover",
        name: "social_post_with_cover",
        description: "社媒主稿与封面图生成",
        directory: "social_post_with_cover",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "cover_generate",
        name: "cover_generate",
        description: "封面图生成",
        directory: "cover_generate",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "research",
        name: "research",
        description: "信息检索与趋势分析",
        directory: "research",
        installed: true,
        sourceKind: "builtin",
      },
      {
        key: "typesetting",
        name: "typesetting",
        description: "主稿排版与润色",
        directory: "typesetting",
        installed: true,
        sourceKind: "builtin",
      },
    ],
    [],
  );

  const availableSkills = useMemo(
    () => {
      const installed = skills.filter((skill) => skill.installed);
      return installed.length > 0 ? installed : fallbackSkills;
    },
    [fallbackSkills, skills],
  );

  const recommendedSkills = useMemo(
    () => pickRecommendedSkills(availableSkills, currentGate.key),
    [availableSkills, currentGate.key],
  );

  const groupedSkills = useMemo<SkillGroup[]>(() => {
    const recommendedSkillKeys = new Set(recommendedSkills.map((skill) => skill.key));
    const buckets: Record<SkillGroupKey, Skill[]> = {
      text: [],
      visual: [],
      audio: [],
      video: [],
      resource: [],
    };

    availableSkills.forEach((skill) => {
      if (recommendedSkillKeys.has(skill.key)) {
        return;
      }
      buckets[resolveSkillGroup(skill)].push(skill);
    });

    return (Object.keys(buckets) as SkillGroupKey[])
      .map((key) => ({
        key,
        title: getGroupTitle(key),
        items: buckets[key],
      }))
      .filter((group) => group.items.length > 0);
  }, [availableSkills, recommendedSkills]);

  return (
    <PanelContainer>
      <PanelHeader>
        <PanelHeaderTop>
          <div>
            <PanelEyebrow>Theme Workbench</PanelEyebrow>
            <PanelTitle>操作面板</PanelTitle>
          </div>
          {onRequestCollapse ? (
            <PanelCollapseButton
              type="button"
              aria-label="折叠操作面板"
              onClick={onRequestCollapse}
            >
              <PanelRightClose size={16} />
            </PanelCollapseButton>
          ) : null}
        </PanelHeaderTop>
        <PanelDescription>
          右侧聚焦当前阶段推荐动作，中间主稿区保持结果优先，减少来回跳转。
        </PanelDescription>
      </PanelHeader>

      <Section>
        <SectionTitle>阶段摘要</SectionTitle>
        <GateCard>
          <GateHead>
            <ChevronRight size={14} />
            <GateTitle>{currentGate.title}</GateTitle>
            <GateStatus $status={currentGate.status}>
              {resolveGateStatusText(currentGate.status)}
            </GateStatus>
          </GateHead>
          <GateDesc>{currentGate.description}</GateDesc>
          {workspaceSummary ? (
            <MetricGrid>
              <MetricCard>
                <MetricValue>{workspaceSummary.activeContextCount}</MetricValue>
                <MetricLabel>启用上下文</MetricLabel>
              </MetricCard>
              <MetricCard>
                <MetricValue>{workspaceSummary.searchResultCount}</MetricValue>
                <MetricLabel>搜索结果</MetricLabel>
              </MetricCard>
              <MetricCard>
                <MetricValue>{workspaceSummary.versionCount}</MetricValue>
                <MetricLabel>版本快照</MetricLabel>
              </MetricCard>
              <MetricCard>
                <MetricValue>{resolveRunStateText(workspaceSummary.runState)}</MetricValue>
                <MetricLabel>运行状态</MetricLabel>
              </MetricCard>
            </MetricGrid>
          ) : null}
          <HintText>
            {disabled
              ? "当前有任务执行中，建议等待本轮完成后再触发新的技能。"
              : "先看推荐动作，再按需要选择更多能力，避免重复操作。"}
          </HintText>
        </GateCard>
      </Section>

      <ScrollSection>
        <SectionTitle>推荐动作</SectionTitle>
        <ActionList>
          {recommendedSkills.map((skill) => {
            const Icon = resolveSkillIcon(skill);
            return (
              <ActionCard key={skill.key} $featured>
                <ActionHead>
                  <ActionIconWrap $featured>
                    <Icon size={16} />
                  </ActionIconWrap>
                  <ActionMeta>
                    <ActionName>{skill.name}</ActionName>
                    <ActionDescription>
                      {skill.description || "使用当前能力继续推进本轮工作台任务。"}
                    </ActionDescription>
                    <ActionTag>推荐优先执行</ActionTag>
                  </ActionMeta>
                </ActionHead>
                <ActionButton
                  type="button"
                  aria-label={`执行技能 ${skill.key}`}
                  disabled={disabled}
                  onClick={() => onTriggerSkill?.(skill)}
                >
                  {resolveSkillActionLabel(skill)}
                </ActionButton>
              </ActionCard>
            );
          })}
        </ActionList>

        <GroupTitle>可执行能力</GroupTitle>
        {groupedSkills.length === 0 ? (
          <HintText>当前可用技能已全部展示在推荐动作中，可直接开始执行。</HintText>
        ) : (
          groupedSkills.map((group) => (
            <div key={group.key}>
              <SectionTitle>{group.title}</SectionTitle>
              <ActionList>
                {group.items.map((skill) => {
                  const Icon = resolveSkillIcon(skill);
                  return (
                    <ActionCard key={skill.key}>
                      <ActionHead>
                        <ActionIconWrap>
                          <Icon size={16} />
                        </ActionIconWrap>
                        <ActionMeta>
                          <ActionName>{skill.name}</ActionName>
                          <ActionDescription>
                            {skill.description || "使用当前能力继续处理工作台内容。"}
                          </ActionDescription>
                        </ActionMeta>
                      </ActionHead>
                      <ActionButton
                        type="button"
                        aria-label={`执行技能 ${skill.key}`}
                        disabled={disabled}
                        onClick={() => onTriggerSkill?.(skill)}
                      >
                        {resolveSkillActionLabel(skill)}
                      </ActionButton>
                    </ActionCard>
                  );
                })}
              </ActionList>
            </div>
          ))
        )}
      </ScrollSection>
    </PanelContainer>
  );
}
