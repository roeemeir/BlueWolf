import type { InvestigationPdfReport } from "@/lib/investigation-pdf";
import { jpegPagesToPdf } from "@/lib/investigation-pdf-browser";
import { buildInvestigationBrandedCover } from "@/lib/investigation-pdf-brand";
import { buildInvestigationPdfWithLifecycle, extractCanvasJpegPages } from "@/lib/investigation-pdf-lifecycle";
import { buildInvestigationWmtsMapPages } from "@/lib/investigation-pdf-wmts";

/**
 * The branded RTL cover uses the app's genuine favicon.svg, while all event
 * evidence still originates in the same report as the browser investigation.
 * Place the overview map before event chapters, not after the entire report.
 * WMTS tiles are read exclusively through the existing local proxy/cache;
 * missing tiles retain the truthful engineering-grid fallback.
 */
export async function buildInvestigationReleasePdf(report: InvestigationPdfReport) {
  const engineeringPdf = await buildInvestigationPdfWithLifecycle(report);
  const engineeringPages = extractCanvasJpegPages(engineeringPdf);
  const [brandCover, mapPages] = await Promise.all([
    buildInvestigationBrandedCover(report),
    buildInvestigationWmtsMapPages(report),
  ]);
  const overviewMap = mapPages.slice(0, 1);
  const eventMaps = mapPages.slice(1);
  return jpegPagesToPdf([
    brandCover,
    ...engineeringPages.slice(0, 1),
    ...overviewMap,
    ...engineeringPages.slice(1),
    ...eventMaps,
  ]);
}
