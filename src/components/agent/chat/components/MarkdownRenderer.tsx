import React, { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import styled from "styled-components";
import { Copy, Check } from "lucide-react";
import { parseA2UIJson } from "@/components/content-creator/a2ui/parser";
import type { A2UIFormData } from "@/components/content-creator/a2ui/types";
import { CHAT_A2UI_TASK_CARD_PRESET } from "@/components/content-creator/a2ui/taskCardPresets";
import { useDebouncedValue } from "@/lib/artifact/hooks/useDebouncedValue";
import { ArtifactPlaceholder } from "./ArtifactPlaceholder";
import { A2UITaskCard, A2UITaskLoadingCard } from "./A2UITaskCard";

const STREAMING_LIGHT_RENDER_THRESHOLD = 2_000;
const STREAMING_LIGHT_RENDER_DEBOUNCE_MS = 48;
const STREAMING_STANDARD_RENDER_DEBOUNCE_MS = 24;

// Custom styles for markdown content to match Cherry Studio
const MarkdownContainer = styled.div`
  font-size: 15px;
  line-height: 1.7;
  color: hsl(var(--foreground));
  overflow-wrap: break-word;

  p {
    margin-bottom: 1em;
    &:last-child {
      margin-bottom: 0;
    }
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 600;
    margin-top: 24px;
    margin-bottom: 16px;
    line-height: 1.25;
  }

  h1 {
    font-size: 1.75em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  h2 {
    font-size: 1.5em;
    border-bottom: 1px solid hsl(var(--border));
    padding-bottom: 0.3em;
  }
  h3 {
    font-size: 1.25em;
  }
  h4 {
    font-size: 1em;
  }

  ul,
  ol {
    padding-left: 20px;
    margin-bottom: 1em;
  }

  ul {
    list-style-type: disc;
  }

  ol {
    list-style-type: decimal;
  }

  li {
    margin-bottom: 0.5em;
  }

  strong {
    font-weight: 600;
  }

  em {
    font-style: italic;
  }

  hr {
    margin: 24px 0;
    border: none;
    border-top: 1px solid hsl(var(--border));
  }

  code {
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
      "Courier New", monospace;
    font-size: 0.9em;
    padding: 2px 4px;
    border-radius: 4px;
    background-color: hsl(var(--muted));
    color: hsl(var(--foreground));
  }

  pre {
    margin: 16px 0;
    padding: 0;
    background: transparent;
    border-radius: 8px;
    overflow: hidden;

    code {
      padding: 0;
      background: transparent;
      color: inherit;
    }
  }

  blockquote {
    border-left: 4px solid hsl(var(--primary));
    padding-left: 16px;
    margin-left: 0;
    color: hsl(var(--muted-foreground));
    font-style: italic;
  }

  table {
    border-collapse: collapse;
    width: 100%;
    margin-bottom: 1em;
  }

  th,
  td {
    border: 1px solid hsl(var(--border));
    padding: 6px 13px;
  }

  th {
    font-weight: 600;
    background-color: hsl(var(--muted));
  }

  a {
    color: hsl(var(--primary));
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  img {
    max-width: 100%;
    max-height: 512px;
    border-radius: 8px;
    object-fit: contain;
    cursor: pointer;
    transition: transform 0.2s ease;

    &:hover {
      transform: scale(1.02);
    }
  }
`;

// 图片容器样式
const ImageContainer = styled.div`
  margin: 1em 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const GeneratedImage = styled.img`
  max-width: 100%;
  max-height: 512px;
  border-radius: 8px;
  object-fit: contain;
  cursor: pointer;
  border: 1px solid hsl(var(--border));
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: scale(1.02);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }
`;

const CodeBlockContainer = styled.div`
  position: relative;
  margin: 1em 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid hsl(var(--border));
  background-color: #282c34; // Ensure background matches theme
`;

const CodeHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: #282c34; // Matches oneDark background
  color: #abb2bf;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const CopyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: white;
  }
`;

interface MarkdownRendererProps {
  content: string;
  /** A2UI 表单提交回调 */
  onA2UISubmit?: (formData: A2UIFormData) => void;
  /** 是否渲染消息内联 A2UI */
  renderA2UIInline?: boolean;
  /** 是否折叠代码块（当画布打开时） */
  collapseCodeBlocks?: boolean;
  /** 代码块点击回调（用于在画布中显示） */
  onCodeBlockClick?: (language: string, code: string) => void;
  /** 是否正在流式生成 */
  isStreaming?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(
  ({
    content,
    onA2UISubmit,
    renderA2UIInline = true,
    collapseCodeBlocks = false,
    onCodeBlockClick,
    isStreaming = false,
  }) => {
    const [copied, setCopied] = React.useState<string | null>(null);
    const useLightweightStreamingRender =
      isStreaming && content.length >= STREAMING_LIGHT_RENDER_THRESHOLD;
    const debouncedStreamingContent = useDebouncedValue(
      content,
      useLightweightStreamingRender
        ? STREAMING_LIGHT_RENDER_DEBOUNCE_MS
        : STREAMING_STANDARD_RENDER_DEBOUNCE_MS,
    );
    const renderContent = isStreaming ? debouncedStreamingContent : content;

    const remarkPlugins = React.useMemo(
      () =>
        useLightweightStreamingRender ? [remarkGfm] : [remarkGfm, remarkMath],
      [useLightweightStreamingRender],
    );

    const rehypePlugins = React.useMemo(
      () => (useLightweightStreamingRender ? [] : [rehypeRaw, rehypeKatex]),
      [useLightweightStreamingRender],
    );

    const handleCopy = (code: string) => {
      navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    };

    // 预处理内容：检测并提取 base64 图片
    const processedContent = React.useMemo(() => {
      // 匹配 markdown 图片语法中的 base64 data URL
      const base64ImageRegex =
        /!\[([^\]]*)\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      let result = renderContent;
      const images: { alt: string; src: string; placeholder: string }[] = [];

      let match;
      let index = 0;
      while ((match = base64ImageRegex.exec(renderContent)) !== null) {
        const placeholder = `__BASE64_IMAGE_${index}__`;
        images.push({
          alt: match[1] || "Generated Image",
          src: match[2],
          placeholder,
        });
        result = result.replace(match[0], placeholder);
        index++;
      }

      return { text: result, images };
    }, [renderContent]);

    // 渲染 base64 图片
    const renderBase64Images = () => {
      if (processedContent.images.length === 0) return null;

      return processedContent.images.map((img, idx) => {
        const handleImageClick = () => {
          const newWindow = window.open();
          if (newWindow) {
            newWindow.document.write(`
              <html>
                <head>
                  <title>${img.alt}</title>
                  <style>
                    body { 
                      margin: 0; 
                      display: flex; 
                      justify-content: center; 
                      align-items: center; 
                      min-height: 100vh; 
                      background: #1a1a1a; 
                    }
                    img { 
                      max-width: 100%; 
                      max-height: 100vh; 
                      object-fit: contain; 
                    }
                  </style>
                </head>
                <body>
                  <img src="${img.src}" alt="${img.alt}" />
                </body>
              </html>
            `);
            newWindow.document.close();
          }
        };

        return (
          <ImageContainer key={`base64-img-${idx}`}>
            <GeneratedImage
              src={img.src}
              alt={img.alt}
              onClick={handleImageClick}
              title="点击查看大图"
              onError={(e) => {
                console.error("[MarkdownRenderer] 图片加载失败:", img.alt);
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            <span
              style={{
                fontSize: "12px",
                color: "hsl(var(--muted-foreground))",
                textAlign: "center",
              }}
            >
              🖼️ AI 生成图片 - 点击查看大图
            </span>
          </ImageContainer>
        );
      });
    };

    // 检查处理后的文本是否只包含占位符
    const hasOnlyPlaceholders = React.useMemo(() => {
      const trimmed = processedContent.text.trim();
      return /^(__BASE64_IMAGE_\d+__\s*)+$/.test(trimmed) || trimmed === "";
    }, [processedContent.text]);

    return (
      <MarkdownContainer>
        {/* 先渲染 base64 图片 */}
        {renderBase64Images()}

        {/* 如果还有其他内容，渲染 markdown */}
        {!hasOnlyPlaceholders && processedContent.text.trim() && (
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            rehypePlugins={rehypePlugins}
            skipHtml={useLightweightStreamingRender}
            components={{
              // 使用 pre 组件来处理代码块，以便更好地控制 a2ui 的渲染
              pre({ children, ...props }: any) {
                // ReactMarkdown 传递的 children 是一个 React 元素
                // 需要通过 React.Children 来正确访问
                const child = React.Children.toArray(
                  children,
                )[0] as React.ReactElement;
                if (!child || !React.isValidElement(child)) {
                  return <pre {...props}>{children}</pre>;
                }

                const childProps = child.props as any;
                const className = childProps?.className || "";
                const match = /language-(\w+)/.exec(className);
                const language = match ? match[1] : "text";
                const codeChildren = childProps?.children;
                const codeContent = String(
                  Array.isArray(codeChildren)
                    ? codeChildren.join("")
                    : codeChildren || "",
                ).replace(/\n$/, "");

                // 如果是 a2ui 代码块，特殊处理
                if (language === "a2ui") {
                  if (!renderA2UIInline) {
                    return null;
                  }

                  const parsed = parseA2UIJson(codeContent);

                  if (parsed) {
                    // 解析成功，直接渲染 A2UI 组件（不包裹在 pre 中）
                    return (
                      <A2UITaskCard
                        response={parsed}
                        onSubmit={onA2UISubmit}
                        preset={CHAT_A2UI_TASK_CARD_PRESET}
                      />
                    );
                  } else {
                    // 解析失败（可能是流式输出中，JSON 还不完整）
                    return (
                      <A2UITaskLoadingCard
                        preset={CHAT_A2UI_TASK_CARD_PRESET}
                        subtitle="正在解析结构化问题，请稍等。"
                      />
                    );
              }
                }

                // 如果启用了代码块折叠，显示占位符卡片
                if (collapseCodeBlocks) {
                  const lineCount = codeContent.split("\n").length;
                  return (
                    <ArtifactPlaceholder
                      language={language}
                      lineCount={isStreaming ? undefined : lineCount}
                      isStreaming={isStreaming}
                      onClick={() => onCodeBlockClick?.(language, codeContent)}
                    />
                  );
                }

                if (useLightweightStreamingRender) {
                  return (
                    <pre {...props}>
                      <code className={className}>{codeContent}</code>
                    </pre>
                  );
                }

                // Block code - 完整显示
                const isCopied = copied === codeContent;

                return (
                  <CodeBlockContainer>
                    <CodeHeader>
                      <span>{language}</span>
                      <CopyButton onClick={() => handleCopy(codeContent)}>
                        {isCopied ? <Check size={14} /> : <Copy size={14} />}
                        {isCopied ? "Copied" : "Copy"}
                      </CopyButton>
                    </CodeHeader>
                    <SyntaxHighlighter
                      style={oneDark}
                      language={language}
                      PreTag="div"
                      customStyle={{
                        margin: 0,
                        padding: "16px",
                        background: "transparent",
                        fontSize: "13px",
                      }}
                    >
                      {codeContent}
                    </SyntaxHighlighter>
                  </CodeBlockContainer>
                );
              },
              code({ inline, className, children, ...props }: any) {
                // Inline code
                if (inline) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                }

                // 非 inline code 统一由 pre 组件处理，避免块级元素落入 <p>
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              // 普通图片渲染（非 base64）
              img({ src, alt, ...props }: any) {
                // base64 图片已经在上面单独处理了，这里只处理普通 URL 图片
                if (src?.startsWith("data:")) {
                  return null; // 跳过 base64 图片，已在上面处理
                }

                const handleImageClick = () => {
                  if (src) {
                    window.open(src, "_blank");
                  }
                };

                return (
                  <GeneratedImage
                    src={src}
                    alt={alt || "Image"}
                    onClick={handleImageClick}
                    title="点击查看大图"
                    {...props}
                  />
                );
              },
            }}
          >
            {processedContent.text}
          </ReactMarkdown>
        )}
      </MarkdownContainer>
    );
  },
);

MarkdownRenderer.displayName = "MarkdownRenderer";
