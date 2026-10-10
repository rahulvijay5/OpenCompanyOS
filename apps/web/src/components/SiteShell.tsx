import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";

const REPOSITORY_URL = "https://github.com/rahulvijay5/OpenCompanyOS";

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="site">
      <a className="site-skip" href="#content">
        Skip to content
      </a>
      <header className="site-bar">
        <Link className="site-brand" href="/">
          OpenCompanyOS
        </Link>
        <div className="site-tools">
          <nav className="site-nav" aria-label="Public">
            <Link href="/memo">Memo</Link>
            <Link href="/app">Experiment</Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <div id="content">{children}</div>
      <footer className="site-footer">
        <p>OpenCompanyOS · early-stage experiment</p>
        <nav aria-label="Footer">
          <Link href="/memo">Memo</Link>
          <Link href="/app">Experiment</Link>
          <a href={REPOSITORY_URL}>GitHub</a>
        </nav>
      </footer>
    </div>
  );
}
