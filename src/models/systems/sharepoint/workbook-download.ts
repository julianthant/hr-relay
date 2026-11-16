export interface SharePointBrowserTransferInput {
  readonly controller: AbortController;
  readonly origin: string;
  readonly url: string;
  readonly kind: "json" | "xlsx" | "csv";
  readonly limit: number;
}

export interface SharePointBrowserTransferResult {
  readonly chunks: readonly string[];
  readonly failed: boolean;
  readonly tooLarge: boolean;
  readonly cleanupFailed: boolean;
}

export type SharePointBrowserTransport = (input: SharePointBrowserTransferInput) => Promise<SharePointBrowserTransferResult>;
