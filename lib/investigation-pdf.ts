import type { EventRecomputeResult } from "@/lib/investigation-contract";

export type InvestigationPdfEvent = {
  result: EventRecomputeResult;
  arena?: string | null;
  note?: string | null;
};

export type InvestigationPdfReport = {
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
  if (report.events.length > 20) lines.push(text(48, y, 9, `... ${report.events.length - 20} more events`));
  lines.push(text(48, 58, 8, "Source: immutable Core event archive + real template recomputation. No demo values."));
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
  drawSeries(result.points.map((point) => point.group.total), 2.4);
  const memberIds = Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId))));
  const dashes = ["4 3", "8 3", "2 2", "10 3 2 3"];
  memberIds.slice(0, 4).forEach((memberId, index) => {
    drawSeries(result.points.map((point) => point.members.find((member) => member.memberId === memberId)?.total ?? null), 0.9, dashes[index % dashes.length]);
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
  const dashes = [undefined, "5 3", "2 2", "8 3 2 3"];
  memberIds.slice(0, 8).forEach((memberId, memberIndex) => {
    let segment: { x: number; y: number }[] = [];
    const flush = () => {
      if (segment.length > 1) {
        const first = segment[0];
        let path = `1.2 w ${dashes[memberIndex % dashes.length] ? `[${dashes[memberIndex % dashes.length]}] 0 d` : "[] 0 d"} ${first.x.toFixed(2)} ${first.y.toFixed(2)} m`;
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

function eventPage(item: InvestigationPdfEvent, index: number): PdfPage {
  const result = item.result;
  const lines = [
    text(42, 800, 18, `Event ${index + 1}: ${result.eventId}`, true),
    text(42, 778, 9, `Group ${result.groupId} | Server ${result.serverId} | Arena ${item.arena ? ascii(item.arena) : "not assigned"}`),
    text(42, 760, 9, `${result.startAt} -> ${result.endAt} | frames ${result.frameCount} | scored ${result.scoredFrameCount} | missing ${result.missingFrameCount}`),
    text(42, 742, 9, `Template ${result.templateId} | template version ${result.templateVersion}`),
    text(42, 724, 9, `Code ${result.codeVersion} | config ${result.configVersion} | run ${result.runId}`),
    text(42, 696, 11, `Scores: sync ${score(result.summary.sync)} | route ${score(result.summary.route)} | total ${score(result.summary.total)}`, true),
    text(42, 670, 10, "Root causes", true),
  ];
  let rootY = 654;
  if (result.rootCauses.length === 0) lines.push(text(42, rootY, 8, "No primary root causes in this recomputation"));
  for (const cause of result.rootCauses.slice(0, 6)) {
    lines.push(text(42, rootY, 8, `${cause.reason}: ${cause.occurrences}`));
    rootY -= 14;
  }
  if (item.note) lines.push(text(300, 670, 8, `Investigation note: ${ascii(item.note).slice(0, 70)}`));

  lines.push(text(42, 510, 10, "Navigation map", true));
  lines.push(...mapCommands(result, 42, 310, 235, 185));
  lines.push(text(318, 510, 10, "Group + vehicle total score timeline", true));
  lines.push(...timelineCommands(result, 318, 310, 235, 185));

  const lastScored = [...result.points].reverse().find((point) => point.members.length > 0);
  lines.push(text(42, 282, 10, "Vehicle scores at last scoreable frame", true));
  let vehicleY = 264;
  if (!lastScored) lines.push(text(42, vehicleY, 8, "No scoreable vehicle frame"));
  for (const member of (lastScored?.members ?? []).slice(0, 12)) {
    lines.push(text(42, vehicleY, 8, `${member.memberId} | slot ${member.slotId} | sync ${score(member.sync)} | route ${score(member.route)} | total ${score(member.total)} | reason ${member.primaryReason || "none"}`));
    vehicleY -= 13;
  }
  lines.push(text(42, 52, 7, "Truth source: Blue Wolf Core event archive. Map uses captured WGS84 samples; gaps are not interpolated for display."));
  return { content: pageContent(lines) };
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
  const pages = [coverPage(report), ...report.events.map(eventPage)];
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
