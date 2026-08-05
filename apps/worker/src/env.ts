export interface Env {
  readonly DB: D1Database;
  readonly ARTIFACTS: R2Bucket;
  readonly SCAN_CACHE: KVNamespace;
  readonly CRAWL_QUEUE: Queue<CrawlMessage>;
  /**
   * Which skin to render — see packages/core/src/theme.
   *
   * Unset, empty or unrecognised gives the neutral theme, never Radixia's. A fork
   * that deploys this must not inherit somebody else's identity by default, and an
   * unset variable is the most likely way that would happen.
   */
  readonly CENSUS_THEME?: string;
  /**
   * localStorage key holding a site-wide light/dark override, if the surrounding
   * site has one. Census pages mirror it so a manual toggle elsewhere on the
   * origin also governs them. Unset means follow `prefers-color-scheme` only.
   */
  readonly THEME_STORAGE_KEY?: string;
}

/** One domain per message. Keeps a slow site from holding up a batch. */
export interface CrawlMessage {
  readonly runId: number;
  readonly apex: string;
}
