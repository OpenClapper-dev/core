// Port of components/phone/phone.card.html.
import { useState } from "preact/hooks";
import { ActionBar, BottomSheet, BottomTabs, CameraButton, CameraLayout, HeaderAction, List, ListRow, Screen, ScreenHeader, Shutter, TouchButton } from "@openclapper/design";
import { Pair } from "../../kit";

function Demo() {
  const [tab, setTab] = useState("a");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ height: 460, border: "1px solid var(--border-window)", borderRadius: 12, overflow: "hidden" }}>
        <Screen header={<ScreenHeader title="Screen title" onBack={() => {}} actions={<HeaderAction icon="more-vertical" label="More" />} />} footer={<BottomTabs value={tab} onChange={setTab} tabs={[{ id: "a", label: "List", icon: "list" }, { id: "b", label: "Camera", icon: "camera" }, { id: "c", label: "Form", icon: "edit" }]} />}>
          <List><ListRow size="touch" icon="pin" meta="1.2 km" chevron>Item one</ListRow><ListRow size="touch" icon="pin" meta="3.4 km" chevron selected>Item two</ListRow><ListRow size="touch" icon="pin" meta="5 km" chevron>Item three</ListRow></List>
          <BottomSheet title="Sheet" onClose={() => {}}><List><ListRow size="touch" icon="share">Share</ListRow><ListRow size="touch" icon="trash">Move to bin</ListRow></List></BottomSheet>
        </Screen>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ border: "1px solid var(--border-window)", borderRadius: 8, overflow: "hidden" }}><ActionBar><TouchButton>Cancel</TouchButton><TouchButton variant="primary" icon="check">Save</TouchButton></ActionBar></div>
        <div style={{ height: 240, borderRadius: 8, overflow: "hidden" }}><CameraLayout barA={<><CameraButton icon="close" label="Close" /><span className="oc-cam__readout">24 mm</span><CameraButton icon="grid" label="Grid" pressed /></>} barB={<><CameraButton icon="image" label="Last" /><Shutter /><CameraButton icon="lens" label="Lens" /></>}><span style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg,#6a6a6a,#262626 70%)" }} /></CameraLayout></div>
      </div>
    </div>
  );
}

export default function Card() { return <Pair Demo={Demo} />; }
