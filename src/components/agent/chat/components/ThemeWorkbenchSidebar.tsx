import React, {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FileText,
  FileUp,
  GitBranch,
  Globe,
  Image as ImageIcon,
  Link2,
  Loader2,
  PencilLine,
  Plus,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import styled from "styled-components";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { StepStatus } from "@/components/content-creator/types";
import type { SkillDetailInfo } from "@/lib/api/skill-execution";
import type { TopicBranchItem, TopicBranchStatus } from "../hooks/useTopicBranchBoard";
import type { SidebarActivityLog } from "../hooks/useThemeContextWorkspace";
import type { Message } from "../types";
import type { AgentRun } from "@/lib/api/executionRun";
import {
  openFileWithDefaultApp as openSessionFileWithDefaultApp,
  revealFileInFinder as revealSessionFileInFinder,
} from "@/lib/api/session-files";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { logRenderPerf } from "@/lib/perfDebug";

const SidebarContainer = styled.aside`
  display: flex;
  flex-direction: column;
  width: 290px;
  min-width: 290px;
  height: 100%;
  border-right: 1px solid hsl(var(--border));
  background: hsl(var(--muted) / 0.24);
  position: relative;
`;

const SidebarCollapseHandle = styled.button`
  position: absolute;
  right: -10px;
  top: 50%;
  transform: translateY(-50%);
  width: 16px;
  height: 60px;
  border: 1px solid hsl(var(--border));
  border-left: 0;
  border-radius: 0 10px 10px 0;
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;

  &:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent) / 0.5);
  }
`;


const SidebarHeader = styled.div`
  padding: 16px 16px 14px;
  border-bottom: 1px solid hsl(var(--border) / 0.7);
  background: hsl(var(--background) / 0.9);
  backdrop-filter: blur(10px);
`;

const SidebarHeaderMetaRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const SidebarHeaderActionSlot = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &[data-testid="theme-workbench-sidebar-header-action"] {
    margin-top: -2px;
  }
`;

const SidebarEyebrow = styled.div`
  font-size: 10px;
  color: hsl(var(--muted-foreground));
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 600;
`;

const SidebarTitle = styled.div`
  margin-top: 10px;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 700;
  color: hsl(var(--foreground));
`;

const SidebarDescription = styled.div`
  margin-top: 6px;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const SidebarTabs = styled.div`
  margin-top: 14px;
  display: flex;
  gap: 6px;
  padding: 4px;
  border: 1px solid hsl(var(--border) / 0.75);
  border-radius: 18px;
  background: hsl(var(--muted) / 0.38);
`;

const SidebarTabButton = styled.button<{ $active: boolean }>`
  flex: 1 1 0;
  min-width: 0;
  height: 38px;
  border-radius: 12px;
  border: 1px solid
    ${(props) =>
      props.$active ? 'hsl(var(--primary) / 0.35)' : 'transparent'};
  background: ${(props) =>
    props.$active ? 'hsl(var(--background))' : 'transparent'};
  color: ${(props) =>
    props.$active ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  box-shadow: ${(props) =>
    props.$active ? '0 1px 2px hsl(var(--foreground) / 0.06)' : 'none'};

  &:hover {
    border-color: hsl(var(--primary) / 0.45);
    color: hsl(var(--foreground));
    background: ${(props) =>
      props.$active ? 'hsl(var(--background))' : 'hsl(var(--background) / 0.65)'};
  }
`;

const SidebarTabLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SidebarTabCount = styled.span<{ $active: boolean }>`
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  border-radius: 999px;
  padding: 0 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  background: ${(props) =>
    props.$active ? 'hsl(var(--primary))' : 'hsl(var(--muted))'};
  color: ${(props) =>
    props.$active ? 'hsl(var(--primary-foreground))' : 'hsl(var(--muted-foreground))'};
`;

const SidebarBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: visible;
`;

/* ── 执行日志 Timeline 样式 ── */

const ExecLogContainer = styled.div`
  padding: 12px 14px;
`;

const ExecLogTimeline = styled.div`
  position: relative;
  padding-left: 20px;
  &::before {
    content: "";
    position: absolute;
    left: 6px;
    top: 8px;
    bottom: 8px;
    width: 1px;
    background: hsl(var(--border));
  }
`;

const ExecLogItem = styled.div`
  position: relative;
  margin-bottom: 14px;
  &:last-child { margin-bottom: 0; }
`;

const ExecLogDot = styled.span<{ $type: string; $status?: string }>`
  position: absolute;
  left: -24px;
  top: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid ${(p) => {
    if (p.$status === "failed") return "hsl(var(--destructive))";
    if (p.$status === "running") return "hsl(38 92% 50%)";
    if (p.$type === "user") return "hsl(217 91% 60%)";
    if (p.$type === "thinking") return "hsl(270 70% 55%)";
    if (p.$type === "response") return "hsl(var(--muted-foreground))";
    if (p.$type === "run") return "hsl(142 71% 45%)";
    if (p.$type === "task") return "hsl(25 95% 53%)";
    return "hsl(var(--primary) / 0.6)";
  }};
  background: ${(p) => {
    if (p.$status === "running") return "hsl(38 92% 50% / 0.3)";
    if (p.$status === "failed") return "hsl(var(--destructive) / 0.2)";
    if (p.$status === "completed") return "hsl(142 71% 45% / 0.2)";
    if (p.$type === "user") return "hsl(217 91% 60% / 0.2)";
    if (p.$type === "run") return "hsl(142 71% 45% / 0.2)";
    if (p.$type === "task") return "hsl(25 95% 53% / 0.2)";
    return "transparent";
  }};
`;

const ExecLogHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 3px;
`;

const ExecLogBadge = styled.span<{ $type: string; $status?: string }>`
  display: inline-flex;
  align-items: center;
  height: 17px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: ${(p) => {
    if (p.$status === "failed") return "hsl(var(--destructive))";
    if (p.$status === "running") return "hsl(38 92% 40%)";
    if (p.$status === "completed") return "hsl(142 71% 35%)";
    if (p.$type === "user") return "hsl(217 91% 45%)";
    if (p.$type === "thinking") return "hsl(270 70% 50%)";
    if (p.$type === "run") return "hsl(142 71% 35%)";
    if (p.$type === "task") return "hsl(25 95% 53%)";
    return "hsl(var(--muted-foreground))";
  }};
  background: ${(p) => {
    if (p.$status === "failed") return "hsl(var(--destructive) / 0.1)";
    if (p.$status === "running") return "hsl(38 92% 50% / 0.12)";
    if (p.$status === "completed") return "hsl(142 71% 45% / 0.1)";
    if (p.$type === "user") return "hsl(217 91% 60% / 0.1)";
    if (p.$type === "thinking") return "hsl(270 70% 55% / 0.1)";
    if (p.$type === "run") return "hsl(142 71% 45% / 0.1)";
    if (p.$type === "task") return "hsl(25 95% 53% / 0.1)";
    return "hsl(var(--muted) / 0.6)";
  }};
`;

const ExecLogTime = styled.span`
  margin-left: auto;
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.7);
  white-space: nowrap;
  flex-shrink: 0;
`;

const ExecLogContent = styled.div`
  font-size: 11.5px;
  color: hsl(var(--foreground) / 0.8);
  line-height: 1.55;
  word-break: break-word;
  white-space: pre-wrap;
`;

const ExecLogMeta = styled.div`
  margin-top: 3px;
  font-size: 10.5px;
  color: hsl(var(--muted-foreground));
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
`;

const ExecLogEmpty = styled.div`
  padding: 20px 16px;
  text-align: center;
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const ExecLogToolbar = styled.div`
  padding: 0 0 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const ExecLogToolbarRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const ExecLogFilterGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
`;

const ExecLogFilterChip = styled.button<{ $active: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  height: 26px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid
    ${(props) =>
      props.$active ? "hsl(var(--primary) / 0.32)" : "hsl(var(--border) / 0.85)"};
  background: ${(props) =>
    props.$active ? "hsl(var(--primary) / 0.1)" : "hsl(var(--background))"};
  color: ${(props) =>
    props.$active ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"};
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: hsl(var(--foreground));
    border-color: hsl(var(--primary) / 0.35);
    background: hsl(var(--accent) / 0.45);
  }
`;

const ExecLogMoreButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 96px;
  height: 30px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: hsl(var(--foreground));
    border-color: hsl(var(--primary) / 0.35);
    background: hsl(var(--accent) / 0.45);
  }

  &:disabled {
    cursor: default;
    opacity: 0.7;
  }
`;

const ExecLogFooter = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: center;
`;

const ExecLogDetailToggle = styled.button`
  margin-top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: hsl(var(--primary));
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: hsl(var(--foreground));
  }
`;

const ExecLogDetailPanel = styled.div`
  margin-top: 8px;
  padding: 10px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.8);
  background: hsl(var(--background) / 0.75);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const ExecLogDetailSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const ExecLogDetailLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
`;

const ExecLogDetailText = styled.div`
  font-size: 11px;
  line-height: 1.55;
  color: hsl(var(--foreground) / 0.86);
  word-break: break-word;
  white-space: pre-wrap;
`;

const ExecLogDetailList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const ExecLogDetailItem = styled.div`
  font-size: 11px;
  line-height: 1.5;
  color: hsl(var(--foreground) / 0.82);
`;

const ExecLogDetailTagList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const ExecLogDetailTag = styled.span`
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: hsl(var(--muted) / 0.9);
  color: hsl(var(--foreground) / 0.82);
  font-size: 10.5px;
  line-height: 1.3;
`;

/* ── end 执行日志 ── */

const SectionBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  background: hsl(var(--muted));
  color: hsl(var(--muted-foreground));
  font-size: 10px;
  font-weight: 600;
`;

const Section = styled.section<{ $allowOverflow?: boolean }>`
  padding: 14px 16px;
  border-bottom: 1px solid hsl(var(--border) / 0.7);
  ${(props) => props.$allowOverflow && `
    position: relative;
    z-index: 10;
  `}
`;

const SectionTitle = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  margin-bottom: 10px;
`;

const SidebarTopSlot = styled.div`
  padding: 12px 12px 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const NewTopicButton = styled.button`
  width: 100%;
  height: 38px;
  border-radius: 10px;
  border: 1px dashed hsl(var(--border));
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 12px;
  color: hsl(var(--foreground));
  background: hsl(var(--background));
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    background: hsl(var(--accent) / 0.6);
  }
`;

const ProgressText = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const ProgressBar = styled.div`
  height: 7px;
  border-radius: 999px;
  background: hsl(var(--muted));
  overflow: hidden;
  margin-top: 8px;
`;

const ProgressFill = styled.div<{ $percent: number }>`
  width: ${(props) => Math.max(0, Math.min(100, props.$percent))}%;
  height: 100%;
  background: hsl(var(--primary));
  transition: width 0.2s ease;
`;

const StepList = styled.div`
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const StepRow = styled.div<{ $status: StepStatus }>`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: ${(props) =>
    props.$status === "completed"
      ? "hsl(var(--foreground))"
      : "hsl(var(--muted-foreground))"};
`;

const AddContextButton = styled.button`
  width: 100%;
  height: 36px;
  border-radius: 10px;
  border: 1px dashed hsl(var(--border));
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 12px;
  color: hsl(var(--foreground));
  background: hsl(var(--background));

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
    background: hsl(var(--accent) / 0.5);
  }
`;

const ContextModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: 70;
  background: hsl(220 20% 10% / 0.46);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const ContextModalCard = styled.div`
  width: min(500px, calc(100vw - 48px));
  border-radius: 20px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  box-shadow: 0 24px 48px hsl(220 35% 8% / 0.22);
  overflow: hidden;
`;

const ContextModalHeader = styled.div`
  height: 66px;
  padding: 0 20px;
  border-bottom: 1px solid hsl(var(--border));
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const ContextModalTitle = styled.h3`
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  line-height: 1;
  color: hsl(var(--foreground));
`;

const ContextModalTitleCentered = styled(ContextModalTitle)`
  flex: 1;
  text-align: center;
  font-size: 20px;
`;

const ContextModalHeaderActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const ContextModalHeaderButton = styled.button`
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--accent) / 0.5);
  }
`;

const ContextModalBody = styled.div`
  padding: 14px 16px 16px;
`;

const ContextDropArea = styled.div<{ $dragging?: boolean }>`
  border: 1px dashed
    ${(props) =>
      props.$dragging ? "hsl(var(--primary) / 0.55)" : "hsl(var(--border))"};
  border-radius: 14px;
  min-height: 186px;
  padding: 16px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: ${(props) =>
    props.$dragging ? "hsl(var(--primary) / 0.06)" : "hsl(var(--muted) / 0.06)"};
  transition: border-color 0.2s ease, background 0.2s ease;
`;

const ContextDropHint = styled.div`
  font-size: 12px;
  color: hsl(var(--muted-foreground));
`;

const ContextModalActionGrid = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
`;

const ContextModalActionButton = styled.button`
  height: 34px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  padding: 0 14px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;

  &:hover {
    border-color: hsl(var(--primary) / 0.45);
    background: hsl(var(--accent) / 0.5);
  }
`;

const ContextModalErrorText = styled.div`
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.45;
  color: hsl(var(--destructive));
  text-align: center;
`;

const ContextTextarea = styled.textarea`
  width: 100%;
  min-height: 228px;
  border-radius: 18px;
  border: 2px solid hsl(var(--foreground) / 0.58);
  background: hsl(var(--background));
  padding: 14px 12px;
  resize: none;
  font-size: 13px;
  line-height: 1.5;
  color: hsl(var(--foreground));

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }

  &:focus {
    outline: none;
    border-color: hsl(var(--primary) / 0.45);
  }
`;

const ContextLinkInput = styled.input`
  width: 100%;
  height: 42px;
  border-radius: 12px;
  border: 2px solid hsl(var(--foreground) / 0.55);
  background: hsl(var(--background));
  padding: 0 12px;
  font-size: 13px;
  color: hsl(var(--foreground));

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }

  &:focus {
    outline: none;
    border-color: hsl(var(--primary) / 0.45);
  }
`;

const ContextModalFooter = styled.div`
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
`;

const ContextConfirmButton = styled.button<{ $disabled?: boolean }>`
  min-width: 86px;
  height: 38px;
  border: 0;
  border-radius: 999px;
  padding: 0 16px;
  background: ${(props) =>
    props.$disabled ? "hsl(var(--muted))" : "hsl(217 24% 90%)"};
  color: ${(props) =>
    props.$disabled ? "hsl(var(--muted-foreground))" : "hsl(218 20% 42%)"};
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};

  &:hover {
    opacity: ${(props) => (props.$disabled ? 1 : 0.92)};
  }
`;

const ContextSearchCard = styled.div`
  margin-top: 10px;
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--background));
  padding: 12px;
`;

const SearchInputWrap = styled.div`
  position: relative;
`;

const SearchInput = styled.input`
  width: 100%;
  height: 28px;
  border: 0;
  padding: 0 0 0 28px;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
  color: hsl(var(--foreground));

  &:focus {
    outline: none;
  }

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }
`;

const SearchIcon = styled(Search)`
  position: absolute;
  left: 0;
  top: 5px;
  color: hsl(var(--muted-foreground));
`;

const SearchActionRow = styled.div`
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const SearchModeTrigger = styled.button`
  min-width: 90px;
  height: 32px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 12px;
  font-size: 12px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));

  &:hover {
    border-color: hsl(var(--primary) / 0.45);
    background: hsl(var(--accent) / 0.45);
  }
`;

const SearchModeMenuRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
`;

const SearchModeMenuCheck = styled.span`
  margin-left: auto;
  color: hsl(var(--primary));
`;

const SearchSubmitButton = styled.button<{ $disabled: boolean }>`
  width: 28px;
  height: 28px;
  border-radius: 999px;
  border: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: ${(props) =>
    props.$disabled ? "hsl(var(--muted))" : "hsl(var(--secondary))"};
  color: ${(props) =>
    props.$disabled ? "hsl(var(--muted-foreground))" : "hsl(var(--primary))"};
  cursor: ${(props) => (props.$disabled ? "not-allowed" : "pointer")};

  &:hover {
    transform: ${(props) => (props.$disabled ? "none" : "scale(1.03)")};
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const SearchHintText = styled.div<{ $error?: boolean }>`
  margin-top: 10px;
  font-size: 11px;
  line-height: 1.5;
  color: ${(props) =>
    props.$error ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))"};
`;

const ContextQuery = styled.div`
  margin-top: 8px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const CompactContextList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const CompactContextRow = styled.div<{ $interactive?: boolean; $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid ${(props) =>
    props.$active ? 'hsl(var(--primary) / 0.3)' : 'hsl(var(--border))'};
  border-radius: 10px;
  padding: 12px 14px;
  background: ${(props) =>
    props.$active ? 'hsl(var(--primary) / 0.05)' : 'hsl(var(--background))'};
  cursor: ${(props) => (props.$interactive ? 'pointer' : 'default')};
  transition: all 0.15s ease;

  &:hover {
    border-color: ${(props) =>
      props.$interactive ? 'hsl(var(--primary) / 0.45)' : 'hsl(var(--border))'};
    background: ${(props) =>
      props.$interactive ? 'hsl(var(--accent) / 0.35)' : 'hsl(var(--background))'};
  }
`;

const CompactContextOpenButton = styled.button`
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  text-align: left;
  color: inherit;
  cursor: inherit;
`;

const CompactContextInfo = styled.div`
  min-width: 0;
  flex: 1;
`;

const CompactContextName = styled.div`
  font-size: 13px;
  line-height: 1.4;
  font-weight: 500;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CompactContextMeta = styled.div`
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.3;
  color: hsl(var(--muted-foreground) / 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SearchResultIconWrap = styled.div`
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: hsl(var(--primary));
  flex-shrink: 0;
`;

const CompactContextCheckbox = styled.input.attrs({ type: 'checkbox' })`
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1.5px solid hsl(var(--border));
  background: hsl(var(--background));
  cursor: pointer;
  flex-shrink: 0;
  appearance: none;
  position: relative;
  transition: all 0.15s ease;

  &:hover {
    border-color: hsl(var(--primary) / 0.6);
  }

  &:checked {
    background: hsl(var(--primary));
    border-color: hsl(var(--primary));
  }

  &:checked::after {
    content: '';
    position: absolute;
    left: 4px;
    top: 1px;
    width: 4px;
    height: 8px;
    border: solid white;
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }
`;

const DetailTopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const DetailBackButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  line-height: 1.2;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
  font-size: 11px;

  &:hover {
    color: hsl(var(--foreground));
  }
`;

const DetailCard = styled.div`
  border: 1px solid hsl(var(--border));
  border-radius: 14px;
  background: hsl(var(--background));
  padding: 12px;
`;

const DetailTitle = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: hsl(var(--foreground));
  line-height: 1.35;
`;

const DetailMeta = styled.div`
  margin-top: 8px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
`;

const DetailSection = styled.div`
  margin-top: 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: hsl(var(--muted) / 0.22);
  padding: 10px;
`;

const DetailSectionLabel = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--foreground));
`;

const DetailBody = styled.div`
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.75;
  color: hsl(var(--foreground));
  white-space: pre-wrap;
`;

const DetailSourceList = styled.div`
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const DetailSourceItem = styled.a`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: hsl(var(--primary));
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const BranchList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const BranchItem = styled.div<{ $active: boolean }>`
  border: 1px solid
    ${(props) =>
      props.$active ? "hsl(var(--primary) / 0.45)" : "hsl(var(--border))"};
  border-radius: 8px;
  padding: 7px;
  background: ${(props) =>
    props.$active ? "hsl(var(--primary) / 0.08)" : "hsl(var(--background))"};
`;

const BranchHead = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
`;

const BranchTitleButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  flex: 1;
  text-align: left;
  font-size: 11px;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
`;

const StatusBadge = styled.span<{ $status: TopicBranchStatus }>`
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 999px;
  color: ${(props) =>
    props.$status === "merged"
      ? "hsl(142 76% 30%)"
      : props.$status === "in_progress"
        ? "hsl(var(--primary))"
        : "hsl(var(--muted-foreground))"};
  background: ${(props) =>
    props.$status === "merged"
      ? "hsl(142 76% 90%)"
      : props.$status === "in_progress"
        ? "hsl(var(--primary) / 0.16)"
        : "hsl(var(--muted))"};
`;

const ActionRow = styled.div`
  margin-top: 6px;
  display: flex;
  gap: 5px;
`;

const TinyButton = styled.button`
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  border-radius: 6px;
  font-size: 11px;
  color: hsl(var(--foreground));
  padding: 3px 7px;

  &:hover {
    border-color: hsl(var(--primary) / 0.5);
  }
`;

const DeleteButton = styled.button`
  border: 0;
  background: transparent;
  color: hsl(var(--muted-foreground));
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;

  &:hover {
    color: hsl(var(--destructive));
    background: hsl(var(--destructive) / 0.12);
  }
`;

const ActivityList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const ActivityItem = styled.div`
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  border-radius: 8px;
  padding: 6px 7px;
  font-size: 11px;
`;

const ActivityGroupHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: hsl(var(--foreground));
`;

const ActivityTitle = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  color: hsl(var(--foreground));
`;

const ActivityMeta = styled.div`
  margin-top: 8px;
  padding: 8px 12px;
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.6;
  background: hsl(var(--muted) / 0.3);
  border-radius: 8px;
`;

const ActivityStepList = styled.div`
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ActivityStepItem = styled.div`
  border: 1px solid hsl(var(--border) / 0.8);
  border-radius: 6px;
  background: hsl(var(--muted) / 0.24);
  padding: 5px 6px;
`;

const RunLinkButton = styled.button`
  border: 0;
  background: transparent;
  padding: 0;
  margin: 0;
  color: hsl(var(--primary));
  cursor: pointer;
  font-size: 11px;
  line-height: 1.35;

  &:disabled {
    color: hsl(var(--muted-foreground));
    cursor: default;
  }
`;

const RunDetailPanel = styled.div`
  margin-top: 8px;
  border: 1px solid hsl(var(--border));
  border-radius: 8px;
  background: hsl(var(--background));
  padding: 8px;
`;

const RunDetailTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: hsl(var(--foreground));
  margin-bottom: 6px;
`;

const RunDetailRow = styled.div`
  font-size: 11px;
  color: hsl(var(--muted-foreground));
  line-height: 1.45;
  word-break: break-all;
`;

const RunDetailArtifacts = styled.div`
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const RunDetailArtifactRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`;

const RunDetailArtifactPath = styled.code`
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.4);
  border-radius: 6px;
  padding: 2px 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RunDetailCode = styled.pre`
  margin-top: 6px;
  font-size: 10px;
  line-height: 1.4;
  color: hsl(var(--foreground));
  background: hsl(var(--muted) / 0.5);
  border-radius: 6px;
  padding: 6px;
  max-height: 120px;
  overflow: auto;
`;

const RunDetailActions = styled.div`
  margin-top: 6px;
  display: flex;
  gap: 6px;
`;

const RunDetailActionButton = styled.button`
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  border-radius: 6px;
  font-size: 11px;
  color: hsl(var(--foreground));
  padding: 3px 7px;
  cursor: pointer;

  &:disabled {
    color: hsl(var(--muted-foreground));
    cursor: default;
  }
`;

function getStepIcon(status: StepStatus) {
  if (status === "completed") {
    return <CheckCircle2 size={13} />;
  }
  if (status === "active") {
    return <Clock3 size={13} />;
  }
  return <Circle size={11} />;
}

function getBranchStatusText(status: TopicBranchStatus): string {
  if (status === "in_progress") return "进行中";
  if (status === "pending") return "待评审";
  if (status === "merged") return "已合并";
  return "备选";
}

function formatGateLabel(
  gateKey?: SidebarActivityLog["gateKey"],
): string | null {
  if (!gateKey || gateKey === "idle") {
    return null;
  }
  if (gateKey === "topic_select") {
    return "选题闸门";
  }
  if (gateKey === "write_mode") {
    return "写作闸门";
  }
  if (gateKey === "publish_confirm") {
    return "发布闸门";
  }
  return null;
}

function formatRunIdShort(runId?: string): string | null {
  const trimmed = runId?.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length <= 8) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}…`;
}

function formatRunStatusLabel(status: AgentRun["status"]): string {
  if (status === "queued") return "排队中";
  if (status === "running") return "运行中";
  if (status === "success") return "成功";
  if (status === "error") return "失败";
  if (status === "canceled") return "已取消";
  if (status === "timeout") return "超时";
  return status;
}

function formatContextCreatedAt(createdAt?: number): string | null {
  if (!createdAt || !Number.isFinite(createdAt)) {
    return null;
  }
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRunMetadata(raw: string | null): string {
  if (!raw || !raw.trim()) {
    return "-";
  }
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

function normalizeArtifactPaths(raw?: string[]): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

function mergeArtifactPaths(current: string[], incoming?: string[]): string[] {
  const next = normalizeArtifactPaths(incoming);
  if (next.length === 0) {
    return current;
  }
  const merged = new Set(current);
  next.forEach((path) => merged.add(path));
  return Array.from(merged);
}

function formatActionErrorMessage(prefix: string, error: unknown): string {
  const candidates: string[] = [];
  if (typeof error === "string") {
    candidates.push(error);
  }
  if (error instanceof Error && error.message.trim()) {
    candidates.push(error.message);
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      candidates.push(message);
    }
  }

  const detail = candidates
    .map((item) => item.trim())
    .find((item) => item.length > 0);
  if (!detail) {
    return prefix;
  }
  if (detail === prefix || detail.startsWith(`${prefix}：`)) {
    return detail;
  }
  return `${prefix}：${detail}`;
}

interface ParsedRunMetadataSummary {
  workflow: string | null;
  executionId: string | null;
  versionId: string | null;
  stages: string[];
  artifactPaths: string[];
}

function parseRunMetadataSummary(raw: string | null): ParsedRunMetadataSummary {
  const fallback: ParsedRunMetadataSummary = {
    workflow: null,
    executionId: null,
    versionId: null,
    stages: [],
    artifactPaths: [],
  };
  if (!raw || !raw.trim()) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const readString = (value: unknown): string | null => {
      if (typeof value !== "string") {
        return null;
      }
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    };
    const readStringArray = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
    };

    return {
      workflow: readString(parsed.workflow),
      executionId: readString(parsed.execution_id),
      versionId: readString(parsed.version_id),
      stages: readStringArray(parsed.stages),
      artifactPaths: readStringArray(parsed.artifact_paths),
    };
  } catch {
    return fallback;
  }
}

function _formatStageLabelByKey(raw: string): string {
  if (raw === "topic_select") {
    return "选题闸门";
  }
  if (raw === "write_mode") {
    return "写作闸门";
  }
  if (raw === "publish_confirm") {
    return "发布闸门";
  }
  return raw;
}

async function writeClipboardText(text: string): Promise<void> {
  const value = text.trim();
  if (!value) {
    return;
  }
  const clipboard = navigator?.clipboard;
  if (!clipboard?.writeText) {
    return;
  }
  await clipboard.writeText(value);
}

type BranchMode = "topic" | "version";
type SidebarTab = "context" | "workflow" | "log";
type ActivityStatus = SidebarActivityLog["status"];

export interface ThemeWorkbenchCreationTaskEvent {
  taskId: string;
  taskType: string;
  path: string;
  absolutePath?: string;
  createdAt: number;
  timeLabel: string;
}

interface ActivityLogGroup {
  key: string;
  runId?: string;
  sessionId?: string;
  messageId?: string;
  status: ActivityStatus;
  source?: string;
  gateKey?: SidebarActivityLog["gateKey"];
  timeLabel: string;
  artifactPaths: string[];
  logs: SidebarActivityLog[];
}

interface CreationTaskGroup {
  key: string;
  taskType: string;
  label: string;
  latestTimeLabel: string;
  tasks: ThemeWorkbenchCreationTaskEvent[];
}

function mergeActivityStatus(
  previous: ActivityStatus,
  next: ActivityStatus,
): ActivityStatus {
  if (previous === "running" || next === "running") {
    return "running";
  }
  if (previous === "failed" || next === "failed") {
    return "failed";
  }
  return "completed";
}

function resolveActivityGroupKey(log: SidebarActivityLog): {
  key: string;
  runId?: string;
  messageId?: string;
} {
  const normalizedRunId = log.runId?.trim();
  if (normalizedRunId) {
    return {
      key: `run:${normalizedRunId}`,
      runId: normalizedRunId,
    };
  }

  const normalizedMessageId = log.messageId?.trim();
  if (normalizedMessageId) {
    return {
      key: `message:${normalizedMessageId}`,
      messageId: normalizedMessageId,
    };
  }

  return {
    key: `orphan:${log.id}`,
  };
}

function _resolveActivityMarker(status: ActivityStatus): string {
  if (status === "completed") {
    return "✓";
  }
  if (status === "failed") {
    return "✕";
  }
  return "●";
}

function _formatLogActionLabel(log: SidebarActivityLog): string {
  const normalizedSource = log.source?.trim().toLowerCase();
  if (normalizedSource === "skill") {
    return `技能：${log.name}`;
  }
  return `动作：${log.name}`;
}

function _formatArtifactPathsLabel(paths?: string[]): string {
  if (!paths || paths.length === 0) {
    return "主稿内容";
  }
  if (paths.length === 1) {
    return paths[0];
  }
  return `${paths[0]} 等 ${paths.length} 个产物`;
}

function formatCreationTaskTypeLabel(taskType: string): string {
  const normalized = taskType.trim().toLowerCase();
  if (normalized === "video_generate") {
    return "视频生成";
  }
  if (normalized === "broadcast_generate") {
    return "播客整理";
  }
  if (normalized === "cover_generate") {
    return "封面生成";
  }
  if (normalized === "modal_resource_search") {
    return "资源检索";
  }
  if (normalized === "image_generate") {
    return "配图生成";
  }
  if (normalized === "url_parse") {
    return "链接解析";
  }
  if (normalized === "typesetting") {
    return "排版优化";
  }
  return taskType.trim() || "未分类任务";
}

function resolveContextSourceSubLabel(
  source: "material" | "content" | "search",
  searchMode?: "web" | "social",
): string {
  if (source === "material") {
    return "素材库";
  }
  if (source === "content") {
    return "历史内容";
  }
  return searchMode === "social" ? "社交媒体" : "网络搜索";
}

function resolveFileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || "上下文文件";
}

type ExecLogFilter = "all" | "skill" | "tool" | "failed";

interface ExecLogEntryDetail {
  kind?: "skill" | "tool";
  sourceRef?: string;
  description?: string;
  workflowSteps?: string[];
  allowedTools?: string[];
  whenToUse?: string;
  artifactPaths?: string[];
  argumentsText?: string;
  resultText?: string;
  errorText?: string;
}

interface ExecLogEntry {
  id: string;
  type: "user" | "thinking" | "response" | "tool" | "run" | "task";
  typeLabel: string;
  content: string;
  meta?: string;
  timestamp: Date;
  status?: "running" | "completed" | "failed";
  detail?: ExecLogEntryDetail;
}

const EXEC_LOG_FILTER_OPTIONS: Array<{
  key: ExecLogFilter;
  label: string;
}> = [
  { key: "all", label: "全部" },
  { key: "skill", label: "技能" },
  { key: "tool", label: "工具" },
  { key: "failed", label: "失败" },
];

function matchesExecLogFilter(entry: ExecLogEntry, filter: ExecLogFilter): boolean {
  if (filter === "skill") {
    return entry.type === "run";
  }
  if (filter === "tool") {
    return entry.type === "tool";
  }
  if (filter === "failed") {
    return entry.status === "failed";
  }
  return true;
}

interface ThemeWorkbenchSidebarProps {
  branchMode?: BranchMode;
  onNewTopic: () => void;
  onSwitchTopic: (topicId: string) => void;
  onDeleteTopic: (topicId: string) => void;
  branchItems: TopicBranchItem[];
  onSetBranchStatus: (topicId: string, status: TopicBranchStatus) => void;
  workflowSteps: Array<{ id: string; title: string; status: StepStatus }>;
  contextSearchQuery: string;
  onContextSearchQueryChange: (value: string) => void;
  contextSearchMode: "web" | "social";
  onContextSearchModeChange: (value: "web" | "social") => void;
  contextSearchLoading: boolean;
  contextSearchError?: string | null;
  contextSearchBlockedReason?: string | null;
  onSubmitContextSearch: () => Promise<void> | void;
  onAddTextContext?: (payload: {
    content: string;
    name?: string;
  }) => Promise<void> | void;
  onAddLinkContext?: (payload: {
    url: string;
    name?: string;
  }) => Promise<void> | void;
  onAddFileContext?: (payload: {
    path: string;
    name?: string;
  }) => Promise<void> | void;
  onAddImage?: () => Promise<void> | void;
  onImportDocument?: () => Promise<void> | void;
  contextItems: Array<{
    id: string;
    name: string;
    source: "material" | "content" | "search";
    searchMode?: "web" | "social";
    query?: string;
    previewText?: string;
    citations?: Array<{ title: string; url: string }>;
    createdAt?: number;
    active: boolean;
  }>;
  onToggleContextActive: (contextId: string) => void;
  onViewContextDetail?: (contextId: string) => void;
  contextBudget: {
    activeCount: number;
    activeCountLimit: number;
    estimatedTokens: number;
    tokenLimit: number;
  };
  activityLogs: SidebarActivityLog[];
  creationTaskEvents?: ThemeWorkbenchCreationTaskEvent[];
  onViewRunDetail?: (runId: string) => void;
  activeRunDetail?: AgentRun | null;
  activeRunDetailLoading?: boolean;
  onRequestCollapse?: () => void;
  historyHasMore?: boolean;
  historyLoading?: boolean;
  onLoadMoreHistory?: () => void;
  skillDetailMap?: Record<string, SkillDetailInfo | null>;
  headerActionSlot?: ReactNode;
  topSlot?: ReactNode;
  /** 完整的对话消息列表，用于执行日志 tab */
  messages?: Message[];
}

function ThemeWorkbenchSidebarComponent({
  branchMode = "version",
  onNewTopic,
  onSwitchTopic,
  onDeleteTopic,
  branchItems,
  onSetBranchStatus,
  workflowSteps,
  contextSearchQuery,
  onContextSearchQueryChange,
  contextSearchMode,
  onContextSearchModeChange,
  contextSearchLoading,
  contextSearchError,
  contextSearchBlockedReason,
  onSubmitContextSearch,
  onAddTextContext,
  onAddLinkContext,
  onAddFileContext,
  onAddImage,
  onImportDocument,
  contextItems,
  onToggleContextActive,
  onViewContextDetail,
  contextBudget,
  activityLogs,
  creationTaskEvents = [],
  onViewRunDetail,
  activeRunDetail,
  activeRunDetailLoading = false,
  onRequestCollapse,
  historyHasMore = false,
  historyLoading = false,
  onLoadMoreHistory,
  skillDetailMap = {},
  headerActionSlot,
  topSlot,
  messages = [],
}: ThemeWorkbenchSidebarProps) {
  const [showActivityLogs, setShowActivityLogs] = useState(false);
  const [showCreationTasks, setShowCreationTasks] = useState(true);
  const [activeTab, setActiveTab] = useState<SidebarTab>("context");
  const [execLogFilter, setExecLogFilter] = useState<ExecLogFilter>("all");
  const [expandedExecLogIds, setExpandedExecLogIds] = useState<string[]>([]);
  const [selectedSearchResultId, setSelectedSearchResultId] = useState<string | null>(null);
  const renderCountRef = useRef(0);
  const lastCommitAtRef = useRef<number | null>(null);
  renderCountRef.current += 1;
  const currentRenderCount = renderCountRef.current;
  const isVersionMode = branchMode === "version";
  const completedSteps = useMemo(
    () => workflowSteps.filter((step) => step.status === "completed").length,
    [workflowSteps],
  );
  const progressPercent =
    workflowSteps.length > 0 ? (completedSteps / workflowSteps.length) * 100 : 0;
  const runMetadataText = useMemo(
    () => formatRunMetadata(activeRunDetail?.metadata ?? null),
    [activeRunDetail?.metadata],
  );
  const runMetadataSummary = useMemo(
    () => parseRunMetadataSummary(activeRunDetail?.metadata ?? null),
    [activeRunDetail?.metadata],
  );
  const runDetailSessionId = activeRunDetail?.session_id?.trim() || null;
  const handleRevealArtifactInFinder = useCallback(
    async (artifactPath: string, sessionId?: string | null) => {
      const resolvedSessionId = sessionId?.trim() || runDetailSessionId;
      if (!resolvedSessionId) {
        toast.error("缺少会话ID，无法定位产物文件");
        return;
      }
      try {
        await revealSessionFileInFinder(resolvedSessionId, artifactPath);
      } catch (error) {
        console.warn("[ThemeWorkbenchSidebar] 定位产物文件失败:", error);
        toast.error(formatActionErrorMessage("定位产物文件失败", error));
      }
    },
    [runDetailSessionId],
  );
  const handleOpenArtifactWithDefaultApp = useCallback(
    async (artifactPath: string, sessionId?: string | null) => {
      const resolvedSessionId = sessionId?.trim() || runDetailSessionId;
      if (!resolvedSessionId) {
        toast.error("缺少会话ID，无法打开产物文件");
        return;
      }
      try {
        await openSessionFileWithDefaultApp(resolvedSessionId, artifactPath);
      } catch (error) {
        console.warn("[ThemeWorkbenchSidebar] 打开产物文件失败:", error);
        toast.error(formatActionErrorMessage("打开产物文件失败", error));
      }
    },
    [runDetailSessionId],
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const isSearchActionDisabled =
    contextSearchLoading ||
    Boolean(contextSearchBlockedReason) ||
    contextSearchQuery.trim().length === 0;
  const activeContextItems = useMemo(
    () => contextItems.filter((item) => item.active),
    [contextItems],
  );
  const searchContextItems = useMemo(
    () => contextItems.filter((item) => item.source === "search"),
    [contextItems],
  );
  const orderedContextItems = useMemo(
    () =>
      [...contextItems].sort((left, right) => {
        if (left.active !== right.active) {
          return left.active ? -1 : 1;
        }
        if (left.source !== right.source) {
          return left.source === "search" ? -1 : 1;
        }
        const createdDelta = (right.createdAt || 0) - (left.createdAt || 0);
        if (createdDelta !== 0) {
          return createdDelta;
        }
        return left.name.localeCompare(right.name, "zh-CN");
      }),
    [contextItems],
  );

  useEffect(() => {
    const now = performance.now();
    const sinceLastCommitMs =
      lastCommitAtRef.current === null ? null : now - lastCommitAtRef.current;
    lastCommitAtRef.current = now;
    logRenderPerf(
      "ThemeWorkbenchSidebar",
      currentRenderCount,
      sinceLastCommitMs,
      {
        activeTab,
        showActivityLogs,
        contextSearchLoading,
        branchItemsCount: branchItems.length,
        workflowStepsCount: workflowSteps.length,
        contextItemsCount: contextItems.length,
        activeContextCount: activeContextItems.length,
        activityLogsCount: activityLogs.length,
        creationTaskEventsCount: creationTaskEvents.length,
        hasActiveRunDetail: Boolean(activeRunDetail),
      },
    );
  });
  const latestSearchLabel = useMemo(() => {
    if (searchContextItems.length === 0) {
      return "尚未联网检索";
    }
    const latestLabel = formatContextCreatedAt(searchContextItems[0]?.createdAt);
    return latestLabel ? `最近检索 ${latestLabel}` : `已生成 ${searchContextItems.length} 条结果`;
  }, [searchContextItems]);
  const selectedSearchResult = useMemo(
    () =>
      searchContextItems.find((item) => item.id === selectedSearchResultId) || null,
    [searchContextItems, selectedSearchResultId],
  );
  const [addContextDialogOpen, setAddContextDialogOpen] = useState(false);
  const [addTextDialogOpen, setAddTextDialogOpen] = useState(false);
  const [addLinkDialogOpen, setAddLinkDialogOpen] = useState(false);
  const [contextDraftText, setContextDraftText] = useState("");
  const [contextDraftLink, setContextDraftLink] = useState("");
  const [contextCreateLoading, setContextCreateLoading] = useState(false);
  const [contextCreateError, setContextCreateError] = useState<string | null>(null);
  const [contextDropActive, setContextDropActive] = useState(false);
  const closeAllContextDialogs = useCallback(() => {
    setAddContextDialogOpen(false);
    setAddTextDialogOpen(false);
    setAddLinkDialogOpen(false);
    setContextDropActive(false);
    setContextCreateError(null);
    setContextDraftText("");
    setContextDraftLink("");
  }, []);
  const openAddContextDialog = useCallback(() => {
    setContextCreateError(null);
    setAddLinkDialogOpen(false);
    setAddTextDialogOpen(false);
    setAddContextDialogOpen(true);
  }, []);
  const runContextAction = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      setContextCreateLoading(true);
      setContextCreateError(null);
      try {
        await action();
        toast.success(successMessage);
        closeAllContextDialogs();
      } catch (error) {
        const nextError = formatActionErrorMessage("添加上下文失败", error);
        setContextCreateError(nextError);
      } finally {
        setContextCreateLoading(false);
      }
    },
    [closeAllContextDialogs],
  );
  const handleChooseContextFile = useCallback(async () => {
    if (!onAddFileContext) {
      setContextCreateError("当前版本暂不支持上传文件上下文");
      return;
    }

    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
      });
      if (!selected || typeof selected !== "string") {
        return;
      }

      await runContextAction(
        async () => {
          await onAddFileContext({
            path: selected,
            name: resolveFileNameFromPath(selected),
          });
        },
        "已添加文件上下文",
      );
    } catch (error) {
      const nextError = formatActionErrorMessage("读取文件失败", error);
      setContextCreateError(nextError);
    }
  }, [onAddFileContext, runContextAction]);
  const handleDropContextFile = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setContextDropActive(false);

      const file = event.dataTransfer.files?.[0];
      if (!file) {
        return;
      }

      const fileWithPath = file as File & { path?: string };
      if (fileWithPath.path && onAddFileContext) {
        await runContextAction(
          async () => {
            await onAddFileContext({
              path: fileWithPath.path || "",
              name: file.name,
            });
          },
          "已添加文件上下文",
        );
        return;
      }

      if (!onAddTextContext) {
        setContextCreateError("当前环境无法读取拖拽文件路径，请使用“上传文件”按钮");
        return;
      }

      await runContextAction(
        async () => {
          const content = await file.text();
          if (!content.trim()) {
            throw new Error("文件内容为空");
          }
          await onAddTextContext({
            content,
            name: file.name,
          });
        },
        "已添加文本上下文",
      );
    },
    [onAddFileContext, onAddTextContext, runContextAction],
  );
  const handleSubmitTextContext = useCallback(async () => {
    if (!onAddTextContext) {
      setContextCreateError("当前版本暂不支持输入文本上下文");
      return;
    }
    const normalizedText = contextDraftText.trim();
    if (!normalizedText) {
      setContextCreateError("请输入文本内容");
      return;
    }
    await runContextAction(
      async () => {
        await onAddTextContext({
          content: normalizedText,
        });
      },
      "已添加文本上下文",
    );
  }, [contextDraftText, onAddTextContext, runContextAction]);
  const handleSubmitLinkContext = useCallback(async () => {
    if (!onAddLinkContext) {
      setContextCreateError("当前版本暂不支持网站链接上下文");
      return;
    }
    const normalizedLink = contextDraftLink.trim();
    if (!normalizedLink) {
      setContextCreateError("请输入网站链接");
      return;
    }
    await runContextAction(
      async () => {
        await onAddLinkContext({
          url: normalizedLink,
        });
      },
      "已添加网站链接上下文",
    );
  }, [contextDraftLink, onAddLinkContext, runContextAction]);
  const groupedActivityLogs = useMemo<ActivityLogGroup[]>(() => {
    if (activityLogs.length === 0) {
      return [];
    }

    const groups: ActivityLogGroup[] = [];
    const groupByKey = new Map<string, ActivityLogGroup>();

    activityLogs.forEach((log) => {
      const identity = resolveActivityGroupKey(log);
      const existingGroup = groupByKey.get(identity.key);
      if (!existingGroup) {
        const nextGroup: ActivityLogGroup = {
          key: identity.key,
          runId: identity.runId,
          sessionId: log.sessionId?.trim() || undefined,
          messageId: identity.messageId,
          status: log.status,
          source: log.source,
          gateKey: log.gateKey,
          timeLabel: log.timeLabel,
          artifactPaths: normalizeArtifactPaths(log.artifactPaths),
          logs: [log],
        };
        groups.push(nextGroup);
        groupByKey.set(identity.key, nextGroup);
        return;
      }

      existingGroup.logs.push(log);
      existingGroup.status = mergeActivityStatus(existingGroup.status, log.status);
      if (!existingGroup.source && log.source) {
        existingGroup.source = log.source;
      }
      if (!existingGroup.sessionId && log.sessionId?.trim()) {
        existingGroup.sessionId = log.sessionId.trim();
      }
      if (!existingGroup.gateKey && log.gateKey) {
        existingGroup.gateKey = log.gateKey;
      }
      if (
        (existingGroup.timeLabel === "--:--" || !existingGroup.timeLabel) &&
        log.timeLabel &&
        log.timeLabel !== "--:--"
      ) {
        existingGroup.timeLabel = log.timeLabel;
      }
      existingGroup.artifactPaths = mergeArtifactPaths(
        existingGroup.artifactPaths,
        log.artifactPaths,
      );
    });

    return groups;
  }, [activityLogs]);

  const groupedCreationTaskEvents = useMemo<CreationTaskGroup[]>(() => {
    if (creationTaskEvents.length === 0) {
      return [];
    }

    const groupMap = new Map<string, CreationTaskGroup>();
    creationTaskEvents.forEach((task) => {
      const groupKey = task.taskType.trim().toLowerCase() || "unknown";
      const existing = groupMap.get(groupKey);
      if (!existing) {
        groupMap.set(groupKey, {
          key: groupKey,
          taskType: task.taskType,
          label: formatCreationTaskTypeLabel(task.taskType),
          latestTimeLabel: task.timeLabel,
          tasks: [task],
        });
        return;
      }
      existing.tasks.push(task);
      if (
        task.createdAt >
        (existing.tasks[0]?.createdAt || Number.MIN_SAFE_INTEGER)
      ) {
        existing.latestTimeLabel = task.timeLabel;
      }
    });

    return Array.from(groupMap.values())
      .map((group) => {
        const sortedTasks = [...group.tasks].sort(
          (left, right) => right.createdAt - left.createdAt,
        );
        return {
          ...group,
          latestTimeLabel: sortedTasks[0]?.timeLabel || group.latestTimeLabel,
          tasks: sortedTasks,
        };
      })
      .sort((left, right) => {
        const leftLatest = left.tasks[0]?.createdAt || 0;
        const rightLatest = right.tasks[0]?.createdAt || 0;
        return rightLatest - leftLatest;
      });
  }, [creationTaskEvents]);

  const renderActivityLogItem = useCallback(
    (group: ActivityLogGroup) => {
      const gateLabel = formatGateLabel(group.gateKey);
      const runLabel = formatRunIdShort(group.runId);
      const sourceLabel = group.source?.trim() || "-";
      const primaryLog =
        group.logs.find((log) => log.source === "skill") || group.logs[0];

      return (
        <ActivityItem key={`activity-${group.key}`}>
          <ActivityGroupHeader>
            <span>●</span>
            <span>{primaryLog?.source === "skill" ? `技能：${primaryLog.name}` : primaryLog?.name || "活动日志"}</span>
            <span style={{ marginLeft: "auto" }}>{group.timeLabel}</span>
          </ActivityGroupHeader>
          {gateLabel || sourceLabel ? (
            <ActivityMeta>
              {gateLabel ? `闸门：${gateLabel}` : ""}
              {gateLabel && sourceLabel ? " · " : ""}
              {sourceLabel ? `来源：${sourceLabel}` : ""}
            </ActivityMeta>
          ) : null}
          {group.artifactPaths.length > 0 ? (
            <ActivityMeta>
              修改：{group.artifactPaths.join("、")}
            </ActivityMeta>
          ) : null}
          <ActivityStepList>
            {group.logs.map((log) => (
              <ActivityStepItem key={log.id}>
                <ActivityTitle>
                  <span>•</span>
                  <span>{log.name}</span>
                  <span style={{ marginLeft: "auto" }}>{log.timeLabel}</span>
                </ActivityTitle>
                {log.inputSummary ? (
                  <ActivityMeta>输入：{log.inputSummary}</ActivityMeta>
                ) : null}
                {log.outputSummary ? (
                  <ActivityMeta>输出：{log.outputSummary}</ActivityMeta>
                ) : null}
              </ActivityStepItem>
            ))}
          </ActivityStepList>
          <ActionRow>
            {group.runId && onViewRunDetail ? (
              <RunLinkButton
                type="button"
                onClick={() => onViewRunDetail(group.runId!)}
              >
                运行：{runLabel || group.runId}
              </RunLinkButton>
            ) : null}
            {group.artifactPaths.map((artifactPath) => (
              <React.Fragment key={`${group.key}-${artifactPath}`}>
                <TinyButton
                  type="button"
                  aria-label={`定位活动产物路径-${artifactPath}`}
                  onClick={() => {
                    void handleRevealArtifactInFinder(artifactPath, group.sessionId || null);
                  }}
                >
                  定位产物
                </TinyButton>
                <TinyButton
                  type="button"
                  aria-label={`打开活动产物路径-${artifactPath}`}
                  onClick={() => {
                    void handleOpenArtifactWithDefaultApp(artifactPath, group.sessionId || null);
                  }}
                >
                  打开产物
                </TinyButton>
              </React.Fragment>
            ))}
          </ActionRow>
        </ActivityItem>
      );
    },
    [handleOpenArtifactWithDefaultApp, handleRevealArtifactInFinder, onViewRunDetail],
  );

  const activeRunStagesLabel = useMemo(() => {
    if (runMetadataSummary.stages.length === 0) {
      return null;
    }
    return runMetadataSummary.stages
      .map((stage) => _formatStageLabelByKey(stage))
      .join(" → ");
  }, [runMetadataSummary.stages]);

  const [execLogClearedAt, setExecLogClearedAt] = useState<number | null>(null);

  function resolveToolLabel(toolName: string): string {
    const n = toolName.trim().toLowerCase();
    if (n === "list_skills") return "获取技能列表";
    if (n === "load_skill") return "加载技能";
    if (n.includes("write_file") || n.includes("create_file")) return "创建文件";
    if (n.includes("read_file")) return "读取文件";
    if (n.includes("websearch")) return "网络检索";
    if (n.includes("webfetch")) return "网页抓取";
    if (n.includes("social_generate_cover") || n.includes("generate_image")) return "生成封面图";
    if (n.includes("execute") || n.includes("bash")) return "执行命令";
    if (n.includes("context") || n.includes("retrieve")) return "检索上下文";
    return toolName;
  }

  function truncate(text: string, max = 300): string {
    if (!text) return "";
    const t = text.trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  function formatExecLogJson(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) {
        return undefined;
      }
      try {
        return JSON.stringify(JSON.parse(normalized), null, 2);
      } catch {
        return normalized;
      }
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  const execLogEntries = useMemo<ExecLogEntry[]>(() => {
    const entries: ExecLogEntry[] = [];
    let idx = 0;
    for (const msg of messages) {
      if (msg.role === "user") {
        entries.push({
          id: `${msg.id}-user`,
          type: "user",
          typeLabel: "用户请求",
          content: truncate(msg.content, 200),
          timestamp: msg.timestamp,
        });
      } else {
        // thinking
        if (msg.thinkingContent) {
          entries.push({
            id: `${msg.id}-thinking`,
            type: "thinking",
            typeLabel: "深度思考",
            content: truncate(msg.thinkingContent, 200),
            timestamp: msg.timestamp,
          });
        }
        // tool calls
        for (const tc of msg.toolCalls || []) {
          let argsPreview = "";
          let parsedArguments: unknown = undefined;
          try {
            const parsed = JSON.parse(tc.arguments || "{}");
            parsedArguments = parsed;
            const keys = Object.keys(parsed);
            const preview = keys.slice(0, 2).map((k) => {
              const v = String(parsed[k] ?? "");
              return `${k}: ${v.slice(0, 60)}${v.length > 60 ? "…" : ""}`;
            });
            argsPreview = preview.join(" · ");
          } catch {
            argsPreview = truncate(tc.arguments || "", 120);
            parsedArguments = tc.arguments || undefined;
          }
          const resultMeta = tc.result?.error
            ? `❌ ${truncate(tc.result.error, 120)}`
            : tc.result?.output
              ? truncate(tc.result.output, 200)
              : undefined;
          const detail: ExecLogEntryDetail | undefined =
            tc.arguments ||
            tc.result?.output ||
            tc.result?.error
              ? {
                  kind: "tool",
                  argumentsText: formatExecLogJson(parsedArguments),
                  resultText: formatExecLogJson(tc.result?.output),
                  errorText: tc.result?.error?.trim() || undefined,
                }
              : undefined;
          entries.push({
            id: `${msg.id}-tc-${tc.id}-${idx++}`,
            type: "tool",
            typeLabel: resolveToolLabel(tc.name),
            content: argsPreview || tc.name,
            meta: resultMeta,
            timestamp: tc.startTime || msg.timestamp,
            status: tc.status,
            detail,
          });
        }
        // text response
        if (msg.content?.trim() && !msg.isThinking) {
          entries.push({
            id: `${msg.id}-resp`,
            type: "response",
            typeLabel: "AI 响应",
            content: truncate(msg.content, 200),
            timestamp: msg.timestamp,
          });
        }
      }
    }

    // ── 来自后端编排系统的运行记录（活动日志迁移）──
    for (const group of groupedActivityLogs) {
      const ts = (() => {
        // timeLabel 格式 "HH:mm" 或 "HH:mm:ss"，用今天的日期构造
        try {
          const parts = group.timeLabel.split(":");
          if (parts.length >= 2) {
            const d = new Date();
            d.setHours(Number(parts[0]), Number(parts[1]), Number(parts[2] || 0), 0);
            return d;
          }
        } catch { /* ignore */ }
        return new Date(0);
      })();
      const skillLog = group.logs.find((l) => l.source === "skill");
      const sourceRef =
        group.logs.find((log) => log.sourceRef?.trim())?.sourceRef?.trim() ||
        null;
      const skillDetail = sourceRef ? skillDetailMap[sourceRef] || null : null;
      const skillName =
        skillDetail?.display_name?.trim() || skillLog?.name || group.source || "";
      const detailSummary = skillDetail?.description?.trim() || null;
      const workflowSteps = (skillDetail?.workflow_steps || [])
        .map((step) => step.name?.trim() || step.id?.trim() || "")
        .filter((step): step is string => Boolean(step));
      const allowedTools = (skillDetail?.allowed_tools || [])
        .map((toolName) => resolveToolLabel(toolName))
        .filter((toolName): toolName is string => Boolean(toolName));
      const detail: ExecLogEntryDetail | undefined =
        sourceRef ||
        detailSummary ||
        workflowSteps.length > 0 ||
        allowedTools.length > 0 ||
        skillDetail?.when_to_use?.trim() ||
        group.artifactPaths.length > 0
          ? {
              kind: "skill",
              sourceRef: sourceRef || undefined,
              description: detailSummary || undefined,
              workflowSteps: workflowSteps.length > 0 ? workflowSteps : undefined,
              allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
              whenToUse: skillDetail?.when_to_use?.trim() || undefined,
              artifactPaths:
                group.artifactPaths.length > 0 ? [...group.artifactPaths] : undefined,
            }
          : undefined;
      const artifactSummary = group.artifactPaths.length > 0
        ? `产物：${group.artifactPaths.map((p) => p.split("/").pop()).join("、")}`
        : undefined;
      const durationLabel = group.logs.find((l) => l.durationLabel)?.durationLabel;
      const runMeta = [
        sourceRef ? `技能标识：${sourceRef}` : null,
        detailSummary,
        artifactSummary,
      ]
        .filter((item): item is string => Boolean(item))
        .join(" · ");
      entries.push({
        id: `run-${group.key}`,
        type: "run",
        typeLabel: skillName ? `技能：${skillName}` : "编排运行",
        content: skillName
          ? `执行技能 ${skillName}${durationLabel ? `  ${durationLabel}` : ""}`
          : `编排运行${durationLabel ? `  ${durationLabel}` : ""}`,
        meta: runMeta || undefined,
        timestamp: ts,
        status: group.status,
        detail,
      });
    }

    // ── 来自任务提交的记录（创作任务迁移）──
    for (const group of groupedCreationTaskEvents) {
      const latestTask = group.tasks[group.tasks.length - 1];
      const ts = latestTask?.createdAt ? new Date(latestTask.createdAt) : new Date(0);
      entries.push({
        id: `task-${group.key}`,
        type: "task",
        typeLabel: "任务提交",
        content: group.label || group.taskType,
        timestamp: ts,
        status: "completed",
      });
    }

    // 按时间升序排列
    entries.sort((a, b) => {
      const ta = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
      const tb = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
      return ta - tb;
    });

    return entries;
  }, [messages, groupedActivityLogs, groupedCreationTaskEvents, skillDetailMap]);

  const visibleExecLogEntries = useMemo(() => {
    if (execLogClearedAt === null) {
      return execLogEntries;
    }
    return execLogEntries.filter((entry) => {
      const timestamp = entry.timestamp instanceof Date
        ? entry.timestamp.getTime()
        : new Date(entry.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp > execLogClearedAt;
    });
  }, [execLogClearedAt, execLogEntries]);

  const filteredExecLogEntries = useMemo(
    () =>
      visibleExecLogEntries.filter((entry) => matchesExecLogFilter(entry, execLogFilter)),
    [execLogFilter, visibleExecLogEntries],
  );

  const toggleExecLogDetail = useCallback((entryId: string) => {
    setExpandedExecLogIds((previous) =>
      previous.includes(entryId)
        ? previous.filter((id) => id !== entryId)
        : [...previous, entryId],
    );
  }, []);

  const execLogBottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    execLogBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredExecLogEntries.length]);

  const _resolveActivityGroupSessionId = useCallback(
    (group: ActivityLogGroup): string | null => {
      const normalizedGroupSessionId = group.sessionId?.trim();
      if (normalizedGroupSessionId) {
        return normalizedGroupSessionId;
      }
      if (group.runId && activeRunDetail?.id === group.runId && runDetailSessionId) {
        return runDetailSessionId;
      }
      return null;
    },
    [activeRunDetail?.id, runDetailSessionId],
  );

  const renderExecLogDetail = useCallback((entry: ExecLogEntry) => {
    if (!entry.detail) {
      return null;
    }
    const isExpanded = expandedExecLogIds.includes(entry.id);
    const detailLabel = entry.detail.kind === "tool" ? "工具详情" : "技能详情";
    const hasDetailContent =
      Boolean(entry.detail.sourceRef) ||
      Boolean(entry.detail.description) ||
      Boolean(entry.detail.whenToUse) ||
      Boolean(entry.detail.workflowSteps?.length) ||
      Boolean(entry.detail.allowedTools?.length) ||
      Boolean(entry.detail.artifactPaths?.length) ||
      Boolean(entry.detail.argumentsText) ||
      Boolean(entry.detail.resultText) ||
      Boolean(entry.detail.errorText);

    if (!hasDetailContent) {
      return null;
    }

    return (
      <>
        <ExecLogDetailToggle
          type="button"
          aria-label={`${isExpanded ? "收起" : "查看"}${detailLabel}-${entry.id}`}
          onClick={() => toggleExecLogDetail(entry.id)}
        >
          {isExpanded ? `收起${detailLabel}` : `查看${detailLabel}`}
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </ExecLogDetailToggle>
        {isExpanded ? (
          <ExecLogDetailPanel>
            {entry.detail.argumentsText ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>请求参数</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.argumentsText}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.resultText ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>执行结果</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.resultText}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.errorText ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>错误信息</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.errorText}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.sourceRef ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>技能标识</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.sourceRef}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.description ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>技能说明</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.description}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.whenToUse ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>适用场景</ExecLogDetailLabel>
                <ExecLogDetailText>{entry.detail.whenToUse}</ExecLogDetailText>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.workflowSteps && entry.detail.workflowSteps.length > 0 ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>工作流步骤</ExecLogDetailLabel>
                <ExecLogDetailList>
                  {entry.detail.workflowSteps.map((step, index) => (
                    <ExecLogDetailItem key={`${entry.id}-workflow-${index}`}>
                      {index + 1}. {step}
                    </ExecLogDetailItem>
                  ))}
                </ExecLogDetailList>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.allowedTools && entry.detail.allowedTools.length > 0 ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>允许工具</ExecLogDetailLabel>
                <ExecLogDetailTagList>
                  {entry.detail.allowedTools.map((toolName) => (
                    <ExecLogDetailTag key={`${entry.id}-tool-${toolName}`}>
                      {toolName}
                    </ExecLogDetailTag>
                  ))}
                </ExecLogDetailTagList>
              </ExecLogDetailSection>
            ) : null}
            {entry.detail.artifactPaths && entry.detail.artifactPaths.length > 0 ? (
              <ExecLogDetailSection>
                <ExecLogDetailLabel>关联产物</ExecLogDetailLabel>
                <ExecLogDetailList>
                  {entry.detail.artifactPaths.map((artifactPath) => (
                    <ExecLogDetailItem key={`${entry.id}-artifact-${artifactPath}`}>
                      {artifactPath}
                    </ExecLogDetailItem>
                  ))}
                </ExecLogDetailList>
              </ExecLogDetailSection>
            ) : null}
          </ExecLogDetailPanel>
        ) : null}
      </>
    );
  }, [expandedExecLogIds, toggleExecLogDetail]);

  const renderCompactContextList = (
    items: ThemeWorkbenchSidebarProps["contextItems"],
    emptyText: string,
  ) => {
    if (items.length === 0) {
      return <ActivityMeta>{emptyText}</ActivityMeta>;
    }

    return (
      <CompactContextList>
        {items.map((item) => {
          const interactive = item.source === "search";
          const createdAtLabel = formatContextCreatedAt(item.createdAt);
          return (
            <CompactContextRow key={item.id} $interactive={true} $active={item.active}>
              <CompactContextOpenButton
                type="button"
                aria-label={interactive ? `查看搜索结果 ${item.name}` : `查看上下文 ${item.name}`}
                disabled={false}
                onClick={() => {
                  if (interactive) {
                    setSelectedSearchResultId(item.id);
                  } else if (onViewContextDetail) {
                    onViewContextDetail(item.id);
                  }
                }}
              >
                {item.source === "search" ? (
                  <SearchResultIconWrap>
                    {item.searchMode === "social" ? <Share2 size={12} /> : <Globe size={12} />}
                  </SearchResultIconWrap>
                ) : (
                  <SearchResultIconWrap>
                    <CheckCircle2 size={12} />
                  </SearchResultIconWrap>
                )}
                <CompactContextInfo>
                  <CompactContextName>{item.name}</CompactContextName>
                  <CompactContextMeta>
                    {resolveContextSourceSubLabel(item.source, item.searchMode)}
                    {createdAtLabel ? ` · ${createdAtLabel}` : ""}
                  </CompactContextMeta>
                </CompactContextInfo>
                <ChevronRight size={13} />
              </CompactContextOpenButton>
              <CompactContextCheckbox
                checked={item.active}
                aria-label={`切换上下文 ${item.name}`}
                onChange={() => onToggleContextActive(item.id)}
              />
            </CompactContextRow>
          );
        })}
      </CompactContextList>
    );
  };



  return (
    <SidebarContainer>
      <SidebarHeader>
        <SidebarHeaderMetaRow>
          <SidebarEyebrow>Theme Workbench</SidebarEyebrow>
          {headerActionSlot ? (
            <SidebarHeaderActionSlot data-testid="theme-workbench-sidebar-header-action">
              {headerActionSlot}
            </SidebarHeaderActionSlot>
          ) : null}
        </SidebarHeaderMetaRow>
        <SidebarTitle>
          {activeTab === "context" ? "上下文管理" : isVersionMode ? "编排与版本" : "编排与分支"}
        </SidebarTitle>
        <SidebarDescription>
          {activeTab === "context"
            ? "检索、筛选并启用当前创作真正会用到的上下文。"
            : "跟踪编排进度、产物版本与运行记录。"}
        </SidebarDescription>
        <SidebarTabs>
          <SidebarTabButton
            type="button"
            aria-label="打开上下文管理"
            title="上下文管理"
            $active={activeTab === "context"}
            onClick={() => setActiveTab("context")}
          >
            <SidebarTabLabel>上下文</SidebarTabLabel>
            <SidebarTabCount $active={activeTab === "context"}>
              {activeContextItems.length}
            </SidebarTabCount>
          </SidebarTabButton>
          <SidebarTabButton
            type="button"
            aria-label="打开编排工作台"
            title="编排工作台"
            $active={activeTab === "workflow"}
            onClick={() => setActiveTab("workflow")}
          >
            <SidebarTabLabel>编排</SidebarTabLabel>
            <SidebarTabCount $active={activeTab === "workflow"}>
              {branchItems.length}
            </SidebarTabCount>
          </SidebarTabButton>
          <SidebarTabButton
            type="button"
            aria-label="打开执行日志"
            title="执行日志"
            $active={activeTab === "log"}
            onClick={() => setActiveTab("log")}
          >
            <SidebarTabLabel>日志</SidebarTabLabel>
            <SidebarTabCount $active={activeTab === "log"}>
              {visibleExecLogEntries.length}
            </SidebarTabCount>
          </SidebarTabButton>
        </SidebarTabs>
      </SidebarHeader>
      {onRequestCollapse ? (
        <SidebarCollapseHandle
          type="button"
          aria-label="折叠上下文侧栏"
          onClick={onRequestCollapse}
        >
          <ChevronLeft size={13} />
        </SidebarCollapseHandle>
      ) : null}

      <SidebarBody className="custom-scrollbar">
        {topSlot ? (
          <SidebarTopSlot data-testid="theme-workbench-sidebar-top-slot">
            {topSlot}
          </SidebarTopSlot>
        ) : null}
        {activeTab === "context" ? (
          <>
            <Section>
              <SectionTitle>
                <span>搜索上下文</span>
                <SectionBadge>{latestSearchLabel}</SectionBadge>
              </SectionTitle>
              <AddContextButton
                type="button"
                onClick={openAddContextDialog}
              >
                <Plus size={13} />
                添加上下文
              </AddContextButton>
              <ContextSearchCard>
                <SearchInputWrap>
                  <SearchIcon size={14} />
                  <SearchInput
                    ref={searchInputRef}
                    value={contextSearchQuery}
                    placeholder="搜索网络添加新上下文"
                    onChange={(event) => onContextSearchQueryChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !isSearchActionDisabled) {
                        event.preventDefault();
                        void onSubmitContextSearch();
                      }
                    }}
                  />
                </SearchInputWrap>
                <SearchActionRow>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <SearchModeTrigger
                        type="button"
                        aria-label="选择上下文搜索来源"
                      >
                        {contextSearchMode === "social" ? (
                          <Share2 size={13} />
                        ) : (
                          <Globe size={13} />
                        )}
                        <span>{contextSearchMode === "social" ? "社交媒体" : "网络搜索"}</span>
                        <ChevronDown size={13} />
                      </SearchModeTrigger>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="p-1 w-36">
                      <DropdownMenuItem onClick={() => onContextSearchModeChange("web")}>
                        <SearchModeMenuRow>
                          <Globe size={14} />
                          <span>网络搜索</span>
                          {contextSearchMode === "web" ? (
                            <SearchModeMenuCheck>
                              <Check size={13} />
                            </SearchModeMenuCheck>
                          ) : null}
                        </SearchModeMenuRow>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onContextSearchModeChange("social")}>
                        <SearchModeMenuRow>
                          <Share2 size={14} />
                          <span>社交媒体</span>
                          {contextSearchMode === "social" ? (
                            <SearchModeMenuCheck>
                              <Check size={14} />
                            </SearchModeMenuCheck>
                          ) : null}
                        </SearchModeMenuRow>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <SearchSubmitButton
                    type="button"
                    aria-label="提交上下文搜索"
                    onClick={() => {
                      if (!isSearchActionDisabled) {
                        void onSubmitContextSearch();
                      }
                    }}
                    $disabled={isSearchActionDisabled}
                    disabled={isSearchActionDisabled}
                  >
                    {contextSearchLoading ? (
                      <Loader2 className="spin" size={14} />
                    ) : (
                      <ArrowRight size={14} strokeWidth={2.5} />
                    )}
                  </SearchSubmitButton>
                </SearchActionRow>
              </ContextSearchCard>
              {contextSearchError ? (
                <SearchHintText $error>{contextSearchError}</SearchHintText>
              ) : contextSearchLoading ? (
                <SearchHintText>正在联网检索并整理上下文...</SearchHintText>
              ) : contextSearchBlockedReason ? (
                <SearchHintText>{contextSearchBlockedReason}</SearchHintText>
              ) : (
                <SearchHintText>输入关键词后按 Enter，可直接把检索结果加入当前上下文。</SearchHintText>
              )}
            </Section>

            {selectedSearchResult ? (
              <Section style={{ borderBottom: 'none' }}>
                <DetailTopBar>
                  <SectionTitle style={{ marginBottom: 0 }}>
                    <span>搜索结果详情</span>
                  </SectionTitle>
                  <DetailBackButton
                    type="button"
                    onClick={() => setSelectedSearchResultId(null)}
                  >
                    <ArrowLeft size={13} />
                    返回列表
                  </DetailBackButton>
                </DetailTopBar>
                <DetailCard>
                  <DetailTitle>{selectedSearchResult.name}</DetailTitle>
                  <DetailMeta>
                    {resolveContextSourceSubLabel(
                      selectedSearchResult.source,
                      selectedSearchResult.searchMode,
                    )}
                    {formatContextCreatedAt(selectedSearchResult.createdAt)
                      ? ` · ${formatContextCreatedAt(selectedSearchResult.createdAt)}`
                      : ''}
                    {selectedSearchResult.active ? ' · 已启用' : ' · 未启用'}
                  </DetailMeta>
                  <DetailSection>
                    <DetailSectionLabel>Source guide</DetailSectionLabel>
                    {selectedSearchResult.query ? (
                      <ContextQuery>检索词：{selectedSearchResult.query}</ContextQuery>
                    ) : null}
                    {selectedSearchResult.citations && selectedSearchResult.citations.length > 0 ? (
                      <DetailSourceList>
                        {selectedSearchResult.citations.map((citation) => (
                          <DetailSourceItem
                            key={`${selectedSearchResult.id}-${citation.url}`}
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={11} />
                            <span>{citation.title}</span>
                          </DetailSourceItem>
                        ))}
                      </DetailSourceList>
                    ) : (
                      <ActivityMeta>暂无来源链接</ActivityMeta>
                    )}
                  </DetailSection>
                  <DetailBody>
                    {selectedSearchResult.previewText || '暂无可展示的搜索结果正文'}
                  </DetailBody>
                  <ActionRow>
                    <TinyButton onClick={() => onToggleContextActive(selectedSearchResult.id)}>
                      {selectedSearchResult.active ? '移出上下文' : '加入上下文'}
                    </TinyButton>
                  </ActionRow>
                </DetailCard>
              </Section>
            ) : (
              <Section style={{ borderBottom: 'none' }}>
                <SectionTitle>
                  <span>上下文列表</span>
                  <SectionBadge>{contextItems.length} 条</SectionBadge>
                </SectionTitle>
                <ActivityMeta>
                  已生效 {contextBudget.activeCount}/{contextBudget.activeCountLimit} 条 ·
                  检索结果 {searchContextItems.length} 条 · 估算 {contextBudget.estimatedTokens}/
                  {contextBudget.tokenLimit} tokens
                </ActivityMeta>
                <ActivityMeta>搜索结果可点击查看详情，其他上下文可直接勾选启用。</ActivityMeta>
                {renderCompactContextList(
                  orderedContextItems,
                  '当前还没有上下文，先添加项目资料或搜索一个主题试试',
                )}
              </Section>
            )}
          </>
        ) : activeTab === "workflow" ? (
          <>
            <Section $allowOverflow>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <NewTopicButton>
                    <Plus size={14} />
                    {isVersionMode ? '创建版本快照' : '新建分支话题'}
                    <ChevronDown size={12} style={{ marginLeft: 'auto' }} />
                  </NewTopicButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" style={{ width: '260px' }}>
                  <DropdownMenuItem onClick={onNewTopic}>
                    <GitBranch size={14} />
                    <span>{isVersionMode ? '创建版本快照' : '新建分支话题'}</span>
                  </DropdownMenuItem>
                  {onAddImage && (
                    <DropdownMenuItem onClick={onAddImage}>
                      <ImageIcon size={14} />
                      <span>添加图片</span>
                    </DropdownMenuItem>
                  )}
                  {onImportDocument && (
                    <DropdownMenuItem onClick={onImportDocument}>
                      <FileText size={14} />
                      <span>导入文稿</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </Section>

            <Section>
              <SectionTitle>
                <span>编排进度</span>
                <SectionBadge>{workflowSteps.length - completedSteps}</SectionBadge>
              </SectionTitle>
              <ProgressText>
                {completedSteps}/{workflowSteps.length} 步已完成
              </ProgressText>
              <ProgressBar>
                <ProgressFill $percent={progressPercent} />
              </ProgressBar>
              <StepList>
                {workflowSteps.map((step) => (
                  <StepRow key={step.id} $status={step.status}>
                    {getStepIcon(step.status)}
                    <span>{step.title}</span>
                  </StepRow>
                ))}
              </StepList>
            </Section>

            <Section>
              <SectionTitle>
                <span>{isVersionMode ? '产物版本' : '篇内分支'}</span>
                <SectionBadge>{branchItems.length}</SectionBadge>
              </SectionTitle>
              <BranchList className="custom-scrollbar">
                {branchItems.length === 0 ? (
                  <ActivityMeta>
                    {isVersionMode ? '暂无文稿版本，先生成或创建快照' : '暂无分支话题'}
                  </ActivityMeta>
                ) : (
                  branchItems.map((item) => (
                    <BranchItem key={item.id} $active={item.isCurrent}>
                      <BranchHead>
                        <GitBranch size={13} />
                        <BranchTitleButton onClick={() => onSwitchTopic(item.id)}>
                          {item.title}
                        </BranchTitleButton>
                        <StatusBadge $status={item.status}>
                          {getBranchStatusText(item.status)}
                        </StatusBadge>
                        {!isVersionMode ? (
                          <DeleteButton onClick={() => onDeleteTopic(item.id)} aria-label="删除分支">
                            <Trash2 size={12} />
                          </DeleteButton>
                        ) : null}
                      </BranchHead>
                      <ActionRow>
                        <TinyButton onClick={() => onSetBranchStatus(item.id, 'merged')}>
                          {isVersionMode ? '设为主稿' : '采纳到主稿'}
                        </TinyButton>
                        <TinyButton onClick={() => onSetBranchStatus(item.id, 'pending')}>
                          {isVersionMode ? '标记待评审' : '标记待决策'}
                        </TinyButton>
                      </ActionRow>
                    </BranchItem>
                  ))
                )}
              </BranchList>
            </Section>

            <Section>
              <SectionTitle>
                <span>任务提交</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SectionBadge>{creationTaskEvents.length}</SectionBadge>
                  <button
                    type="button"
                    aria-label="切换任务提交记录"
                    onClick={() => setShowCreationTasks((previous) => !previous)}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "hsl(var(--muted-foreground))",
                      display: "inline-flex",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    {showCreationTasks ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                </span>
              </SectionTitle>
              {showCreationTasks ? (
                <ActivityList className="custom-scrollbar">
                  {groupedCreationTaskEvents.length === 0 ? (
                    <ActivityMeta>暂无任务提交</ActivityMeta>
                  ) : (
                    groupedCreationTaskEvents.map((group) => (
                      <ActivityItem key={`creation-task-${group.key}`}>
                        <ActivityGroupHeader>
                          <span>●</span>
                          <span>{group.label}</span>
                          <span style={{ marginLeft: "auto" }}>
                            {group.latestTimeLabel}
                          </span>
                        </ActivityGroupHeader>
                        <ActivityMeta>
                          类型：{group.taskType} · 本组 {group.tasks.length} 条
                        </ActivityMeta>
                        <ActivityStepList>
                          {group.tasks.map((task) => (
                            <ActivityStepItem key={`${task.taskId}-${task.path}`}>
                              <ActivityTitle>
                                <span>•</span>
                                <span>{task.path}</span>
                                <span style={{ marginLeft: "auto" }}>
                                  {task.timeLabel}
                                </span>
                              </ActivityTitle>
                              <ActivityMeta>任务ID：{task.taskId}</ActivityMeta>
                              {task.absolutePath ? (
                                <RunDetailArtifacts>
                                  <RunDetailArtifactRow>
                                    <RunDetailArtifactPath>
                                      {task.absolutePath}
                                    </RunDetailArtifactPath>
                                    <RunDetailActionButton
                                      type="button"
                                      aria-label={`复制任务文件绝对路径-${task.taskId}`}
                                      onClick={() => {
                                        void writeClipboardText(task.absolutePath || "");
                                      }}
                                    >
                                      复制绝对路径
                                    </RunDetailActionButton>
                                  </RunDetailArtifactRow>
                                </RunDetailArtifacts>
                              ) : (
                                <RunDetailActions>
                                  <RunDetailActionButton
                                    type="button"
                                    aria-label={`复制任务文件路径-${task.taskId}`}
                                    onClick={() => {
                                      void writeClipboardText(task.path);
                                    }}
                                  >
                                    复制路径
                                  </RunDetailActionButton>
                                </RunDetailActions>
                              )}
                            </ActivityStepItem>
                          ))}
                        </ActivityStepList>
                      </ActivityItem>
                    ))
                  )}
                </ActivityList>
              ) : null}
            </Section>

            <Section>
              <SectionTitle>
                <span>活动日志</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SectionBadge>{groupedActivityLogs.length}</SectionBadge>
                  <button
                    type="button"
                    aria-label="切换活动日志"
                    onClick={() => setShowActivityLogs((previous) => !previous)}
                    style={{
                      border: 0,
                      background: "transparent",
                      color: "hsl(var(--muted-foreground))",
                      display: "inline-flex",
                      alignItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    {showActivityLogs ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                </span>
              </SectionTitle>
              {showActivityLogs ? (
                <>
                  <ActivityList className="custom-scrollbar">
                    {groupedActivityLogs.length === 0 ? (
                      <ActivityMeta>暂无活动日志</ActivityMeta>
                    ) : (
                      groupedActivityLogs.map((group) => renderActivityLogItem(group))
                    )}
                  </ActivityList>
                  {activeRunDetailLoading ? (
                    <ActivityMeta>运行详情加载中...</ActivityMeta>
                  ) : activeRunDetail ? (
                    <RunDetailPanel>
                      <RunDetailTitle>运行详情</RunDetailTitle>
                      <RunDetailRow>ID：{activeRunDetail.id}</RunDetailRow>
                      <RunDetailRow>状态：{formatRunStatusLabel(activeRunDetail.status)}</RunDetailRow>
                      {runMetadataSummary.workflow ? (
                        <RunDetailRow>工作流：{runMetadataSummary.workflow}</RunDetailRow>
                      ) : null}
                      {runMetadataSummary.executionId ? (
                        <RunDetailRow>执行ID：{runMetadataSummary.executionId}</RunDetailRow>
                      ) : null}
                      {runMetadataSummary.versionId ? (
                        <RunDetailRow>版本ID：{runMetadataSummary.versionId}</RunDetailRow>
                      ) : null}
                      {activeRunStagesLabel ? (
                        <RunDetailRow>阶段：{activeRunStagesLabel}</RunDetailRow>
                      ) : null}
                      <RunDetailActions>
                        <RunDetailActionButton
                          type="button"
                          aria-label="复制运行ID"
                          onClick={() => {
                            void writeClipboardText(activeRunDetail.id);
                          }}
                        >
                          复制运行ID
                        </RunDetailActionButton>
                        <RunDetailActionButton
                          type="button"
                          aria-label="复制运行元数据"
                          onClick={() => {
                            void writeClipboardText(runMetadataText);
                          }}
                        >
                          复制运行元数据
                        </RunDetailActionButton>
                      </RunDetailActions>
                      {runMetadataSummary.artifactPaths.length > 0 ? (
                        <RunDetailArtifacts>
                          {runMetadataSummary.artifactPaths.map((artifactPath) => (
                            <RunDetailArtifactRow key={`run-detail-${artifactPath}`}>
                              <RunDetailArtifactPath>
                                {artifactPath}
                              </RunDetailArtifactPath>
                              <RunDetailActionButton
                                type="button"
                                aria-label={`复制产物路径-${artifactPath}`}
                                onClick={() => {
                                  void writeClipboardText(artifactPath);
                                }}
                              >
                                复制路径
                              </RunDetailActionButton>
                              <RunDetailActionButton
                                type="button"
                                aria-label={`定位产物路径-${artifactPath}`}
                                onClick={() => {
                                  void handleRevealArtifactInFinder(artifactPath);
                                }}
                              >
                                定位
                              </RunDetailActionButton>
                              <RunDetailActionButton
                                type="button"
                                aria-label={`打开产物路径-${artifactPath}`}
                                onClick={() => {
                                  void handleOpenArtifactWithDefaultApp(artifactPath);
                                }}
                              >
                                打开
                              </RunDetailActionButton>
                            </RunDetailArtifactRow>
                          ))}
                        </RunDetailArtifacts>
                      ) : null}
                      <RunDetailCode>{runMetadataText}</RunDetailCode>
                    </RunDetailPanel>
                  ) : null}
                </>
              ) : null}
            </Section>
          </>
        ) : null}
        {activeTab === "log" ? (
          <ExecLogContainer>
            <ExecLogToolbar>
              <ExecLogToolbarRow>
                <ExecLogFilterGroup>
                  {EXEC_LOG_FILTER_OPTIONS.map((option) => (
                    <ExecLogFilterChip
                      key={option.key}
                      type="button"
                      aria-label={`筛选执行日志-${option.label}`}
                      $active={execLogFilter === option.key}
                      onClick={() => setExecLogFilter(option.key)}
                    >
                      {option.label}
                    </ExecLogFilterChip>
                  ))}
                </ExecLogFilterGroup>
                <ExecLogMoreButton
                  type="button"
                  aria-label="清空全部日志"
                  disabled={visibleExecLogEntries.length === 0}
                  onClick={() => {
                    if (visibleExecLogEntries.length > 0) {
                      setExpandedExecLogIds([]);
                      setExecLogClearedAt(Date.now());
                    }
                  }}
                >
                  清空全部
                </ExecLogMoreButton>
              </ExecLogToolbarRow>
            </ExecLogToolbar>
            {filteredExecLogEntries.length === 0 ? (
              <>
                <ExecLogEmpty>
                  {execLogEntries.length > 0 && execLogClearedAt !== null
                    ? "日志已清空，等待新的运行记录…"
                    : visibleExecLogEntries.length > 0
                      ? "当前筛选下暂无日志"
                      : "暂无执行记录"}
                </ExecLogEmpty>
                {onLoadMoreHistory && (historyHasMore || historyLoading) ? (
                  <ExecLogFooter>
                    <ExecLogMoreButton
                      type="button"
                      aria-label="加载更早历史日志"
                      disabled={historyLoading}
                      onClick={() => {
                        if (!historyLoading) {
                          onLoadMoreHistory();
                        }
                      }}
                    >
                      {historyLoading ? "加载中..." : "加载更早历史"}
                    </ExecLogMoreButton>
                  </ExecLogFooter>
                ) : null}
              </>
            ) : (
              <ExecLogTimeline>
                {filteredExecLogEntries.map((entry) => (
                  <ExecLogItem key={entry.id}>
                    <ExecLogDot $type={entry.type} $status={entry.status} />
                    <ExecLogHeader>
                      <ExecLogBadge $type={entry.type} $status={entry.status}>
                        {entry.typeLabel}
                      </ExecLogBadge>
                      <ExecLogTime>
                        {entry.timestamp
                          ? entry.timestamp instanceof Date
                            ? entry.timestamp.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                            : new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
                          : ""}
                      </ExecLogTime>
                    </ExecLogHeader>
                    <ExecLogContent>{entry.content}</ExecLogContent>
                    {entry.meta ? <ExecLogMeta>{entry.meta}</ExecLogMeta> : null}
                    {renderExecLogDetail(entry)}
                  </ExecLogItem>
                ))}
                {onLoadMoreHistory && (historyHasMore || historyLoading) ? (
                  <ExecLogFooter>
                    <ExecLogMoreButton
                      type="button"
                      aria-label="加载更早历史日志"
                      disabled={historyLoading}
                      onClick={() => {
                        if (!historyLoading) {
                          onLoadMoreHistory();
                        }
                      }}
                    >
                      {historyLoading ? "加载中..." : "加载更早历史"}
                    </ExecLogMoreButton>
                  </ExecLogFooter>
                ) : null}
                <div ref={execLogBottomRef} />
              </ExecLogTimeline>
            )}
          </ExecLogContainer>
        ) : null}
      </SidebarBody>
      {addContextDialogOpen ? (
        <ContextModalOverlay
          onClick={() => {
            if (!contextCreateLoading) {
              closeAllContextDialogs();
            }
          }}
        >
          <ContextModalCard onClick={(event) => event.stopPropagation()}>
            <ContextModalHeader>
              <ContextModalTitle>添加新上下文</ContextModalTitle>
              <ContextModalHeaderActions>
                <ContextModalHeaderButton
                  type="button"
                  aria-label="关闭添加上下文弹窗"
                  onClick={() => {
                    if (!contextCreateLoading) {
                      closeAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </ContextModalHeaderButton>
              </ContextModalHeaderActions>
            </ContextModalHeader>
            <ContextModalBody>
              <ContextDropArea
                $dragging={contextDropActive}
                onDragOver={(event) => {
                  event.preventDefault();
                  setContextDropActive(true);
                }}
                onDragLeave={() => setContextDropActive(false)}
                onDrop={(event) => {
                  void handleDropContextFile(event);
                }}
              >
                <ContextDropHint>or drop your files here</ContextDropHint>
                <ContextModalActionGrid>
                  <ContextModalActionButton
                    type="button"
                    aria-label="上传文件上下文"
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (!contextCreateLoading) {
                        void handleChooseContextFile();
                      }
                    }}
                  >
                    <FileUp size={15} />
                    上传文件
                  </ContextModalActionButton>
                  <ContextModalActionButton
                    type="button"
                    aria-label="添加网站链接上下文"
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (contextCreateLoading) {
                        return;
                      }
                      setContextCreateError(null);
                      setAddContextDialogOpen(false);
                      setAddTextDialogOpen(false);
                      setAddLinkDialogOpen(true);
                    }}
                  >
                    <Link2 size={15} />
                    网站链接
                  </ContextModalActionButton>
                  <ContextModalActionButton
                    type="button"
                    aria-label="输入文本上下文"
                    disabled={contextCreateLoading}
                    onClick={() => {
                      if (contextCreateLoading) {
                        return;
                      }
                      setContextCreateError(null);
                      setAddContextDialogOpen(false);
                      setAddLinkDialogOpen(false);
                      setAddTextDialogOpen(true);
                    }}
                  >
                    <PencilLine size={15} />
                    输入文本
                  </ContextModalActionButton>
                </ContextModalActionGrid>
              </ContextDropArea>
              {contextCreateError ? (
                <ContextModalErrorText>{contextCreateError}</ContextModalErrorText>
              ) : null}
            </ContextModalBody>
          </ContextModalCard>
        </ContextModalOverlay>
      ) : null}
      {addTextDialogOpen ? (
        <ContextModalOverlay
          onClick={() => {
            if (!contextCreateLoading) {
              closeAllContextDialogs();
            }
          }}
        >
          <ContextModalCard onClick={(event) => event.stopPropagation()}>
            <ContextModalHeader>
              <ContextModalHeaderActions>
                <ContextModalHeaderButton
                  type="button"
                  aria-label="返回添加上下文"
                  onClick={() => {
                    if (contextCreateLoading) {
                      return;
                    }
                    setContextCreateError(null);
                    setAddTextDialogOpen(false);
                    setAddContextDialogOpen(true);
                  }}
                >
                  <ArrowLeft size={20} />
                </ContextModalHeaderButton>
              </ContextModalHeaderActions>
              <ContextModalTitleCentered>添加文本内容</ContextModalTitleCentered>
              <ContextModalHeaderActions>
                <ContextModalHeaderButton
                  type="button"
                  aria-label="关闭文本上下文弹窗"
                  onClick={() => {
                    if (!contextCreateLoading) {
                      closeAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </ContextModalHeaderButton>
              </ContextModalHeaderActions>
            </ContextModalHeader>
            <ContextModalBody>
              <ContextTextarea
                value={contextDraftText}
                placeholder="在此粘贴或输入文本..."
                onChange={(event) => {
                  setContextCreateError(null);
                  setContextDraftText(event.target.value);
                }}
              />
              {contextCreateError ? (
                <ContextModalErrorText>{contextCreateError}</ContextModalErrorText>
              ) : null}
              <ContextModalFooter>
                <ContextConfirmButton
                  type="button"
                  aria-label="确认添加文本上下文"
                  $disabled={contextCreateLoading || contextDraftText.trim().length === 0}
                  disabled={contextCreateLoading || contextDraftText.trim().length === 0}
                  onClick={() => {
                    void handleSubmitTextContext();
                  }}
                >
                  {contextCreateLoading ? <Loader2 size={22} className="animate-spin" /> : "确认"}
                </ContextConfirmButton>
              </ContextModalFooter>
            </ContextModalBody>
          </ContextModalCard>
        </ContextModalOverlay>
      ) : null}
      {addLinkDialogOpen ? (
        <ContextModalOverlay
          onClick={() => {
            if (!contextCreateLoading) {
              closeAllContextDialogs();
            }
          }}
        >
          <ContextModalCard onClick={(event) => event.stopPropagation()}>
            <ContextModalHeader>
              <ContextModalHeaderActions>
                <ContextModalHeaderButton
                  type="button"
                  aria-label="返回添加上下文"
                  onClick={() => {
                    if (contextCreateLoading) {
                      return;
                    }
                    setContextCreateError(null);
                    setAddLinkDialogOpen(false);
                    setAddContextDialogOpen(true);
                  }}
                >
                  <ArrowLeft size={20} />
                </ContextModalHeaderButton>
              </ContextModalHeaderActions>
              <ContextModalTitleCentered>添加网站链接</ContextModalTitleCentered>
              <ContextModalHeaderActions>
                <ContextModalHeaderButton
                  type="button"
                  aria-label="关闭链接上下文弹窗"
                  onClick={() => {
                    if (!contextCreateLoading) {
                      closeAllContextDialogs();
                    }
                  }}
                >
                  <X size={18} />
                </ContextModalHeaderButton>
              </ContextModalHeaderActions>
            </ContextModalHeader>
            <ContextModalBody>
              <ContextLinkInput
                value={contextDraftLink}
                placeholder="请输入网站链接"
                onChange={(event) => {
                  setContextCreateError(null);
                  setContextDraftLink(event.target.value);
                }}
              />
              {contextCreateError ? (
                <ContextModalErrorText>{contextCreateError}</ContextModalErrorText>
              ) : null}
              <ContextModalFooter>
                <ContextConfirmButton
                  type="button"
                  aria-label="确认添加链接上下文"
                  $disabled={contextCreateLoading || contextDraftLink.trim().length === 0}
                  disabled={contextCreateLoading || contextDraftLink.trim().length === 0}
                  onClick={() => {
                    void handleSubmitLinkContext();
                  }}
                >
                  {contextCreateLoading ? <Loader2 size={22} className="animate-spin" /> : "确认"}
                </ContextConfirmButton>
              </ContextModalFooter>
            </ContextModalBody>
          </ContextModalCard>
        </ContextModalOverlay>
      ) : null}
    </SidebarContainer>
  );
}

function areThemeWorkbenchSidebarPropsEqual(
  previous: ThemeWorkbenchSidebarProps,
  next: ThemeWorkbenchSidebarProps,
): boolean {
  return (
    previous.branchMode === next.branchMode &&
    previous.onNewTopic === next.onNewTopic &&
    previous.onSwitchTopic === next.onSwitchTopic &&
    previous.onDeleteTopic === next.onDeleteTopic &&
    previous.branchItems === next.branchItems &&
    previous.onSetBranchStatus === next.onSetBranchStatus &&
    previous.workflowSteps === next.workflowSteps &&
    previous.contextSearchQuery === next.contextSearchQuery &&
    previous.onContextSearchQueryChange === next.onContextSearchQueryChange &&
    previous.contextSearchMode === next.contextSearchMode &&
    previous.onContextSearchModeChange === next.onContextSearchModeChange &&
    previous.contextSearchLoading === next.contextSearchLoading &&
    previous.contextSearchError === next.contextSearchError &&
    previous.contextSearchBlockedReason === next.contextSearchBlockedReason &&
    previous.onSubmitContextSearch === next.onSubmitContextSearch &&
    previous.onAddTextContext === next.onAddTextContext &&
    previous.onAddLinkContext === next.onAddLinkContext &&
    previous.onAddFileContext === next.onAddFileContext &&
    previous.onAddImage === next.onAddImage &&
    previous.onImportDocument === next.onImportDocument &&
    previous.contextItems === next.contextItems &&
    previous.onToggleContextActive === next.onToggleContextActive &&
    previous.contextBudget.activeCount === next.contextBudget.activeCount &&
    previous.contextBudget.activeCountLimit === next.contextBudget.activeCountLimit &&
    previous.contextBudget.estimatedTokens === next.contextBudget.estimatedTokens &&
    previous.contextBudget.tokenLimit === next.contextBudget.tokenLimit &&
    previous.activityLogs === next.activityLogs &&
    previous.creationTaskEvents === next.creationTaskEvents &&
    previous.onViewRunDetail === next.onViewRunDetail &&
    previous.activeRunDetail === next.activeRunDetail &&
    previous.activeRunDetailLoading === next.activeRunDetailLoading &&
    previous.onRequestCollapse === next.onRequestCollapse &&
    previous.historyHasMore === next.historyHasMore &&
    previous.historyLoading === next.historyLoading &&
    previous.onLoadMoreHistory === next.onLoadMoreHistory &&
    previous.skillDetailMap === next.skillDetailMap &&
    previous.headerActionSlot === next.headerActionSlot &&
    previous.topSlot === next.topSlot &&
    previous.messages === next.messages
  );
}

export const ThemeWorkbenchSidebar = memo(
  ThemeWorkbenchSidebarComponent,
  areThemeWorkbenchSidebarPropsEqual,
);
