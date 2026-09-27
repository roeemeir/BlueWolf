import type { InvestigationPdfEvent } from "@/lib/investigation-pdf";

/** Explanations are limited to documented lifecycle codes; all other codes
 * remain verbatim evidence, never guessed root causes. */
const KNOWN_LIFECYCLE: Record<string, { description: string; operatorMeaning: string }> = {
  group_became_active: {
    description: "הקבוצה הפכה לפעילה בנתוני האירוע",
    operatorMeaning: "זהו גבול פתיחה שנרשם על ידי המנוע; יש לבדוק את מסגרות הניווט הסמוכות לפתיחה.",
  },
  context_changed: {
    description: "המנוע רשם שינוי בהקשר האירוע",
    operatorMeaning: "זהו גבול שינוי שתועד במקור. יש לעיין בהקשר האירוע לפני ואחרי הגבול; סוג השינוי אינו נגזר מן הקוד לבדו.",
  },
  structural_group_ended: {
    description: "המנוע רשם סיום של הקבוצה המבנית",
    operatorMeaning: "בדוק את נתוני השיוך המבני ואת מסגרות הניווט סביב מועד הסיום. אין להסיק מן הקוד לבדו איזה רכב גרם לשינוי.",
  },
  group_inactive: {
    description: "המנוע רשם שהקבוצה אינה פעילה",
    operatorMeaning: "יש לבדוק את שדות הפעילות ואת איכות קליטת הרכבים בסמוך למועד האירוע; אין לייחס זאת לרכב מסוים ללא עדות.",
  },
};

export type RecordedReason = {
  label: string;
  operatorMeaning: string;
  provenance: "lifecycle-code" | "source-text" | "unmapped-source-code" | "missing";
};

export function recordedLifecycleReason(reason: string | null | undefined): RecordedReason {
  if (!reason) return {
    label: "לא נרשמה סיבה במקור",
    operatorMeaning: "לא ניתן לקבוע סיבת פתיחה או סיום מתוך הנתונים הזמינים.",
    provenance: "missing",
  };
  const known = KNOWN_LIFECYCLE[reason];
  if (known) return { label: known.description, operatorMeaning: known.operatorMeaning, provenance: "lifecycle-code" };
  if (/\p{Script=Hebrew}/u.test(reason)) return {
    label: reason,
    operatorMeaning: "זהו טקסט שנרשם במקור; אין להסיק ממנו פרטים נוספים שאינם מתועדים.",
    provenance: "source-text",
  };
  return {
    label: `קוד מקור לא ממופה: ${reason}`,
    operatorMeaning: "יש לבדוק את משמעות הקוד במקור האירוע; לא בוצע פענוח או ייחוס סיבה על בסיס שם הקוד.",
    provenance: "unmapped-source-code",
  };
}

export function investigationEventFacts(event: InvestigationPdfEvent) {
  const result = event.result;
  const memberIds = Array.from(new Set(result.points.flatMap((point) => point.members.map((member) => member.memberId)))).sort();
  // The last scoreable sample is selected separately for EACH observed member:
  // members absent from the last group frame are not silently dropped.
  const members = memberIds.map((memberId) => {
    const point = [...result.points].reverse().find((frame) => frame.members.some((member) => member.memberId === memberId));
    const score = point!.members.find((member) => member.memberId === memberId)!;
    return {
      memberId, observedAt: point!.observedAt, slotId: score.slotId,
      total: score.total, sync: score.sync, route: score.route,
      reason: score.primaryReason,
    };
  });
  return {
    eventId: result.eventId,
    groupId: result.groupId,
    startAt: result.startAt,
    endAt: result.endAt,
    opening: recordedLifecycleReason(result.lifecycle.openingReason),
    ending: recordedLifecycleReason(result.lifecycle.endingReason),
    scores: { ...result.summary },
    members,
    sourceReasons: result.rootCauses.map((cause) => ({ ...cause })),
    codeVersion: result.codeVersion,
    configVersion: result.configVersion,
    runId: result.runId,
  };
}
