import React from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import { safeUrl } from '../../../core/render/urlSafety';

interface StreamMarkdownProps {
  content: string;
  className?: string;
}

export const StreamMarkdown: React.FC<StreamMarkdownProps> = ({ content, className }) => {
  return (
    <div className={`wisp-markdown-container ${className || ''}`}>
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={{
          // 禁用图片，渲染为 alt 文字占位符或 null，避免模型输出触发未确认的远程请求
          img: ({ alt }) => (alt ? <span className="wisp-img-alt">[{alt}]</span> : null),

          // 过滤 unsafe href，强制设置安全属性
          a: ({ href, children }) => {
            const safeHref = href ? safeUrl(href) : '';
            if (!safeHref) {
              return <span>{children}</span>;
            }
            return (
              <a href={safeHref} target="_blank" rel="noopener noreferrer nofollow">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
