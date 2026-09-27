/** Route-bank WKT uses WGS84 longitude/latitude, never screen percentages. */
export type GeoPoint = { longitude: number; latitude: number };
export type RouteGeometry = { kind: "LINESTRING" | "POLYGON"; points: GeoPoint[] };

export function parseRouteWkt(value: string): RouteGeometry {
  if (value.length > 100000) throw new Error("הנתיב ארוך מדי");
  const match = /^\s*(LINESTRING|POLYGON)\s*\(([\s\S]*)\)\s*$/i.exec(value);
  if (!match) throw new Error("נדרש LINESTRING סגור או POLYGON ללא חורים");
  const kind = match[1].toUpperCase() as RouteGeometry["kind"];
  let body = match[2].trim();
  if (kind === "POLYGON") {
    if (!body.startsWith("(") || !body.endsWith(")")) throw new Error("מבנה POLYGON אינו תקין");
    body = body.slice(1, -1);
  }
  if (/[()]/.test(body)) throw new Error("נתיב יחיד ללא חורים בלבד");
  const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const points = body.split(",").map(pair => {
    const fields = pair.trim().split(/\s+/);
    if (fields.length !== 2 || fields.some(field => !number.test(field))) throw new Error("כל נקודה דורשת קו אורך וקו רוחב");
    const [longitude, latitude] = fields.map(Number);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) throw new Error("קואורדינטות WGS84 מחוץ לתחום");
    return { longitude, latitude };
  });
  if (points.length < 4 || points.length > 4097) throw new Error("נדרשות 3 נקודות שונות לפחות ונקודת סגירה, עד 4096 מקטעים");
  const first = points[0], last = points[points.length - 1];
  if (first.longitude !== last.longitude || first.latitude !== last.latitude) throw new Error("הנתיב חייב להיסגר באותה נקודה");
  if (new Set(points.map(p => p.longitude + "," + p.latitude)).size < 3) throw new Error("הנתיב דורש לפחות 3 נקודות שונות");
  return { kind, points };
}
export function formatRouteWkt(geometry: RouteGeometry): string {
  const body = geometry.points.map(p => p.longitude + " " + p.latitude).join(", ");
  return geometry.kind === "POLYGON" ? "POLYGON ((" + body + "))" : "LINESTRING (" + body + ")";
}
export function translateRouteWkt(value: string, longitudeDelta: number, latitudeDelta: number): string {
  if (![longitudeDelta, latitudeDelta].every(Number.isFinite)) throw new Error("הזזה אינה תקינה");
  const geometry = parseRouteWkt(value);
  const moved = formatRouteWkt({ ...geometry, points: geometry.points.map(p => ({ longitude: p.longitude + longitudeDelta, latitude: p.latitude + latitudeDelta })) });
  parseRouteWkt(moved);
  return moved;
}
