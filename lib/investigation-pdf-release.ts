import type { InvestigationPdfReport } from "@/lib/investigation-pdf";
import { jpegPagesToPdf } from "@/lib/investigation-pdf-browser";
import { buildInvestigationPdfWithLifecycle, extractCanvasJpegPages } from "@/lib/investigation-pdf-lifecycle";
import { buildInvestigationWmtsMapPages } from "@/lib/investigation-pdf-wmts";

/**
 * Release PDF composition. The established truth-backed engineering/lifecycle
 * pages remain unchanged, and BW-OFF-010 adds one summary WMTS page plus one
 * WMTS page per event. The WMTS renderer reads only non-secret workspace
 * metadata in the browser and gets imagery exclusively through the local
 * same-origin map proxy/cache. If imagery is unavailable it renders the
 * engineering grid and still completes the report.
 */
export async function buildInvestigationReleasePdf(report: InvestigationPdfReport) {
  const engineeringPdf = await buildInvestigationPdfWithLifecycle(report);
  const engineeringPages = extractCanvasJpegPages(engineeringPdf);
  const mapPages = await buildInvestigationWmtsMapPages(report);
  return jpegPagesToPdf([...engineeringPages, ...mapPages]);
}
