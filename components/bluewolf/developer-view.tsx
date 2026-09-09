"use client";

import { useState } from "react";
import { Layers3, Settings2 } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DeveloperView as LegacyDeveloperView } from "./developer-view-legacy";
import { InfluxIdentityPanel } from "./influx-identity-panel";
import { TemplateBuilderV11 } from "./template-builder-v11";

type DeveloperRootTab = "tools" | "templates";

export function DeveloperView() {
  const [tab, setTab] = useState<DeveloperRootTab>("tools");
  return <div className="developer-restored-workspace">
    <Tabs value={tab} onValueChange={(value) => setTab(value as DeveloperRootTab)} dir="rtl">
      <div className="developer-restored-nav glass-panel">
        <div><p className="eyebrow">Developer Workspace · SRS v1.1</p><h2>תצורה, נתיבים, Influx ובדיקות</h2><p>הכלים המאושרים נשמרו; עורך התבניות הישן הוחלף ב־Quarter Builder בלי לשנות את שאר ה־UI.</p></div>
        <TabsList>
          <TabsTrigger value="tools"><Settings2 />כלי מפתחים</TabsTrigger>
          <TabsTrigger value="templates"><Layers3 />תבניות SI / SO</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="tools"><div className="developer-contract-panels"><InfluxIdentityPanel /></div><div className="developer-legacy-wrapper"><LegacyDeveloperView /></div></TabsContent>
      <TabsContent value="templates"><TemplateBuilderV11 /></TabsContent>
    </Tabs>
  </div>;
}
