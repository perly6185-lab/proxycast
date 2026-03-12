//! 块文件循环缓冲存储
//!
//! 实现终端输出历史的文件存储，使用循环缓冲策略管理文件大小。
//!
//! ## 功能
//! - 循环缓冲写入（超过最大大小时覆盖旧数据）
//! - 文件读取和截断
//! - 可配置最大文件大小
//!
//! ## 设计说明
//! 采用简单的循环缓冲策略：当文件大小超过配置的最大值时，
//! 保留最新的数据，丢弃最旧的数据。
//!
//! _Requirements: 3.1, 3.2, 3.3, 3.4, 3.7_

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use parking_lot::RwLock;

use crate::error::TerminalError;

/// 默认终端块文件最大大小 (256KB)
pub const DEFAULT_TERM_MAX_FILE_SIZE: usize = 256 * 1024;

/// 块文件管理器
///
/// 管理单个终端会话的输出历史文件，使用循环缓冲策略。
pub struct BlockFile {
    /// 块 ID（通常是会话 ID）
    block_id: String,
    /// 文件路径
    file_path: PathBuf,
    /// 最大文件大小
    max_size: usize,
    /// 当前写入位置（用于循环缓冲）
    write_pos: AtomicUsize,
    /// 当前文件大小
    current_size: AtomicUsize,
    /// 是否已经开始循环（文件已满过一次）
    is_wrapped: RwLock<bool>,
    /// 文件句柄（用于写入）
    file: RwLock<Option<File>>,
}

impl BlockFile {
    /// 创建新的块文件
    ///
    /// # 参数
    /// - `block_id`: 块 ID（通常是会话 ID）
    /// - `base_dir`: 基础目录路径
    /// - `max_size`: 最大文件大小（字节）
    ///
    /// # 返回
    /// - `Ok(BlockFile)`: 创建成功
    /// - `Err(TerminalError)`: 创建失败
    ///
    /// _Requirements: 3.1, 3.3_
    pub fn new(block_id: &str, base_dir: &Path, max_size: usize) -> Result<Self, TerminalError> {
        let file_path = base_dir.join(format!("{block_id}.block"));

        // 确保目录存在
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                TerminalError::BlockFileError(format!("无法创建目录 {parent:?}: {e}"))
            })?;
        }

        // 检查文件是否已存在，获取当前大小
        let (current_size, is_wrapped) = if file_path.exists() {
            let metadata = fs::metadata(&file_path)
                .map_err(|e| TerminalError::BlockFileError(format!("无法读取文件元数据: {e}")))?;
            let size = metadata.len() as usize;
            // 如果文件大小已经达到最大值，说明已经循环过
            (size, size >= max_size)
        } else {
            (0, false)
        };

        // 打开或创建文件
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(&file_path)
            .map_err(|e| TerminalError::BlockFileError(format!("无法打开文件: {e}")))?;

        tracing::debug!(
            "[BlockFile] 创建块文件: {} (max_size: {}, current_size: {})",
            block_id,
            max_size,
            current_size
        );

        Ok(Self {
            block_id: block_id.to_string(),
            file_path,
            max_size,
            write_pos: AtomicUsize::new(current_size),
            current_size: AtomicUsize::new(current_size),
            is_wrapped: RwLock::new(is_wrapped),
            file: RwLock::new(Some(file)),
        })
    }

    /// 使用默认最大大小创建块文件
    ///
    /// # 参数
    /// - `block_id`: 块 ID
    /// - `base_dir`: 基础目录路径
    pub fn with_default_size(block_id: &str, base_dir: &Path) -> Result<Self, TerminalError> {
        Self::new(block_id, base_dir, DEFAULT_TERM_MAX_FILE_SIZE)
    }

    /// 获取块文件存储的默认基础目录
    pub fn default_base_dir() -> Result<PathBuf, TerminalError> {
        let home = dirs::home_dir()
            .ok_or_else(|| TerminalError::BlockFileError("无法获取主目录".to_string()))?;
        Ok(home.join(".proxycast").join("terminal_blocks"))
    }

    /// 获取块 ID
    pub fn block_id(&self) -> &str {
        &self.block_id
    }

    /// 获取文件路径
    pub fn file_path(&self) -> &PathBuf {
        &self.file_path
    }

    /// 获取最大文件大小
    pub fn max_size(&self) -> usize {
        self.max_size
    }

    /// 获取当前文件大小
    ///
    /// _Requirements: 3.3_
    pub fn size(&self) -> usize {
        self.current_size.load(Ordering::Relaxed)
    }

    /// 追加数据到块文件
    ///
    /// 使用循环缓冲策略：当文件大小超过最大值时，覆盖最旧的数据。
    ///
    /// # 参数
    /// - `data`: 要追加的数据
    ///
    /// # 返回
    /// - `Ok(())`: 追加成功
    /// - `Err(TerminalError)`: 追加失败
    ///
    /// _Requirements: 3.2, 3.4_
    pub fn append_data(&self, data: &[u8]) -> Result<(), TerminalError> {
        if data.is_empty() {
            return Ok(());
        }

        let mut file_guard = self.file.write();
        let file = file_guard
            .as_mut()
            .ok_or_else(|| TerminalError::BlockFileError("文件已关闭".to_string()))?;

        // 如果数据本身就超过最大大小，只保留最后 max_size 字节
        let data_to_write = if data.len() >= self.max_size {
            &data[data.len() - self.max_size..]
        } else {
            data
        };

        let current_size = self.current_size.load(Ordering::Relaxed);
        let new_total = current_size + data_to_write.len();

        if new_total <= self.max_size {
            // 文件未满，直接追加
            file.seek(SeekFrom::End(0))
                .map_err(|e| TerminalError::BlockFileError(format!("Seek 失败: {e}")))?;
            file.write_all(data_to_write)
                .map_err(|e| TerminalError::BlockFileError(format!("写入失败: {e}")))?;
            file.flush()
                .map_err(|e| TerminalError::BlockFileError(format!("Flush 失败: {e}")))?;
            self.current_size.store(new_total, Ordering::Relaxed);
            self.write_pos.store(new_total, Ordering::Relaxed);
        } else {
            // 文件将超过最大大小，需要使用循环缓冲策略
            // 策略：读取现有数据，保留最新的部分，然后重写文件
            self.apply_circular_buffer(file, data_to_write)?;
        }

        Ok(())
    }

    /// 应用循环缓冲策略
    ///
    /// 当新数据会导致文件超过最大大小时调用。
    /// 保留最新的数据，丢弃最旧的数据。
    fn apply_circular_buffer(&self, file: &mut File, new_data: &[u8]) -> Result<(), TerminalError> {
        // 读取现有数据
        file.seek(SeekFrom::Start(0))
            .map_err(|e| TerminalError::BlockFileError(format!("Seek 失败: {e}")))?;

        let current_size = self.current_size.load(Ordering::Relaxed);
        let mut existing_data = vec![0u8; current_size];
        file.read_exact(&mut existing_data)
            .map_err(|e| TerminalError::BlockFileError(format!("读取失败: {e}")))?;

        // 合并数据
        let mut combined = existing_data;
        combined.extend_from_slice(new_data);

        // 只保留最后 max_size 字节
        let final_data = if combined.len() > self.max_size {
            &combined[combined.len() - self.max_size..]
        } else {
            &combined[..]
        };

        // 重写文件
        file.seek(SeekFrom::Start(0))
            .map_err(|e| TerminalError::BlockFileError(format!("Seek 失败: {e}")))?;
        file.write_all(final_data)
            .map_err(|e| TerminalError::BlockFileError(format!("写入失败: {e}")))?;
        file.set_len(final_data.len() as u64)
            .map_err(|e| TerminalError::BlockFileError(format!("截断失败: {e}")))?;
        file.flush()
            .map_err(|e| TerminalError::BlockFileError(format!("Flush 失败: {e}")))?;

        self.current_size.store(final_data.len(), Ordering::Relaxed);
        self.write_pos.store(final_data.len(), Ordering::Relaxed);
        *self.is_wrapped.write() = true;

        Ok(())
    }

    /// 读取所有数据
    ///
    /// # 返回
    /// - `Ok(Vec<u8>)`: 文件中的所有数据
    /// - `Err(TerminalError)`: 读取失败
    ///
    /// _Requirements: 3.6_
    pub fn read_all(&self) -> Result<Vec<u8>, TerminalError> {
        let mut file_guard = self.file.write();
        let file = file_guard
            .as_mut()
            .ok_or_else(|| TerminalError::BlockFileError("文件已关闭".to_string()))?;

        let current_size = self.current_size.load(Ordering::Relaxed);
        if current_size == 0 {
            return Ok(Vec::new());
        }

        file.seek(SeekFrom::Start(0))
            .map_err(|e| TerminalError::BlockFileError(format!("Seek 失败: {e}")))?;

        let mut data = vec![0u8; current_size];
        file.read_exact(&mut data)
            .map_err(|e| TerminalError::BlockFileError(format!("读取失败: {e}")))?;

        Ok(data)
    }

    /// 截断文件（清空内容）
    ///
    /// # 返回
    /// - `Ok(())`: 截断成功
    /// - `Err(TerminalError)`: 截断失败
    ///
    /// _Requirements: 3.7_
    pub fn truncate(&self) -> Result<(), TerminalError> {
        let mut file_guard = self.file.write();
        let file = file_guard
            .as_mut()
            .ok_or_else(|| TerminalError::BlockFileError("文件已关闭".to_string()))?;

        file.set_len(0)
            .map_err(|e| TerminalError::BlockFileError(format!("截断失败: {e}")))?;
        file.seek(SeekFrom::Start(0))
            .map_err(|e| TerminalError::BlockFileError(format!("Seek 失败: {e}")))?;
        file.flush()
            .map_err(|e| TerminalError::BlockFileError(format!("Flush 失败: {e}")))?;

        self.current_size.store(0, Ordering::Relaxed);
        self.write_pos.store(0, Ordering::Relaxed);
        *self.is_wrapped.write() = false;

        tracing::debug!("[BlockFile] 截断块文件: {}", self.block_id);
        Ok(())
    }

    /// 删除块文件
    ///
    /// 关闭文件句柄并删除文件。
    pub fn delete(self) -> Result<(), TerminalError> {
        // 先关闭文件句柄
        {
            let mut file_guard = self.file.write();
            *file_guard = None;
        }

        // 删除文件
        if self.file_path.exists() {
            fs::remove_file(&self.file_path)
                .map_err(|e| TerminalError::BlockFileError(format!("删除文件失败: {e}")))?;
        }

        tracing::debug!("[BlockFile] 删除块文件: {}", self.block_id);
        Ok(())
    }

    /// 检查文件是否存在
    pub fn exists(&self) -> bool {
        self.file_path.exists()
    }

    /// 检查是否已经循环过（文件曾经满过）
    pub fn is_wrapped(&self) -> bool {
        *self.is_wrapped.read()
    }
}

impl Drop for BlockFile {
    fn drop(&mut self) {
        // 确保文件句柄被正确关闭
        let mut file_guard = self.file.write();
        if let Some(ref mut file) = *file_guard {
            let _ = file.flush();
        }
        *file_guard = None;
    }
}
