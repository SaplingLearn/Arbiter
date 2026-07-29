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
  // A region is collapsed when some OTHER region holds the spotlight. The class
  // only trims the padding a 56px rail has no room for; the collapsing itself is
  // the [data-focus] grid transition in case.css.
  const collapsed = (r: Region) => focus !== null && focus !== r;
  const regionClass = (r: Region) => `case-region${collapsed(r) ? " is-rail" : ""}`;

  return (
    <section>
      <CaseHeader />
      <div className="case-grid" data-focus={focus ?? ""}>
        <div className={regionClass("evidence")}>
          <EvidencePanel collapsed={collapsed("evidence")} onExpand={() => toggle("evidence")} />
        </div>
        <div className={regionClass("trace")}>
          <TracePanel collapsed={collapsed("trace")} onExpand={() => toggle("trace")} />
        </div>
        <div className={regionClass("table")}>
          <TablePanel collapsed={collapsed("table")} onExpand={() => toggle("table")} />
        </div>
      </div>
    </section>
  );
}
