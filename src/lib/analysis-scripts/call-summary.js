// Call Summary
// List all external calls: CALL, STATICCALL, DELEGATECALL, CALLCODE.
// Click any stepIndex to jump to that step.
const CALL_OPS = ["CALL", "STATICCALL", "DELEGATECALL", "CALLCODE"];
trace
  .filter(s => CALL_OPS.includes(s.opcode))
  .map(s => {
    const stack = s.stack;
    const len = stack.length;
    // Stack layout: CALL — gas, addr, value, ...
    //               STATICCALL / DELEGATECALL — gas, addr, ...
    const gasArg = stack[len - 1];
    const addr = "0x" + (stack[len - 2] || "").slice(-40);
    return {
      stepIndex: s.stepIndex,
      contextId: s.contextId,
      opcode: s.opcode,
      pc: s.pc,
      target: addr,
      gasArg: hexToNumber(gasArg),
    };
  })
