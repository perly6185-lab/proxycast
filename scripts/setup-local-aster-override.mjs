#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.cwd());
const cargoConfigDir = path.join(repoRoot, ".cargo");
const cargoConfigPath = path.join(cargoConfigDir, "config.toml");
const defaultAsterRepo = path.resolve(repoRoot, "..", "..", "astercloud", "aster-rust");
const blockStart = "# >>> proxycast local aster override >>>";
const blockEnd = "# <<< proxycast local aster override <<<";

function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printUsage() {
  console.log("用法:");
  console.log(
    "  npm run setup:local-aster -- [aster-rust 仓库路径]    生成仓库根 .cargo/config.toml 覆盖配置",
  );
  console.log("  npm run setup:local-aster -- --clear                 删除本地 Cargo 覆盖配置");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function resolveAsterRepoPath() {
  const arg = process.argv[2];
  if (!arg) {
    return defaultAsterRepo;
  }
  return path.resolve(repoRoot, arg);
}

function validateAsterRepo(asterRepoPath) {
  const crates = [
    path.join(asterRepoPath, "crates", "aster", "Cargo.toml"),
    path.join(asterRepoPath, "crates", "aster-models", "Cargo.toml"),
  ];

  for (const cratePath of crates) {
    if (!fs.existsSync(cratePath)) {
      console.error(`[proxycast] 未找到 Aster crate: ${cratePath}`);
      process.exit(1);
    }
  }
}

function buildConfigContent(asterRepoPath) {
  const asterPath = normalizePath(
    path.relative(cargoConfigDir, path.join(asterRepoPath, "crates", "aster")),
  );
  const asterModelsPath = normalizePath(
    path.relative(cargoConfigDir, path.join(asterRepoPath, "crates", "aster-models")),
  );

  return `${blockStart}
# 本地 Aster 覆盖配置
# 由 scripts/setup-local-aster-override.mjs 生成。
# 该文件已被 .gitignore 忽略，不会影响 CI/CD。

[patch."https://github.com/astercloud/aster-rust"]
aster-core = { path = "${asterPath}" }
aster-models = { path = "${asterModelsPath}" }
${blockEnd}
`;
}

function readExistingConfig() {
  if (!fs.existsSync(cargoConfigPath)) {
    return "";
  }

  return fs.readFileSync(cargoConfigPath, "utf8");
}

function upsertManagedBlock(existingContent, managedBlock) {
  if (!existingContent.trim()) {
    return managedBlock;
  }

  const blockPattern = new RegExp(
    `${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}\\n?`,
  );

  if (blockPattern.test(existingContent)) {
    return existingContent.replace(blockPattern, `${managedBlock}\n`);
  }

  return `${managedBlock}\n${existingContent}`;
}

function removeManagedBlock(existingContent) {
  if (!existingContent.trim()) {
    return "";
  }

  const blockPattern = new RegExp(
    `${escapeRegExp(blockStart)}[\\s\\S]*?${escapeRegExp(blockEnd)}\\n?`,
  );

  return existingContent
    .replace(blockPattern, "")
    .replace(/^\s+/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  printUsage();
  process.exit(0);
}

if (process.argv.includes("--clear")) {
  const existingContent = readExistingConfig();
  if (!existingContent) {
    console.log("[proxycast] 本地 Aster 覆盖配置不存在，无需删除。");
    process.exit(0);
  }

  const nextContent = removeManagedBlock(existingContent);
  if (nextContent) {
    fs.writeFileSync(cargoConfigPath, `${nextContent}\n`, "utf8");
    console.log(`[proxycast] 已移除本地 Aster 覆盖区块: ${cargoConfigPath}`);
  } else {
    fs.rmSync(cargoConfigPath);
    console.log(`[proxycast] 已删除本地 Aster 覆盖配置: ${cargoConfigPath}`);
  }
  process.exit(0);
}

const asterRepoPath = resolveAsterRepoPath();
validateAsterRepo(asterRepoPath);
ensureDirectory(cargoConfigDir);
const existingContent = readExistingConfig();
const nextContent = upsertManagedBlock(
  existingContent,
  buildConfigContent(asterRepoPath),
);
fs.writeFileSync(cargoConfigPath, nextContent, "utf8");

console.log(`[proxycast] 已生成本地 Aster 覆盖配置: ${cargoConfigPath}`);
console.log(`[proxycast] Aster 仓库: ${asterRepoPath}`);
