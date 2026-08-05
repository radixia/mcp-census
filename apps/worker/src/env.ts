export interface Env {
  readonly DB: D1Database;
  readonly ARTIFACTS: R2Bucket;
  readonly SCAN_CACHE: KVNamespace;
  readonly CRAWL_QUEUE: Queue<CrawlMessage>;
}

/** One domain per message. Keeps a slow site from holding up a batch. */
export interface CrawlMessage {
  readonly runId: number;
  readonly apex: string;
}
