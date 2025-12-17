import React, { useState, useRef } from "react";
import {
  Download,
  Upload,
  AlertCircle,
  Check,
  Shield,
  AlertTriangle,
  FileJson,
  FileText,
  Package,
} from "lucide-react";
import { Config, configApi, ImportResult } from "@/lib/api/config";

interface ImportExportProps {
  config: Config | null;
  onConfigImported: (config: Config) => void;
}

// Export scope options
type ExportScope = "config" | "credentials" | "full";

// Validation result from backend
interface ValidationResult {
  valid: boolean;
  version: string | null;
  redacted: boolean;
  has_config: boolean;
  has_credentials: boolean;
  errors: string[];
  warnings: string[];
}

export function ImportExport({ config, onConfigImported }: ImportExportProps) {
  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>("config");
  const [redactSecrets, setRedactSecrets] = useState(true);
  const [showSecurityWarning, setShowSecurityWarning] = useState(false);

  // Import state
  const [isImporting, setIsImporting] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [validationResult, setValidationResult] =
    useState<ValidationResult | null>(null);
  const [mergeConfig, setMergeConfig] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle export with security check
  const handleExportClick = () => {
    if (
      !redactSecrets &&
      (exportScope === "credentials" || exportScope === "full")
    ) {
      setShowSecurityWarning(true);
    } else {
      performExport();
    }
  };

  // Perform the actual export
  const performExport = async () => {
    if (!config) return;

    setIsExporting(true);
    setError(null);
    setShowSecurityWarning(false);

    try {
      if (exportScope === "config") {
        // Export config only as YAML
        const result = await configApi.exportConfig(config, redactSecrets);
        downloadFile(result.content, result.suggested_filename, "text/yaml");
      } else {
        // Export bundle (credentials or full)
        const result = await configApi.exportBundle(config, {
          include_config: exportScope === "full",
          include_credentials: true,
          redact_secrets: redactSecrets,
        });
        downloadFile(
          result.content,
          result.suggested_filename,
          "application/json",
        );
      }
    } catch (err) {
      setError(`导出失败: ${err}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Download file helper
  const downloadFile = (
    content: string,
    filename: string,
    mimeType: string,
  ) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      setImportContent(content);
      setImportFileName(file.name);
      setShowImportDialog(true);
      setImportResult(null);
      setError(null);

      // Validate the import content
      try {
        const validation = await configApi.validateImport(content);
        setValidationResult(validation);
      } catch (err) {
        setError(`验证失败: ${err}`);
        setValidationResult(null);
      }
    };
    reader.onerror = () => {
      setError("读取文件失败");
    };
    reader.readAsText(file);

    // Reset input
    e.target.value = "";
  };

  // Import config/bundle
  const handleImport = async () => {
    if (!config || !importContent) return;

    setIsImporting(true);
    setError(null);

    try {
      const result = await configApi.importBundle(
        config,
        importContent,
        mergeConfig,
      );
      setImportResult(result);

      if (result.success) {
        onConfigImported(result.config);
      }
    } catch (err) {
      setError(`导入失败: ${err}`);
    } finally {
      setIsImporting(false);
    }
  };

  // Close import dialog
  const closeImportDialog = () => {
    setShowImportDialog(false);
    setImportContent("");
    setImportFileName("");
    setImportResult(null);
    setValidationResult(null);
    setError(null);
  };

  // Get file type icon
  const getFileTypeIcon = () => {
    if (importFileName.endsWith(".json")) {
      return <FileJson className="h-4 w-4" />;
    }
    return <FileText className="h-4 w-4" />;
  };

  return (
    <div className="space-y-6">
      {/* Export Section */}
      <div className="rounded-lg border p-4">
        <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Download className="h-5 w-5" />
          导出配置
        </h3>

        <div className="space-y-4">
          {/* Export Scope Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">导出范围</label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "config"}
                  onChange={() => setExportScope("config")}
                  className="rounded-full border-gray-300"
                />
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">仅配置 (YAML)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "credentials"}
                  onChange={() => setExportScope("credentials")}
                  className="rounded-full border-gray-300"
                />
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">仅凭证 (JSON)</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="exportScope"
                  checked={exportScope === "full"}
                  onChange={() => setExportScope("full")}
                  className="rounded-full border-gray-300"
                />
                <Package className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">完整导出 (配置 + 凭证)</span>
              </label>
            </div>
          </div>

          {/* Redaction Option */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={redactSecrets}
              onChange={(e) => setRedactSecrets(e.target.checked)}
              className="rounded border-gray-300"
            />
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">脱敏敏感信息（API 密钥、Token 等）</span>
          </label>

          {/* Security hint */}
          {!redactSecrets &&
            (exportScope === "credentials" || exportScope === "full") && (
              <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400">
                <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm">
                  未脱敏的导出文件将包含明文 API 密钥和 Token，请妥善保管。
                </span>
              </div>
            )}

          <div className="flex gap-2">
            <button
              onClick={handleExportClick}
              disabled={!config || isExporting}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              {isExporting ? "导出中..." : "导出"}
            </button>
          </div>

          <p className="text-sm text-muted-foreground">
            {exportScope === "config" &&
              "导出当前配置为 YAML 文件，可用于备份或迁移。"}
            {exportScope === "credentials" &&
              "导出凭证池中的所有凭证，包括 OAuth Token 文件。"}
            {exportScope === "full" &&
              "导出完整的配置和凭证包，可用于完整迁移到其他设备。"}
          </p>
        </div>
      </div>

      {/* Import Section */}
      <div className="rounded-lg border p-4">
        <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Upload className="h-5 w-5" />
          导入配置
        </h3>

        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".yaml,.yml,.json"
            onChange={handleFileSelect}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted"
          >
            <Upload className="h-4 w-4" />
            选择文件
          </button>

          <p className="text-sm text-muted-foreground">
            支持导入 YAML 配置文件或 JSON 导出包，支持合并或替换现有配置。
          </p>
        </div>
      </div>

      {/* Security Warning Dialog */}
      {showSecurityWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900">
                <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
              </div>
              <h3 className="text-lg font-medium">安全警告</h3>
            </div>

            <p className="text-sm text-muted-foreground mb-4">
              您即将导出未脱敏的凭证数据，导出文件将包含明文 API 密钥和 OAuth
              Token。 请确保：
            </p>
            <ul className="list-disc list-inside text-sm text-muted-foreground mb-4 space-y-1">
              <li>不要将此文件分享给他人</li>
              <li>不要上传到公共代码仓库</li>
              <li>妥善保管导出文件</li>
            </ul>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSecurityWarning(false)}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={performExport}
                className="rounded-lg bg-yellow-600 px-4 py-2 text-sm text-white hover:bg-yellow-700"
              >
                我已了解，继续导出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl rounded-lg bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-medium mb-4 flex items-center gap-2">
              {getFileTypeIcon()}
              导入配置 - {importFileName}
            </h3>

            {/* Validation Result */}
            {validationResult && (
              <div className="mb-4 space-y-2">
                {validationResult.valid ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
                    <Check className="h-5 w-5" />
                    <span className="text-sm">文件格式有效</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                    <AlertCircle className="h-5 w-5 flex-shrink-0" />
                    <div className="text-sm">
                      <p className="font-medium">文件格式无效</p>
                      <ul className="mt-1 list-disc list-inside">
                        {validationResult.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* Content info */}
                {validationResult.valid && (
                  <div className="flex flex-wrap gap-2 text-sm">
                    {validationResult.version && (
                      <span className="rounded bg-muted px-2 py-1">
                        版本: {validationResult.version}
                      </span>
                    )}
                    {validationResult.has_config && (
                      <span className="rounded bg-blue-100 px-2 py-1 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                        包含配置
                      </span>
                    )}
                    {validationResult.has_credentials && (
                      <span className="rounded bg-purple-100 px-2 py-1 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                        包含凭证
                      </span>
                    )}
                    {validationResult.redacted && (
                      <span className="rounded bg-yellow-100 px-2 py-1 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                        已脱敏
                      </span>
                    )}
                  </div>
                )}

                {/* Redaction warning */}
                {validationResult.redacted && (
                  <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-400">
                    <AlertTriangle className="h-5 w-5 flex-shrink-0" />
                    <span className="text-sm">
                      此导出包已脱敏，凭证数据（API 密钥、Token）无法恢复。
                    </span>
                  </div>
                )}

                {/* Validation warnings */}
                {validationResult.warnings.length > 0 && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
                    <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                      警告
                    </p>
                    <ul className="mt-1 list-disc list-inside text-sm text-yellow-600 dark:text-yellow-500">
                      {validationResult.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Preview */}
            <div className="mb-4">
              <label className="text-sm font-medium">内容预览</label>
              <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-4 text-xs font-mono">
                {importContent.slice(0, 2000)}
                {importContent.length > 2000 && "\n..."}
              </pre>
            </div>

            {/* Import Options */}
            <div className="mb-4 space-y-2">
              <label className="text-sm font-medium">导入模式</label>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="importMode"
                    checked={mergeConfig}
                    onChange={() => setMergeConfig(true)}
                    className="rounded-full border-gray-300"
                  />
                  <span className="text-sm">合并到现有配置</span>
                  <span className="text-xs text-muted-foreground">
                    （保留现有数据，添加新数据）
                  </span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="importMode"
                    checked={!mergeConfig}
                    onChange={() => setMergeConfig(false)}
                    className="rounded-full border-gray-300"
                  />
                  <span className="text-sm">替换现有配置</span>
                  <span className="text-xs text-muted-foreground">
                    （完全覆盖现有数据）
                  </span>
                </label>
              </div>
            </div>

            {/* Import Result Warnings */}
            {importResult?.warnings && importResult.warnings.length > 0 && (
              <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-800 dark:bg-yellow-950">
                <p className="text-sm font-medium text-yellow-700 dark:text-yellow-400">
                  导入警告
                </p>
                <ul className="mt-1 list-disc list-inside text-sm text-yellow-600 dark:text-yellow-500">
                  {importResult.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Success */}
            {importResult?.success && (
              <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400">
                <Check className="h-5 w-5" />
                <span className="text-sm">配置导入成功</span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={closeImportDialog}
                className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
              >
                {importResult?.success ? "关闭" : "取消"}
              </button>
              {!importResult?.success && validationResult?.valid && (
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isImporting ? "导入中..." : "导入"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Global Error */}
      {error && !showImportDialog && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}
    </div>
  );
}
