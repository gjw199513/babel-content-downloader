import { JSDOM } from "jsdom";
import {
  extractWebDocument,
  WebHtmlExtractionError,
  type WebHtmlExtraction,
  type WebHtmlExtractionErrorCode,
} from "./web-document-extractor.js";

export { extractWebDocument, WebHtmlExtractionError };
export type { WebHtmlExtraction, WebHtmlExtractionErrorCode };

/**
 * Node HTTP entry point for the generic current-page extractor. JSDOM's
 * default configuration does not execute source scripts or load subresources.
 */
export function extractWebHtml(html: string, url: string): WebHtmlExtraction {
  let pageUrl: URL;
  try {
    pageUrl = new URL(url);
  } catch {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page has no valid public URL.");
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    throw new WebHtmlExtractionError("CONTENT_NOT_FOUND", "The fetched page has no valid public URL.");
  }
  // Do not set `runScripts` or `resources`: both source script execution and
  // subresource network loading remain disabled by JSDOM's secure defaults.
  const dom = new JSDOM(html, { url: pageUrl.href, contentType: "text/html" });
  try {
    return extractWebDocument(dom.window.document, pageUrl);
  } finally {
    dom.window.close();
  }
}
