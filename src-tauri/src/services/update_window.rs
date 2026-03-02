//! 更新提醒窗口管理
//!
//! 提供独立的更新提醒悬浮窗口，与主应用窗口分离显示。
//! 参考 screenshot/window.rs 的实现模式。
//!
//! input: UpdateInfo（更新信息）
//! output: 独立的更新提醒窗口
//! pos: services 层，被 update_cmd 调用

use mouse_position::mouse_position::Mouse;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tracing::{debug, info};

#[cfg(target_os = "macos")]
#[allow(deprecated)]
use cocoa::appkit::{NSColor, NSWindow};
#[cfg(target_os = "macos")]
#[allow(deprecated)]
use cocoa::base::{id, nil};

use super::update_check_service::UpdateInfo;

/// 窗口错误类型
#[derive(Debug, thiserror::Error)]
pub enum UpdateWindowError {
    #[error("窗口创建失败: {0}")]
    CreateFailed(String),
    #[error("窗口操作失败: {0}")]
    OperationFailed(String),
}

/// 更新提醒窗口标签
const UPDATE_WINDOW_LABEL: &str = "update-notification";

/// 窗口尺寸
const WINDOW_WIDTH: f64 = 620.0;
const WINDOW_HEIGHT: f64 = 132.0;

/// 距离屏幕底部的边距
const BOTTOM_MARGIN: f64 = 24.0;

/// 获取鼠标所在的显示器
fn get_monitor_at_cursor(app: &AppHandle) -> Option<tauri::Monitor> {
    let (cursor_x, cursor_y) = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => {
            debug!("鼠标位置: ({}, {})", x, y);
            (x as f64, y as f64)
        }
        Mouse::Error => {
            debug!("无法获取鼠标位置");
            return None;
        }
    };

    let monitors = match app.available_monitors() {
        Ok(monitors) => monitors,
        Err(e) => {
            debug!("无法获取显示器列表: {}", e);
            return None;
        }
    };

    for monitor in monitors {
        let pos = monitor.position();
        let size = monitor.size();

        let left = pos.x as f64;
        let top = pos.y as f64;
        let right = left + size.width as f64;
        let bottom = top + size.height as f64;

        if cursor_x >= left && cursor_x < right && cursor_y >= top && cursor_y < bottom {
            debug!(
                "鼠标在显示器: {:?}, 位置: ({}, {}), 尺寸: {}x{}",
                monitor.name(),
                pos.x,
                pos.y,
                size.width,
                size.height
            );
            return Some(monitor);
        }
    }

    debug!("未找到鼠标所在的显示器");
    None
}

/// 计算窗口位置（鼠标所在屏幕的底部居中）
fn calculate_window_position(app: &AppHandle) -> (f64, f64) {
    // 优先获取鼠标所在的显示器，否则使用主显示器
    let monitor = get_monitor_at_cursor(app).or_else(|| app.primary_monitor().ok().flatten());

    if let Some(monitor) = monitor {
        let screen_pos = monitor.position();
        let screen_size = monitor.size();
        let scale_factor = monitor.scale_factor();

        // 物理像素转换为逻辑像素
        let screen_width = screen_size.width as f64 / scale_factor;
        let screen_height = screen_size.height as f64 / scale_factor;
        let screen_x = screen_pos.x as f64 / scale_factor;
        let screen_y = screen_pos.y as f64 / scale_factor;

        // 底部居中定位
        let x = screen_x + (screen_width - WINDOW_WIDTH) / 2.0;
        let y = screen_y + screen_height - WINDOW_HEIGHT - BOTTOM_MARGIN;

        debug!(
            "更新窗口位置: 屏幕({}, {}), 尺寸: {}x{}, 窗口位置: ({}, {})",
            screen_x, screen_y, screen_width, screen_height, x, y
        );
        return (x, y);
    }

    // 默认位置
    debug!("无法获取显示器信息，使用默认位置");
    (800.0, 400.0)
}

/// 打开更新提醒窗口
///
/// 如果窗口已存在，则更新内容并显示；否则创建新窗口
pub fn open_update_window(
    app: &AppHandle,
    update_info: &UpdateInfo,
) -> Result<(), UpdateWindowError> {
    info!("打开更新提醒窗口");

    // 构建窗口 URL，包含更新信息参数
    let url = format!(
        "/update-notification?current={}&latest={}&download_url={}",
        urlencoding::encode(&update_info.current_version),
        urlencoding::encode(update_info.latest_version.as_deref().unwrap_or("")),
        urlencoding::encode(update_info.download_url.as_deref().unwrap_or(""))
    );

    debug!("更新窗口 URL: {}", url);

    // 检查窗口是否已存在
    if let Some(window) = app.get_webview_window(UPDATE_WINDOW_LABEL) {
        info!("更新窗口已存在，导航到新 URL 并显示");

        let (x, y) = calculate_window_position(app);
        use tauri::LogicalPosition;
        let _ = window.set_position(LogicalPosition::new(x, y));

        // 使用 JavaScript 导航到新的 URL
        let js = format!("window.location.href = '{url}';");
        window
            .eval(&js)
            .map_err(|e| UpdateWindowError::OperationFailed(format!("导航失败: {e}")))?;

        window
            .show()
            .map_err(|e| UpdateWindowError::OperationFailed(format!("显示窗口失败: {e}")))?;

        window
            .set_focus()
            .map_err(|e| UpdateWindowError::OperationFailed(format!("聚焦窗口失败: {e}")))?;

        return Ok(());
    }

    // 窗口不存在，动态创建
    info!("动态创建更新提醒窗口");

    let (x, y) = calculate_window_position(app);

    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
    let window = WebviewWindowBuilder::new(app, UPDATE_WINDOW_LABEL, WebviewUrl::App(url.into()))
        .inner_size(WINDOW_WIDTH, WINDOW_HEIGHT)
        .position(x, y)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(true)
        .focused(true)
        .transparent(true)
        .resizable(false)
        .build()
        .map_err(|e| UpdateWindowError::CreateFailed(format!("{e}")))?;

    // macOS: 设置窗口背景透明
    #[cfg(target_os = "macos")]
    {
        use objc::{msg_send, sel, sel_impl};
        if let Ok(ns_win) = window.ns_window() {
            #[allow(deprecated, unexpected_cfgs)]
            unsafe {
                let ns_window = ns_win as id;
                let clear_color = NSColor::clearColor(nil);
                ns_window.setBackgroundColor_(clear_color);
                let _: () = msg_send![ns_window, setOpaque: false];
                let _: () = msg_send![ns_window, setHasShadow: false];
            }
        }
    }

    info!("更新提醒窗口创建成功: {}", UPDATE_WINDOW_LABEL);

    Ok(())
}

/// 关闭更新提醒窗口
pub fn close_update_window(app: &AppHandle) -> Result<(), UpdateWindowError> {
    info!("关闭更新提醒窗口");

    if let Some(window) = app.get_webview_window(UPDATE_WINDOW_LABEL) {
        window
            .close()
            .map_err(|e| UpdateWindowError::OperationFailed(format!("关闭窗口失败: {e}")))?;
        info!("更新提醒窗口已关闭");
    } else {
        debug!("更新提醒窗口不存在，无需关闭");
    }

    Ok(())
}

/// 检查更新窗口是否打开
pub fn is_update_window_open(app: &AppHandle) -> bool {
    app.get_webview_window(UPDATE_WINDOW_LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_label() {
        assert_eq!(UPDATE_WINDOW_LABEL, "update-notification");
    }
}
