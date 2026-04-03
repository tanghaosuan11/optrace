import type { CallFrame } from "@/lib/types";
import { useDebugStore } from "@/store/debugStore";

export function syncFrameProjectionToStore(frame: CallFrame, stepIndex: number) {
  const logs = frame.logs;
  let logEnd = logs.length;
  if (logs.length > 0 && logs[logs.length - 1].stepIndex > stepIndex) {
    let lo = 0;
    let hi = logs.length - 1;
    logEnd = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (logs[mid].stepIndex <= stepIndex) {
        logEnd = mid + 1;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
  }

  const rdList = frame.returnDataList ?? [];
  let returnData = "";
  for (let i = rdList.length - 1; i >= 0; i--) {
    if (rdList[i].stepIndex <= stepIndex) {
      returnData = rdList[i].data;
      break;
    }
  }

  const { breakpointPcsMap } = useDebugStore.getState();
  useDebugStore.getState().sync({
    opcodes: frame.opcodes,
    stack: frame.stack,
    memory: frame.memory,
    currentPc: frame.currentPc ?? -1,
    currentGasCost: frame.currentGasCost ?? 0,
    storageChanges: frame.storageChanges,
    logs: logs.slice(0, logEnd),
    returnData,
    returnError: "",
    stateDiffs: [],
    currentStepIndex: stepIndex,
    breakpointPcs: breakpointPcsMap.get(frame.id) || new Set(),
    callType: frame.callType,
    callerAddress: frame.caller,
  });
}
