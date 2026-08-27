import { Browser } from "@wailsio/runtime";
import type { MouseEvent } from "react";
import "./AboutPage.css";

const projectUrl = "https://github.com/Ricori/finoka";
const acknowledgementUrl = "https://github.com/caca2331/finesub";

function ExternalLink({ href, children }: { href: string; children: string }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void Browser.OpenURL(href).catch(() => window.open(href, "_blank", "noopener,noreferrer"));
  };

  return (
    <a href={href} target="_blank" rel="noreferrer" onClick={open}>
      <span>{children}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14 5h5v5m0-5-8 8M19 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4" />
      </svg>
    </a>
  );
}

export function AboutPage() {
  return (
    <section className="about-layout">
      <article className="panel about-hero">
        <div className="about-mark" aria-hidden="true">F</div>
        <div className="about-heading">
          <span className="eyebrow">Finoka</span>
          <h2>让字幕创作更轻松</h2>
          <p>一款面向视频字幕工作流的桌面工具</p>
        </div>
      </article>

      <article className="panel about-details">
        <div className="about-row">
          <div>
            <span>作者</span>
            <strong>伊波千果</strong>
          </div>
        </div>
        <div className="about-row">
          <div>
            <span>项目源码</span>
            <ExternalLink href={projectUrl}>github.com/Ricori/finoka</ExternalLink>
          </div>
        </div>
        <div className="about-row">
          <div>
            <span>鸣谢</span>
            <ExternalLink href={acknowledgementUrl}>caca2331/finesub</ExternalLink>
          </div>
          <p>感谢 finesub 项目带来的顶尖转写引擎。</p>
        </div>
      </article>
    </section>
  );
}
