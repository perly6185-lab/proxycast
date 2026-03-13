import styled from "styled-components";

// --- InputbarCore Styles ---

export const DragHandle = styled.div`
  position: absolute;
  top: -3px;
  left: 0;
  right: 0;
  height: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: row-resize;
  color: var(--muted-foreground);
  opacity: 0;
  transition: opacity 0.2s;
  z-index: 10;

  &:hover {
    opacity: 1;
  }
`;

export const Container = styled.div`
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 2;
  padding: 0 8px 12px 8px;
  width: 100%;
  max-width: none;
  margin: 0;

  &.floating-composer {
    padding: 0 0 4px 0;
  }
`;

export const InputBarContainer = styled.div`
  border: 1px solid hsl(var(--border));
  transition: all 0.2s ease;
  position: relative;
  border-radius: 17px;
  padding-top: 8px;
  background-color: #f4f4f5; /* Zinc-100: Distinct Gray Background */

  /* Dark mode adjustment */
  @media (prefers-color-scheme: dark) {
    background-color: #27272a; /* Zinc-800 */
    border-color: #3f3f46; /* Zinc-700 */
  }

  /* Focus state */
  &:focus-within {
    border-color: hsl(var(--primary));
    background-color: hsl(var(--background));
    box-shadow: 0 0 0 1px hsl(var(--primary));
  }

  &.file-dragging {
    border: 2px dashed #2ecc71;
    background-color: rgba(46, 204, 113, 0.03);
  }

  &.floating-composer {
    border-radius: 14px;
    padding-top: 1px;
    background: linear-gradient(180deg, #fcfdff 0%, #f7f9fc 100%);
    border-color: #d7e0ea;
    box-shadow:
      0 10px 26px rgba(15, 23, 42, 0.08),
      inset 0 1px 0 rgba(255, 255, 255, 0.78);
    backdrop-filter: none;
    opacity: 1;

    @media (prefers-color-scheme: dark) {
      background: linear-gradient(180deg, #2a2f39 0%, #232831 100%);
      border-color: #404958;
      box-shadow:
        0 12px 28px rgba(0, 0, 0, 0.28),
        inset 0 1px 0 rgba(255, 255, 255, 0.03);
    }
  }

  &.floating-composer.floating-collapsed {
    padding-top: 0;
    min-height: 44px;
    cursor: text;
  }

  &.floating-composer:focus-within {
    background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%);
    border-color: #c5d3e2;
    box-shadow:
      0 0 0 3px rgba(191, 219, 254, 0.38),
      0 12px 28px rgba(15, 23, 42, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.86);

    @media (prefers-color-scheme: dark) {
      background: linear-gradient(180deg, #303744 0%, #272d37 100%);
      border-color: #556174;
      box-shadow:
        0 0 0 3px rgba(96, 165, 250, 0.16),
        0 12px 28px rgba(0, 0, 0, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }
  }
`;

export const StyledTextarea = styled.textarea`
  padding: 0 15px;
  padding-top: 2px;
  border-radius: 0;
  display: flex;
  resize: none !important;
  overflow: auto;
  width: 100%;
  box-sizing: border-box;
  background: transparent;
  border: none;
  outline: none;
  line-height: 1.5;
  font-family: inherit;
  font-size: 14px;
  color: hsl(var(--foreground));
  min-height: 30px;

  &.floating-composer {
    padding: 0 12px;
    font-size: 13px;
    line-height: 1.4;
    min-height: 22px;
  }

  &.floating-composer.floating-collapsed {
    padding: 10px 48px 10px 14px;
    min-height: 42px;
    line-height: 1.35;
    overflow: hidden;
  }

  &::placeholder {
    color: hsl(var(--muted-foreground) / 0.78);
  }

  &::-webkit-scrollbar {
    width: 3px;
  }
  &::-webkit-scrollbar-thumb {
    background-color: hsl(var(--border));
    border-radius: 2px;
  }
`;

export const BottomBar = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 5px 8px;
  height: 40px;
  gap: 16px;
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  min-width: 0;

  &.floating-composer {
    padding: 2px 8px 6px;
    height: 34px;
    gap: 10px;
    border-top: 1px solid hsl(var(--border) / 0.75);
  }

  &.floating-composer.floating-collapsed {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    width: auto;
    min-width: 0;
    height: auto;
    padding: 0;
    gap: 0;
    border-top: none;
  }
`;
// ... (LeftSection and RightSection seem fine without vars, skipping for brevity of replace block if possible but might as well include to be safe or target specific chunks)

// I will split this into chunks to be safe and precise.

export const LeftSection = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  transition:
    opacity 0.16s ease,
    width 0.16s ease,
    flex-basis 0.16s ease,
    margin 0.16s ease;

  &::-webkit-scrollbar {
    display: none;
  }

  > * {
    flex-shrink: 0;
  }

  &.floating-collapsed {
    flex: 0 0 0;
    width: 0;
    opacity: 0;
    pointer-events: none;
  }
`;

export const RightSection = styled.div`
  display: flex;
  align-items: center;
  gap: 6px; /* Cherry Studio Exact: 6px */
  flex-shrink: 0;
  margin-left: 4px;

  &.floating-collapsed {
    margin-left: 0;
  }
`;

export const ActionButtonGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

// --- InputbarTools Styles ---

export const ToolButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  color: hsl(var(--muted-foreground));
  transition: all 0.2s ease-in-out;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0;
  margin-right: 2px;

  &:hover {
    color: hsl(var(--foreground));
    background-color: hsl(var(--secondary));
  }

  &.active {
    color: hsl(var(--primary));
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

export const Divider = styled.div`
  width: 1px;
  height: 16px;
  background-color: hsl(var(--border));
  margin: 0 4px;
`;

export const SendButton = styled.button<{ $isStop?: boolean; $hasLabel?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: ${({ $hasLabel }) => ($hasLabel ? "6px" : "0")};
  width: ${({ $hasLabel }) => ($hasLabel ? "auto" : "30px")};
  min-width: ${({ $hasLabel }) => ($hasLabel ? "68px" : "30px")};
  height: 30px;
  padding: ${({ $hasLabel }) => ($hasLabel ? "0 12px" : "0")};
  border-radius: ${({ $hasLabel }) => ($hasLabel ? "999px" : "50%")};
  background-color: ${({ $isStop }) =>
    $isStop ? "hsl(var(--destructive))" : "transparent"};
  color: ${({ $isStop }) => ($isStop ? "white" : "hsl(var(--primary))")};
  border: none;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    background-color: ${({ $isStop }) =>
      $isStop
        ? "hsl(var(--destructive) / 0.9)"
        : "hsl(var(--primary-foreground))"};
    transform: scale(1.05);
  }

  &:disabled {
    cursor: default;
    color: hsl(var(--muted-foreground));
    opacity: 0.5;
  }
`;

export const SecondaryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 68px;
  height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--destructive));
  transition: all 0.2s;

  &:hover:not(:disabled) {
    border-color: hsl(var(--destructive) / 0.4);
    background: hsl(var(--destructive) / 0.06);
  }

  &:disabled {
    cursor: default;
    color: hsl(var(--muted-foreground));
    opacity: 0.6;
  }
`;

// --- Image Preview Styles ---

export const ImagePreviewContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 15px;
  border-bottom: 1px solid hsl(var(--border));
`;

export const ImagePreviewItem = styled.div`
  position: relative;
  width: 60px;
  height: 60px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background-color: hsl(var(--muted));
`;

export const ImagePreviewImg = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`;

export const ImageRemoveButton = styled.button`
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background-color: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background-color 0.2s;

  &:hover {
    background-color: rgba(220, 38, 38, 0.9);
  }
`;
