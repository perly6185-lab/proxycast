/**
 * 大纲管理面板
 *
 * 显示和编辑项目大纲，支持树形结构和拖拽排序
 */

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  RefreshCw,
  MoreHorizontal,
  Edit2,
  Trash2,
  ChevronRight,
  ChevronDown,
  GripVertical,
  ArrowUp,
  ArrowDown,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  CreateOutlineNodeRequest,
  OutlineNode,
  OutlineTreeNode,
  UpdateOutlineNodeRequest,
  buildOutlineTree,
  createOutlineNode,
  deleteOutlineNode,
  listOutlineNodes,
  updateOutlineNode,
} from "@/lib/api/memory";
import { toast } from "sonner";

interface OutlinePanelProps {
  projectId: string;
}

interface NodeFormData {
  title: string;
  content: string;
  parent_id: string | null;
}

const emptyFormData: NodeFormData = {
  title: "",
  content: "",
  parent_id: null,
};

export function OutlinePanel({ projectId }: OutlinePanelProps) {
  const [nodes, setNodes] = useState<OutlineNode[]>([]);
  const [tree, setTree] = useState<OutlineTreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<OutlineNode | null>(null);
  const [formData, setFormData] = useState<NodeFormData>(emptyFormData);
  const [saving, setSaving] = useState(false);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const loadNodes = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listOutlineNodes(projectId);
      setNodes(list);
      setTree(buildOutlineTree(list));
      // 默认展开所有节点
      const allIds = new Set(list.map((n) => n.id));
      setExpandedNodes(allIds);
    } catch (error) {
      console.error("加载大纲失败:", error);
      toast.error("加载大纲失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadNodes();
  }, [loadNodes]);

  const toggleExpand = (nodeId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  };

  const handleOpenCreate = (parentId: string | null = null) => {
    setEditingNode(null);
    setFormData({ ...emptyFormData, parent_id: parentId });
    setDialogOpen(true);
  };

  const handleOpenEdit = (node: OutlineNode) => {
    setEditingNode(node);
    setFormData({
      title: node.title,
      content: node.content || "",
      parent_id: node.parent_id || null,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.error("请输入节点标题");
      return;
    }

    setSaving(true);
    try {
      if (editingNode) {
        const request: UpdateOutlineNodeRequest = {
          title: formData.title,
          content: formData.content || undefined,
        };
        await updateOutlineNode(editingNode.id, request);
        toast.success("节点已更新");
      } else {
        const request: CreateOutlineNodeRequest = {
          project_id: projectId,
          parent_id: formData.parent_id || undefined,
          title: formData.title,
          content: formData.content || undefined,
        };
        await createOutlineNode(request);
        toast.success("节点已创建");
      }
      setDialogOpen(false);
      loadNodes();
    } catch (error) {
      console.error("保存节点失败:", error);
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (node: OutlineNode) => {
    // 检查是否有子节点
    const hasChildren = nodes.some((n) => n.parent_id === node.id);
    const message = hasChildren
      ? `确定要删除 "${node.title}" 及其所有子节点吗？`
      : `确定要删除 "${node.title}" 吗？`;

    if (!confirm(message)) {
      return;
    }

    try {
      await deleteOutlineNode(node.id);
      toast.success("节点已删除");
      loadNodes();
    } catch (error) {
      console.error("删除节点失败:", error);
      toast.error("删除失败");
    }
  };

  const handleMoveUp = async (node: OutlineNode) => {
    // 找到同级节点
    const siblings = nodes
      .filter((n) => n.parent_id === node.parent_id)
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((n) => n.id === node.id);

    if (index <= 0) return;

    const prevNode = siblings[index - 1];
    try {
      await Promise.all([
        updateOutlineNode(node.id, { order: prevNode.order }),
        updateOutlineNode(prevNode.id, { order: node.order }),
      ]);
      loadNodes();
    } catch (error) {
      console.error("移动节点失败:", error);
      toast.error("移动失败");
    }
  };

  const handleMoveDown = async (node: OutlineNode) => {
    // 找到同级节点
    const siblings = nodes
      .filter((n) => n.parent_id === node.parent_id)
      .sort((a, b) => a.order - b.order);
    const index = siblings.findIndex((n) => n.id === node.id);

    if (index >= siblings.length - 1) return;

    const nextNode = siblings[index + 1];
    try {
      await Promise.all([
        updateOutlineNode(node.id, { order: nextNode.order }),
        updateOutlineNode(nextNode.id, { order: node.order }),
      ]);
      loadNodes();
    } catch (error) {
      console.error("移动节点失败:", error);
      toast.error("移动失败");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          共 {nodes.length} 个节点
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={loadNodes}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button onClick={() => handleOpenCreate(null)}>
            <Plus className="h-4 w-4 mr-2" />
            新建节点
          </Button>
        </div>
      </div>

      {/* 大纲树 */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : tree.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
            <FileText className="h-12 w-12 mb-4 opacity-50" />
            <p className="mb-4">还没有大纲</p>
            <Button onClick={() => handleOpenCreate(null)}>
              创建第一个节点
            </Button>
          </div>
        ) : (
          <div className="space-y-1">
            {tree.map((node) => (
              <OutlineTreeItem
                key={node.id}
                node={node}
                level={0}
                expandedNodes={expandedNodes}
                onToggleExpand={toggleExpand}
                onEdit={handleOpenEdit}
                onDelete={handleDelete}
                onAddChild={(parentId) => handleOpenCreate(parentId)}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
              />
            ))}
          </div>
        )}
      </div>

      {/* 新建/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingNode ? "编辑节点" : "新建节点"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">节点标题 *</Label>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="输入节点标题"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="content">节点内容</Label>
              <Textarea
                id="content"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                placeholder="输入节点内容或描述"
                rows={4}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中..." : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// 大纲树节点组件
interface OutlineTreeItemProps {
  node: OutlineTreeNode;
  level: number;
  expandedNodes: Set<string>;
  onToggleExpand: (nodeId: string) => void;
  onEdit: (node: OutlineNode) => void;
  onDelete: (node: OutlineNode) => void;
  onAddChild: (parentId: string) => void;
  onMoveUp: (node: OutlineNode) => void;
  onMoveDown: (node: OutlineNode) => void;
}

function OutlineTreeItem({
  node,
  level,
  expandedNodes,
  onToggleExpand,
  onEdit,
  onDelete,
  onAddChild,
  onMoveUp,
  onMoveDown,
}: OutlineTreeItemProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 py-1.5 px-2 rounded hover:bg-accent/50 group",
          level > 0 && "ml-4",
        )}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
      >
        {/* 展开/折叠按钮 */}
        <button
          onClick={() => onToggleExpand(node.id)}
          className={cn(
            "p-0.5 rounded hover:bg-accent",
            !hasChildren && "invisible",
          )}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>

        {/* 拖拽手柄 */}
        <GripVertical className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />

        {/* 标题 */}
        <span className="flex-1 text-sm truncate">{node.title}</span>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onMoveUp(node)}
            title="上移"
          >
            <ArrowUp className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => onMoveDown(node)}
            title="下移"
          >
            <ArrowDown className="h-3 w-3" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onEdit(node)}>
                <Edit2 className="h-4 w-4 mr-2" />
                编辑
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onAddChild(node.id)}>
                <Plus className="h-4 w-4 mr-2" />
                添加子节点
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onDelete(node)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 子节点 */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <OutlineTreeItem
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              onToggleExpand={onToggleExpand}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
            />
          ))}
        </div>
      )}
    </div>
  );
}
