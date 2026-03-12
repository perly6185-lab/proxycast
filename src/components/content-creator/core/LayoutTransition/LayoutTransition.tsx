/**
 * @file 布局过渡组件
 * @description 处理对话和画布之间的布局切换动画
 * @module components/content-creator/core/LayoutTransition/LayoutTransition
 */

import React, { memo } from "react";
import styled from "styled-components";
import { LayoutMode } from "../../types";
import { useLayoutTransition, TransitionConfig } from "./useLayoutTransition";

const Container = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  gap: 12px;
`;

const ChatPanel = styled.div<{
  $width: string;
  $duration: number;
  $minWidth: string;
  $hidden: boolean;
}>`
  height: 100%;
  overflow: hidden;
  transition: width ${({ $duration }) => $duration}ms ease-out;
  width: ${({ $width }) => $width};
  min-width: ${({ $minWidth }) => $minWidth};
  will-change: width;
  display: ${({ $hidden }) => ($hidden ? "none" : "flex")};
  flex-direction: column;
  padding: 16px 16px 16px 0;
`;

const ChatPanelInner = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: hsl(var(--background));
  border-radius: 12px;
  border: 1px solid hsl(var(--border));
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
`;

const CanvasPanel = styled.div<{
  $visible: boolean;
  $transform: string;
  $opacity: number;
  $duration: number;
}>`
  position: relative;
  height: 100%;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  transition:
    transform ${({ $duration }) => $duration}ms ease-out,
    opacity ${({ $duration }) => $duration}ms ease-out;
  transform: ${({ $transform }) => $transform};
  opacity: ${({ $opacity }) => $opacity};
  display: ${({ $visible }) => ($visible ? "block" : "none")};
  will-change: transform, opacity;
`;

interface LayoutTransitionProps {
  /** 当前布局模式 */
  mode: LayoutMode;
  /** 对话区域内容 */
  chatContent: React.ReactNode;
  /** 画布区域内容 */
  canvasContent: React.ReactNode;
  /** 过渡配置 */
  transitionConfig?: TransitionConfig;
}

/**
 * 布局过渡组件
 *
 * 处理纯对话和对话+画布两种布局之间的平滑切换
 */
export const LayoutTransition: React.FC<LayoutTransitionProps> = memo(
  ({ mode, chatContent, canvasContent, transitionConfig }) => {
    const hasCanvasContent = React.Children.count(canvasContent) > 0;
    const effectiveMode: LayoutMode = hasCanvasContent ? mode : "chat";
    const { isCanvasVisible, getTransitionStyles } = useLayoutTransition(
      effectiveMode,
      transitionConfig,
    );

    const chatStyles = getTransitionStyles("chat");
    const canvasStyles = getTransitionStyles("canvas");
    const shouldRenderCanvas = hasCanvasContent && isCanvasVisible;

    return (
      <Container
        data-testid="layout-transition-root"
        data-effective-mode={effectiveMode}
        data-has-canvas={shouldRenderCanvas ? "true" : "false"}
      >
        <CanvasPanel
          $visible={shouldRenderCanvas}
          $transform={canvasStyles.transform as string}
          $opacity={canvasStyles.opacity as number}
          $duration={parseInt(
            canvasStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
        >
          {canvasContent}
        </CanvasPanel>

        <ChatPanel
          $width={chatStyles.width as string}
          $duration={parseInt(
            chatStyles.transition?.match(/\d+/)?.[0] || "300",
          )}
          $minWidth={effectiveMode === "canvas" ? "0px" : "460px"}
          $hidden={effectiveMode === "canvas"}
        >
          <ChatPanelInner>{chatContent}</ChatPanelInner>
        </ChatPanel>
      </Container>
    );
  },
);

LayoutTransition.displayName = "LayoutTransition";
