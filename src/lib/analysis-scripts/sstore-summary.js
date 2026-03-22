// SSTORE Summary
// List all SSTORE operations with their storage slot and written value.
// Click any stepIndex to jump to that step.
// @filter opcodes: SSTORE
trace.map(s => ({
  stepIndex: s.stepIndex,
  contract: s.contract,
  contextId: s.contextId,
  pc: s.pc,
  slot:  s.stack[s.stack.length - 1],
  value: s.stack[s.stack.length - 2],
}))
