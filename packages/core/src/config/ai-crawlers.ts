/**
 * Agent tokens whose robots.txt posture F2 reports on.
 *
 * Config, not logic: this list will drift as vendors rename tokens. Adding a
 * token changes what F2 reports, so it is a methodology change.
 */

export const AI_CRAWLER_TOKENS_VERSION = "2026-08-04";

export interface AiCrawlerToken {
  readonly token: string;
  readonly vendor: string;
  /** What the operator is opting in or out of by naming this token. */
  readonly purpose: "training" | "search" | "user-fetch" | "mixed";
}

export const AI_CRAWLER_TOKENS: readonly AiCrawlerToken[] = [
  { token: "GPTBot", vendor: "OpenAI", purpose: "training" },
  { token: "OAI-SearchBot", vendor: "OpenAI", purpose: "search" },
  { token: "ChatGPT-User", vendor: "OpenAI", purpose: "user-fetch" },
  { token: "ClaudeBot", vendor: "Anthropic", purpose: "training" },
  { token: "Claude-SearchBot", vendor: "Anthropic", purpose: "search" },
  { token: "Claude-User", vendor: "Anthropic", purpose: "user-fetch" },
  { token: "Google-Extended", vendor: "Google", purpose: "training" },
  { token: "Googlebot", vendor: "Google", purpose: "search" },
  { token: "Applebot-Extended", vendor: "Apple", purpose: "training" },
  { token: "Applebot", vendor: "Apple", purpose: "search" },
  { token: "bingbot", vendor: "Microsoft", purpose: "search" },
  { token: "PerplexityBot", vendor: "Perplexity", purpose: "search" },
  { token: "Perplexity-User", vendor: "Perplexity", purpose: "user-fetch" },
  { token: "meta-externalagent", vendor: "Meta", purpose: "training" },
  { token: "Amazonbot", vendor: "Amazon", purpose: "mixed" },
  { token: "Bytespider", vendor: "ByteDance", purpose: "training" },
  { token: "CCBot", vendor: "Common Crawl", purpose: "training" },
  { token: "MistralAI-User", vendor: "Mistral", purpose: "user-fetch" },
  { token: "DuckAssistBot", vendor: "DuckDuckGo", purpose: "search" },
  { token: "cohere-ai", vendor: "Cohere", purpose: "training" },
] as const;
