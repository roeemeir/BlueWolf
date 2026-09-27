import type { InvestigationPdfReport } from "@/lib/investigation-pdf";
import { buildInvestigationPdfBrowser, jpegPagesToPdf } from "@/lib/investigation-pdf-browser";
import { buildInvestigationBrandedCover } from "@/lib/investigation-pdf-brand";
import { buildInvestigationEventSynopsisPages } from "@/lib/investigation-pdf-event-synopsis";
import { buildInvestigationPdfWithLifecycle, extractCanvasJpegPages } from "@/lib/investigation-pdf-lifecycle";
import { buildInvestigationWmtsMapPages } from "@/lib/investigation-pdf-wmts";

/**
 * Assemble the release from one immutable report snapshot. The original base
 * engineering pages retain their event numbers and full evidence. Separate
 * single-event renders are used ONLY to determine each chapter's page count;
 * they are never substituted for the original report's pages.
 *
 * A layout mismatch fails closed instead of assigning another event's map.
 * Lifecycle and version evidence remain attached as a documented appendix.
 */
export async function buildInvestigationReleasePdf(report: InvestigationPdfReport) {
  const [engineeringPdf, brandCover, mapPages] = await Promise.all([
    buildInvestigationPdfWithLifecycle(report),
    buildInvestigationBrandedCover(report),
    buildInvestigationWmtsMapPages(report),
  ]);
  const engineeringPages = extractCanvasJpegPages(engineeringPdf);
  if (mapPages.length !== report.events.length + 1) {
    throw new Error("REP-02: WMTS map count does not match the selected report events");
  }
  // The browser report begins with its original cover, overview, and (when
  // required) complete-legend pages. The new branded cover precedes them.
  const legendCount = report.events.length > 8 ? Math.ceil(report.events.length / 28) : 0;
  const overviewCount = 2 + legendCount;
  const pages = [brandCover, ...engineeringPages.slice(0, overviewCount), mapPages[0]];
  let cursor = overviewCount;
  for (const [index, event] of report.events.entries()) {
    // Use the renderer itself as the source of truth for chapter pagination;
    // do not duplicate its detail-row or overflow rules here.
    const isolated = await buildInvestigationPdfBrowser({ ...report, events: [event] });
    const eventPageCount = extractCanvasJpegPages(isolated).length - 2;
    if (eventPageCount < 1 || cursor + eventPageCount > engineeringPages.length) {
      throw new Error(`REP-02: invalid engineering chapter pagination for event ${event.result.eventId}`);
    }
    pages.push(
      ...engineeringPages.slice(cursor, cursor + eventPageCount),
      ...buildInvestigationEventSynopsisPages(event, index, report.events.length, report.source),
      mapPages[index + 1],
    );
    cursor += eventPageCount;
  }
  // These are original lifecycle pages, not invented or re-rendered evidence.
  pages.push(...engineeringPages.slice(cursor));
  return jpegPagesToPdf(pages);
}
