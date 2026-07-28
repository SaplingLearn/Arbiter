import { useAppState, useDispatch, type Region } from "../../state/store.js";
import { CaseHeader } from "./CaseHeader.js";
import { EvidencePanel } from "./EvidencePanel.js";
import { TracePanel } from "./TracePanel.js";
import { TablePanel } from "./TablePanel.js";
import "./case.css";

export function CaseTab() {
  const { tour } = useAppState();
  const dispatch = useDispatch();
  const focus = tour.focus;
  const toggle = (r: Region) => dispatch({ type: "setFocus", focus: focus === r ? null : r });

  return (
    <section>
      <CaseHeader />
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className="case-region"><EvidencePanel collapsed={focus !== null && focus !== "evidence"} onExpand={() => toggle("evidence")} /></div>
        <div className="case-region"><TracePanel collapsed={focus !== null && focus !== "trace"} onExpand={() => toggle("trace")} /></div>
        <div className="case-region"><TablePanel collapsed={focus !== null && focus !== "table"} onExpand={() => toggle("table")} /></div>
      </div>
    </section>
  );
}
