import {
  createUnifiedMemory,
  deleteUnifiedMemory,
  getUnifiedMemory,
  listUnifiedMemories,
  searchUnifiedMemories,
} from "@/lib/api/unifiedMemory";

/**
 * 统一记忆 API 测试组件
 *
 * 用于验证 Tauri 命令是否正常工作
 */

export default function UnifiedMemoryTest() {
  const testCreateMemory = async () => {
    try {
      const result = await createUnifiedMemory({
        session_id: "test-session-001",
        title: "测试记忆",
        content: "这是一条测试记忆内容",
        summary: "测试记忆摘要",
      });

      console.log("创建成功:", result);
      alert(`创建成功！记忆 ID: ${result.id}`);
    } catch (error) {
      console.error("创建失败:", error);
      alert(`创建失败: ${error}`);
    }
  };

  const testListMemories = async () => {
    try {
      const result = await listUnifiedMemories({
        limit: 10,
      });

      console.log("列表查询成功:", result);
      alert(`查询成功！共 ${result.length} 条记忆`);
    } catch (error) {
      console.error("列表查询失败:", error);
      alert(`查询失败: ${error}`);
    }
  };

  const testSearchMemories = async () => {
    try {
      const result = await searchUnifiedMemories("测试", undefined, 10);

      console.log("搜索成功:", result);
      alert(`搜索成功！找到 ${result.length} 条记忆`);
    } catch (error) {
      console.error("搜索失败:", error);
      alert(`搜索失败: ${error}`);
    }
  };

  const testDeleteMemory = async () => {
    const id = prompt("请输入要删除的记忆 ID:");
    if (!id) return;

    try {
      const result = await deleteUnifiedMemory(id);
      console.log("删除成功:", result);
      alert(`删除${result ? "成功" : "失败"}！`);
    } catch (error) {
      console.error("删除失败:", error);
      alert(`删除失败: ${error}`);
    }
  };

  const testGetMemory = async () => {
    const id = prompt("请输入要查询的记忆 ID:");
    if (!id) return;

    try {
      const result = await getUnifiedMemory(id);
      console.log("查询成功:", result);
      alert(
        `查询成功！${result ? "找到: " + result.title : "不存在"}`
      );
    } catch (error) {
      console.error("查询失败:", error);
      alert(`查询失败: ${error}`);
    }
  };

  return (
    <div style={{ padding: "20px", maxWidth: "800px", margin: "0 auto" }}>
      <h2>统一记忆 API 测试</h2>

      <div style={{ marginBottom: "20px" }}>
        <h3>1. 创建记忆</h3>
        <button onClick={testCreateMemory}>创建测试记忆</button>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <h3>2. 列表查询</h3>
        <button onClick={testListMemories}>查询记忆列表</button>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <h3>3. 搜索记忆</h3>
        <button onClick={testSearchMemories}>搜索关键词"测试"</button>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <h3>4. 查询单条</h3>
        <button onClick={testGetMemory}>根据 ID 查询</button>
      </div>

      <div style={{ marginBottom: "20px" }}>
        <h3>5. 删除记忆</h3>
        <button onClick={testDeleteMemory}>根据 ID 删除</button>
      </div>

      <div
        style={{
          marginTop: "30px",
          padding: "15px",
          backgroundColor: "#f5f5f5",
          border: "1px solid #ddd",
          borderRadius: "5px",
        }}
      >
        <h4>使用说明</h4>
        <ul>
          <li>创建记忆会自动生成 ID</li>
          <li>创建成功后，复制 ID 用于其他操作</li>
          <li>所有操作都会在控制台输出详细结果</li>
          <li>删除是永久删除，数据会被真正移除</li>
        </ul>
      </div>
    </div>
  );
}
