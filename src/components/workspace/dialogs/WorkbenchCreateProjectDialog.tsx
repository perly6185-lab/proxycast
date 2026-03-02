import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface WorkbenchCreateProjectDialogProps {
  open: boolean;
  creatingProject: boolean;
  newProjectName: string;
  projectTypeLabel: string;
  workspaceProjectsRoot: string;
  resolvedProjectPath: string;
  pathChecking: boolean;
  pathConflictMessage: string;
  onOpenChange: (open: boolean) => void;
  onProjectNameChange: (value: string) => void;
  onCreateProject: () => void;
}

export function WorkbenchCreateProjectDialog({
  open,
  creatingProject,
  newProjectName,
  projectTypeLabel,
  workspaceProjectsRoot,
  resolvedProjectPath,
  pathChecking,
  pathConflictMessage,
  onOpenChange,
  onProjectNameChange,
  onCreateProject,
}: WorkbenchCreateProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>新建项目</DialogTitle>
          <DialogDescription>
            请输入项目名称，项目将创建到固定 workspace 目录。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="workspace-project-name">项目名称</Label>
            <Input
              id="workspace-project-name"
              value={newProjectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
              placeholder="请输入项目名称"
              autoFocus
              disabled={creatingProject}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="workspace-project-type">项目类型</Label>
            <Input id="workspace-project-type" value={projectTypeLabel} disabled />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="workspace-project-path">workspace 目录</Label>
            <Input
              id="workspace-project-path"
              value={workspaceProjectsRoot}
              placeholder="加载中..."
              readOnly
            />
            <p className="text-xs text-muted-foreground break-all">
              将创建到：
              {resolvedProjectPath
                ? resolvedProjectPath
                : newProjectName.trim()
                  ? `${workspaceProjectsRoot || "..."}/${newProjectName.trim()}`
                  : "请输入项目名称"}
            </p>
            {pathChecking && (
              <p className="text-xs text-muted-foreground">正在检查路径...</p>
            )}
            {!pathChecking && pathConflictMessage && (
              <p className="text-xs text-destructive">{pathConflictMessage}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={creatingProject}
          >
            取消
          </Button>
          <Button
            onClick={onCreateProject}
            disabled={
              creatingProject ||
              pathChecking ||
              !!pathConflictMessage ||
              !newProjectName.trim() ||
              !workspaceProjectsRoot?.trim()
            }
          >
            {creatingProject ? "创建中..." : "创建项目"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default WorkbenchCreateProjectDialog;
