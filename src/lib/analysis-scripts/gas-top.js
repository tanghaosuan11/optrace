// Gas Cost Top 20
// Find the 20 steps with the highest gas cost, sorted descending.
// Click any stepIndex to jump to that step.
trace
  .sort((a, b) => b.gasCost - a.gasCost)
  .slice(0, 20)
  .map(s => ({ stepIndex: s.stepIndex, pc: s.pc, opcode: s.opcode, gas: s.gasCost, contract: s.contract }))
