import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Modal } from "./Modal";

interface MountedRoot {
  container: HTMLDivElement;
  root: Root;
}

const mountedRoots: MountedRoot[] = [];

function renderModal() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <Modal
        isOpen={true}
        onClose={() => {}}
        draggable={true}
        dragHandleSelector='[data-drag-handle="true"]'
      >
        <div>
          <div data-drag-handle="true">拖拽头部</div>
          <div>弹窗内容</div>
        </div>
      </Modal>,
    );
  });

  const mounted = { container, root };
  mountedRoots.push(mounted);
  return mounted;
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT?: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  while (mountedRoots.length > 0) {
    const mounted = mountedRoots.pop();
    if (!mounted) {
      break;
    }
    act(() => {
      mounted.root.unmount();
    });
    mounted.container.remove();
  }
});

describe("Modal", () => {
  it("启用 draggable 时应支持通过手柄拖动弹窗", () => {
    renderModal();

    const dragHandle = document.body.querySelector(
      '[data-drag-handle="true"]',
    ) as HTMLDivElement | null;
    const modalSurface = document.body.querySelector(
      '[data-draggable="true"]',
    ) as HTMLDivElement | null;

    act(() => {
      dragHandle?.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          clientX: 20,
          clientY: 30,
        }),
      );
    });

    act(() => {
      window.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          clientX: 70,
          clientY: 90,
        }),
      );
    });

    expect(modalSurface?.style.transform).toBe("translate(50px, 60px)");

    act(() => {
      window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  });
});
