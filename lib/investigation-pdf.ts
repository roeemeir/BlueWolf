import type { EventRecomputeResult } from "@/lib/investigation-contract";

export type InvestigationPdfEvent = {
  result: EventRecomputeResult;
  arena?: string | null;
  note?: string | null;
};

export type InvestigationPdfReport = {
  source?: "core-event-archive" | "simulator-archive";
  serverId: number;
  from?: string | null;
  to?: string | null;
  generatedAt: string;
  events: InvestigationPdfEvent[];
};

type PdfPage = { content: string };

const PAGE_W = 595;
const PAGE_H = 842;

function ascii(value: unknown) {
  return String(value ?? "").replace(/[^\x20-\x7E]/g, "?");
}

function pdfString(value: unknown) {
  return ascii(value).replace(/([\\()])/g, "\\$1");
}

function text(x: number, y: number, size: number, value: unknown, bold = false) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${pdfString(value)}) Tj ET`;
}

function line(x1: number, y1: number, x2: number, y2: number, width = 1, dash?: string) {
  return `${width.toFixed(2)} w ${dash ? `[${dash}] 0 d` : "[] 0 d"} ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function rect(x: number, y: number, width: number, height: number, lineWidth = 1) {
  return `${lineWidth.toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`;
}

function score(value: number | null) {
  return value === null ? "missing" : value.toFixed(1);
}

export function investigationEventSourceLabel(result: EventRecomputeResult, reportSource?: InvestigationPdfReport["source"]) {
  if (reportSource === "simulator-archive") {
    return "SIMULATOR ARCHIVE · synthetic QA evidence · no Python Core claim";
  }
  return result.source?.syntheticNavigation === true
    ? "TEST NAVIGATION · synthetic raw navigation scored by Python Core"
    : "Core event archive · no TEST navigation marker";
}

export function investigationReportSourceLabel(report: InvestigationPdfReport) {
  if (report.source === "simulator-archive") {
    return "SIMULATOR ARCHIVE · synthetic QA evidence · no Python Core claim";
  }
  return report.events.some((item) => item.result.source?.syntheticNavigation === true)
    ? "Core event archive · includes TEST NAVIGATION"
    : "Core event archive · no TEST navigation marker";
}

function pageContent(lines: string[]) {
  return ["0 G 0 g 1 J 1 j", ...lines].join("\n");
}

function coverPage(report: InvestigationPdfReport): PdfPage {
  const codeVersions = Array.from(new Set(report.events.map((item) => item.result.codeVersion)));
  const configVersions = Array.from(new Set(report.events.map((item) => item.result.configVersion)));
  const lines = [
    text(48, 780, 24, "Blue Wolf Investigation Report", true),
    text(48, 748, 11, `Server: ${report.serverId}`),
    text(48, 730, 11, `Generated: ${report.generatedAt}`),
    text(48, 712, 11, `Range from: ${report.from || "archive start"}`),
    text(48, 694, 11, `Range to: ${report.to || "archive end"}`),
    text(48, 668, 13, `Events: ${report.events.length}`, true),
    text(48, 642, 10, `Code version(s): ${codeVersions.join(", ")}`),
    text(48, 624, 10, `Config version(s): ${configVersions.join(", ")}`),
    line(48, 605, 547, 605, 1.2),
    text(48, 582, 12, "Event summary", true),
  ];
  let y = 558;
  for (const item of report.events.slice(0, 20)) {
    const result = item.result;
    lines.push(text(48, y, 9, `${result.eventId} | group ${result.groupId} | template ${result.templateId} | total ${score(result.summary.total)}`));
    y -= 18;
  }
  if (report.events.length > 20) lines.push(text(48, y, 9, `... ${report.events.length - 20} more events; every event has its own report page.`));
  const testNavigationPresent = report.events.some((item) => item.result.source?.syntheticNavigation === true);
  lines.push(text(48, 58, 8, report.source === "simulator-archive"
    ? "Source: SIMULATOR ARCHIVE; synthetic QA evidence only. No Python Core operational claim."
    : testNavigationPresent
      ? "Source: immutable Core event archive + Core recomputation; TEST NAVIGATION is present and labeled per event."
      : "Source: immutable Core event archive + real template recomputation; no TEST navigation marker is present."));
  return { content: pageContent(lines) };
}

function timelineCommands(result: EventRecomputeResult, x: number, y: number, width: number, height: number) {
  const commands = [rect(x, y, width, height, 0.8)];
  for (const tick of [0, 25, 50, 75, 100]) {
    const yy = y + tick / 100 * height;
    commands.push(line(x, yy, x + width, yy, 0.25, "2 3"));
    commands.push(text(x + 3, yy + 3, 6, String(tick)));
  }
  const denominator = Math.max(1, result.points.length - 1);
  const drawSeries = (values: (number | null)[], widthPt: number, dash?: string) => {
    let segment: { x: number; y: number }[] = [];
    const flush = () => {
      if (segment.length > 1) {
        const first = segment[0];
        let path = `${widthPt.toFixed(2)} w ${dash ? `[${dash}] 0 d` : "[] 0 d"} ${first.x.toFixed(2)} ${first.y.toFixed(2)} m`;
        for (const point of segment.slice(1)) path += ` ${point.x.toFixed(2)} ${point.y.toFixed(2)} l`;
        commands.push(`${path} S`);
      }
      segment = [];
    };
    values.forEach((value, index) => {
      if (value === null) { flush(); return; }
      segment.push({ x: x + index / denominator * width, y: y + value / 100 * height });
    });
    flush();
  };
  drawSeries(result.points.map((point) => point.group.rawTotal ?? point.group.total), 2.4);
  const memberIds = Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId))));
  const dashes = ["4 3", "8 3", "2 2", "10 3 2 3", "6 2 1 2", "1 2"];
  memberIds.forEach((memberId, index) => {
    drawSeries(result.points.map((point) => point.members.find((member) => member.memberId === memberId)?.total ?? null), 0.8, dashes[index % dashes.length]);
  });
  return commands;
}

function mapCommands(result: EventRecomputeResult, x: number, y: number, width: number, height: number) {
  const nav = result.points.flatMap((point) => point.navigation).filter((item) => item.latitude !== null && item.longitude !== null);
  const commands = [rect(x, y, width, height, 0.8)];
  if (!nav.length) {
    commands.push(text(x + 8, y + height / 2, 8, "No WGS84 navigation evidence for this event"));
    return commands;
  }
  const lats = nav.map((item) => item.latitude as number);
  const lons = nav.map((item) => item.longitude as number);
  const minLat0 = Math.min(...lats); const maxLat0 = Math.max(...lats);
  const minLon0 = Math.min(...lons); const maxLon0 = Math.max(...lons);
  const latSpan = Math.max(maxLat0 - minLat0, 0.0002);
  const lonSpan = Math.max(maxLon0 - minLon0, 0.0002);
  const minLat = minLat0 - latSpan * 0.06; const maxLat = maxLat0 + latSpan * 0.06;
  const minLon = minLon0 - lonSpan * 0.06; const maxLon = maxLon0 + lonSpan * 0.06;
  const project = (latitude: number, longitude: number) => ({
    x: x + (longitude - minLon) / (maxLon - minLon) * width,
    y: y + (latitude - minLat) / (maxLat - minLat) * height,
  });
  const memberIds = Array.from(new Set(nav.map((item) => item.memberId)));
  const dashes = [undefined, "5 3", "2 2", "8 3 2 3", "6 2 1 2", "1 2"];
  memberIds.forEach((memberId, memberIndex) => {
    let segment: { x: number; y: number }[] = [];
    const flush = () => {
      if (segment.length > 1) {
        const first = segment[0];
        const dash = dashes[memberIndex % dashes.length];
        let path = `1.1 w ${dash ? `[${dash}] 0 d` : "[] 0 d"} ${first.x.toFixed(2)} ${first.y.toFixed(2)} m`;
        for (const point of segment.slice(1)) path += ` ${point.x.toFixed(2)} ${point.y.toFixed(2)} l`;
        commands.push(`${path} S`);
      }
      segment = [];
    };
    for (const frame of result.points) {
      const item = frame.navigation.find((row) => row.memberId === memberId);
      if (!item || item.latitude === null || item.longitude === null) { flush(); continue; }
      segment.push(project(item.latitude, item.longitude));
    }
    flush();
  });
  commands.push(text(x + 5, y + height - 10, 6, `WGS84 ${minLat.toFixed(5)}..${maxLat.toFixed(5)} / ${minLon.toFixed(5)}..${maxLon.toFixed(5)}`));
  return commands;
}

function eventMainPage(item: InvestigationPdfEvent, index: number, reportSource?: InvestigationPdfReport["source"]): PdfPage {
  const result = item.result;
  const lines = [
    text(42, 800, 18, `Event ${index + 1}: ${result.eventId}`, true),
    text(42, 778, 9, `Group ${result.groupId} | Server ${result.serverId} | Arena ${item.arena ? ascii(item.arena) : "not assigned"}`),
    text(42, 760, 9, `${result.startAt} -> ${result.endAt} | frames ${result.frameCount} | scored ${result.scoredFrameCount} | missing ${result.missingFrameCount}`),
    text(42, 742, 9, `Template ${result.templateId} | template version ${result.templateVersion}`),
    text(42, 724, 9, `Code ${result.codeVersion} | config ${result.configVersion} | run ${result.runId}`),
    text(42, 696, 11, `Scores: sync ${score(result.summary.sync)} | route ${score(result.summary.route)} | total ${score(result.summary.total)}`, true),
    text(42, 670, 10, `Root causes: ${result.rootCauses.length} | Vehicle detail rows: ${Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId)))).length}`, true),
  ];
  if (item.note) lines.push(text(300, 670, 8, `Investigation note: ${ascii(item.note).slice(0, 70)}`));

  lines.push(text(42, 620, 10, "Navigation map", true));
  lines.push(...mapCommands(result, 42, 390, 235, 215));
  lines.push(text(318, 620, 10, "Group + every vehicle total score timeline", true));
  lines.push(...timelineCommands(result, 318, 390, 235, 215));
  lines.push(text(42, 362, 8, "All vehicle series are rendered; missing frames break the line instead of connecting across gaps."));
  lines.push(text(42, 342, 8, "Full root-cause and vehicle score tables continue on the following detail page(s)."));
  lines.push(text(42, 68, 7, `Navigation provenance: ${investigationEventSourceLabel(result, reportSource)}`));
  lines.push(text(42, 52, 7, "Truth source: Blue Wolf Core event archive. Map uses captured WGS84 samples; gaps are not interpolated for display."));
  return { content: pageContent(lines) };
}

function eventDetailLines(item: InvestigationPdfEvent, reportSource?: InvestigationPdfReport["source"]) {
  const result = item.result;
  const rows: string[] = [];
  rows.push(`EVENT ${result.eventId}`);
  rows.push(`TEMPLATE ${result.templateId} | VERSION ${result.templateVersion}`);
  rows.push(`CODE ${result.codeVersion} | CONFIG ${result.configVersion} | RUN ${result.runId}`);
  rows.push(`NAVIGATION SOURCE ${investigationEventSourceLabel(result, reportSource)}`);
  rows.push("ROOT CAUSES");
  if (!result.rootCauses.length) rows.push("  none");
  for (const cause of result.rootCauses) rows.push(`  ${cause.reason}: ${cause.occurrences}`);
  rows.push("VEHICLE SCORES AT LAST SCOREABLE FRAME");
  const lastScored = [...result.points].reverse().find((point) => point.members.length > 0);
  if (!lastScored) rows.push("  no scoreable vehicle frame");
  for (const member of lastScored?.members ?? []) {
    rows.push(`  ${member.memberId} | slot ${member.slotId} | sync ${score(member.sync)} | route ${score(member.route)} | total ${score(member.total)} | reason ${member.primaryReason || "none"}`);
  }
  rows.push("MEMBERS SEEN IN NAVIGATION EVIDENCE");
  const navigationMembers = Array.from(new Map(
    result.points.flatMap((point) => point.navigation).map((nav) => [nav.memberId, nav] as const),
  ).values());
  if (!navigationMembers.length) rows.push("  no navigation evidence");
  for (const nav of navigationMembers) {
    rows.push(`  ${nav.memberId} | vehicle ${nav.vehicleIdentifier} | reliability ${nav.reliability.toFixed(3)} | active ${String(nav.active)}`);
  }
  return rows;
}

function eventDetailPages(item: InvestigationPdfEvent, index: number, reportSource?: InvestigationPdfReport["source"]): PdfPage[] {
  const rows = eventDetailLines(item, reportSource);
  const rowsPerPage = 45;
  const pages: PdfPage[] = [];
  for (let offset = 0; offset < rows.length; offset += rowsPerPage) {
    const chunk = rows.slice(offset, offset + rowsPerPage);
    const pageNumber = Math.floor(offset / rowsPerPage) + 1;
    const lines = [
      text(42, 800, 15, `Event ${index + 1} details - page ${pageNumber}`, true),
      line(42, 784, 553, 784, 0.8),
    ];
    let y = 760;
    for (const row of chunk) {
      const isHeading = row === "ROOT CAUSES" || row === "VEHICLE SCORES AT LAST SCOREABLE FRAME" || row === "MEMBERS SEEN IN NAVIGATION EVIDENCE" || row.startsWith("EVENT ");
      lines.push(text(42, y, isHeading ? 9 : 7.5, row, isHeading));
      y -= 15.5;
    }
    lines.push(text(42, 52, 7, `Detail rows ${offset + 1}-${offset + chunk.length} of ${rows.length}; no rows are silently truncated.`));
    pages.push({ content: pageContent(lines) });
  }
  return pages;
}

function eventPages(item: InvestigationPdfEvent, index: number, reportSource?: InvestigationPdfReport["source"]): PdfPage[] {
  return [eventMainPage(item, index, reportSource), ...eventDetailPages(item, index, reportSource)];
}

function buildPdfObjects(pages: PdfPage[]) {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  for (let index = 0; index < pages.length; index += 1) {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    const body = pages[index].content;
    objects.push(`<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`);
  }
  return objects;
}

export function buildInvestigationPdf(report: InvestigationPdfReport): Uint8Array {
  if (!Number.isInteger(report.serverId) || report.serverId < 0) throw new Error("serverId must be a non-negative integer");
  if (!report.events.length) throw new Error("report requires at least one event");
  const pages = [coverPage(report), ...report.events.flatMap((item, index) => eventPages(item, index, report.source))];
  const objects = buildPdfObjects(pages);
  let output = "%PDF-1.4\n%BlueWolf\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(output, "latin1"));
}
