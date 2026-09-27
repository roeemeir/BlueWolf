"use client";

import { Activity, Database, FlaskConical, Map, Route, Settings2, Shapes, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspace } from "./app-context";
import { DeveloperView } from "./developer-view";
import { GeneralSettingsWorkbench } from "./general-settings-workbench";
import { GtProvenanceBanner } from "./gt-provenance-banner";
import { GtScenarioWorkbench } from "./gt-scenario-workbench";
import { InfluxGovernanceWorkbench } from "./influx-governance-workbench";
import { MapSourceGovernanceWorkbench } from "./map-source-governance-workbench";
import { QaTruthWorkbench } from "./qa-truth-workbench";
import { RouteBankWktWorkbench } from "./route-bank-wkt-workbench";
import { SiTemplateGovernanceWorkbench } from "./si-template-governance-workbench";
import { SoTemplateGovernanceWorkbench } from "./so-template-governance-workbench";
import { WorkspaceRecoveryWorkbench } from "./workspace-recovery-workbench";

export function DeveloperGovernanceWorkbench() {
  const { revision } = useWorkspace();
  return <div className="developer-governance-tabs" dir="rtl" data-requirements="BW-DEV-001 BW-UI-014 BW-CR-20260919-015 BW-CR-20260919-016">
    <style>{`
      .developer-governance-tabs{padding:18px 24px 34px;max-width:1700px;margin:0 auto;min-width:0}
      .developer-primary-tabs>[data-slot="tabs-list"]{width:100%;height:auto;min-height:48px;padding:5px;display:flex;gap:4px;overflow-x:auto;justify-content:flex-start;border:1px solid var(--line);border-radius:16px;background:var(--surface-soft);scrollbar-width:thin}
      .developer-primary-tabs>[data-slot="tabs-list"]>[data-slot="tabs-trigger"]{min-width:max-content;gap:7px;padding-inline:14px}
      .developer-primary-tabs>[data-slot="tabs-content"]{margin-top:14px;min-width:0}
      .developer-template-tabs>[data-slot="tabs-list"]{display:inline-flex;width:auto;margin-bottom:12px;border:1px solid var(--line);border-radius:13px;background:var(--surface-soft)}
      .developer-template-tabs>[data-slot="tabs-list"]>[data-slot="tabs-trigger"]{min-width:120px;gap:7px}
      .developer-tab-intro{margin-bottom:12px;padding:14px 16px;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,var(--surface-strong),var(--surface));box-shadow:var(--shadow),inset 0 1px 0 var(--glass-edge)}
      .developer-tab-intro h2{margin:0;font-size:17px}.developer-tab-intro p{margin:5px 0 0;color:var(--text-soft);font-size:12px}
      /* Reuse the existing governed score/threshold editor without exposing the
         legacy fake QA runner or a second, competing vehicle settings editor. */
      .governed-score-only .developer-nav{display:none!important}
      .governed-score-only .developer-workspace{display:block!important;grid-template-columns:minmax(0,1fr)!important}
      .governed-score-only .developer-content{width:100%;max-width:none;min-width:0}
      @media(max-width:760px){.developer-governance-tabs{padding:10px}.developer-primary-tabs>[data-slot="tabs-list"]{border-radius:12px}.developer-primary-tabs>[data-slot="tabs-list"]>[data-slot="tabs-trigger"]{padding-inline:10px;min-height:44px}.developer-template-tabs>[data-slot="tabs-list"]{display:grid;grid-template-columns:1fr 1fr;width:100%}.developer-template-tabs>[data-slot="tabs-list"]>[data-slot="tabs-trigger"]{min-width:0}}
    `}</style>

    <Tabs defaultValue="templates" className="developer-primary-tabs">
      <TabsList aria-label="בחירת אזור במצב מפתחים">
        <TabsTrigger value="templates"><Shapes />תבניות</TabsTrigger>
        <TabsTrigger value="routes"><Route />בנק נתיבים</TabsTrigger>
        <TabsTrigger value="gt"><FlaskConical />GT ותרחישים</TabsTrigger>
        <TabsTrigger value="sources"><Database />מקורות נתונים</TabsTrigger>
        <TabsTrigger value="score"><Activity />ציון וספים</TabsTrigger>
        <TabsTrigger value="settings"><Settings2 />הגדרות כלליות</TabsTrigger>
        <TabsTrigger value="qa"><ShieldCheck />QA</TabsTrigger>
      </TabsList>

      <TabsContent value="templates">
        <div className="developer-tab-intro"><h2>עורך תבניות</h2><p>SI ו־SO מופרדים למשטחי עריכה עצמאיים כדי למנוע ערבוב חוקים, סוגי מיקום וסמנטיקה.</p></div>
        <Tabs defaultValue="si" className="developer-template-tabs">
          <TabsList aria-label="משפחת תבנית"><TabsTrigger value="si"><SlidersHorizontal />SI</TabsTrigger><TabsTrigger value="so"><Map />SO</TabsTrigger></TabsList>
          <TabsContent value="si"><SiTemplateGovernanceWorkbench /></TabsContent>
          <TabsContent value="so"><SoTemplateGovernanceWorkbench /></TabsContent>
        </Tabs>
      </TabsContent>

      <TabsContent value="routes"><RouteBankWktWorkbench key={`route-bank-${revision}`} /></TabsContent>
      <TabsContent value="gt"><GtProvenanceBanner /><GtScenarioWorkbench /></TabsContent>
      <TabsContent value="sources"><div className="developer-tab-intro"><h2>מקורות נתונים ומפות</h2><p>Influx וה־WMTS מנוהלים באותו אזור תשתיתי, בלי לערבב אותם עם עריכת תבניות ו־GT.</p></div><InfluxGovernanceWorkbench /><MapSourceGovernanceWorkbench /></TabsContent>
      <TabsContent value="score"><div className="governed-score-only"><DeveloperView /></div></TabsContent>
      <TabsContent value="settings"><GeneralSettingsWorkbench /><WorkspaceRecoveryWorkbench /></TabsContent>
      <TabsContent value="qa"><QaTruthWorkbench /></TabsContent>
    </Tabs>
  </div>;
}
