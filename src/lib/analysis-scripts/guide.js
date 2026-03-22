// ============================================================
//  OpTrace Analysis Script Guide
//  This file is documentation only — it is not executable.
// ============================================================
//
// Each script is plain JavaScript. Two global variables are
// injected before your script runs:
//
//   trace  — array of step objects (see "Step Object" below)
//   steps  — alias for trace
//
// The script's return value (last expression) is displayed as
// the result. Return an array or object for best readability.
//
// ── Step Object ─────────────────────────────────────────────
//
//   stepIndex    {number}   global step index (click to jump)
//   index        {number}   same as stepIndex (legacy alias)
//   contextId    {number}   call frame ID
//   frameStep    {number}   step counter within the frame
//   pc           {number}   program counter
//   opcode       {string}   opcode name, e.g. "SSTORE"
//   opcodeNum    {number}   opcode byte value
//   opcodeHex    {string}   opcode as hex, e.g. "0x55"
//   gasCost      {number}   gas consumed by this step
//   gasRemaining {number}   gas left after this step
//   contract     {string}   bytecode address (hex, 0x-prefixed)
//   target       {string}   call target address (hex, 0x-prefixed)
//   stack        {string[]} stack items as 0x-prefixed hex (top = last)
//
// ── Built-in Helpers ────────────────────────────────────────
//
//   hexToNumber(hex)
//     Convert a 0x-prefixed hex string to a JS number.
//     Example: hexToNumber("0x1e") === 30
//
//   readMemory(stepOrIndex, offset, size)
//     Read a slice of memory at the given step.
//     - stepOrIndex: a step object or a global stepIndex number
//     - offset, size: byte offset and byte length
//     Returns a 0x-prefixed hex string.
//     Example: readMemory(s, 0, 32)
//
// ── Pre-execution Filters (@filter directives) ──────────────
//
// Write filter directives as comments at the top of the script.
// The backend applies them before injecting steps into JS,
// which significantly reduces memory and execution time for
// large transactions.
//
// Supported directives:
//
//   // @filter opcodes:  SSTORE, SLOAD
//     Only include steps whose opcode matches any in the list.
//     Accepts opcode names or hex values (e.g. 0x55).
//
//   // @filter contract: 0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
//     Only include steps where the executing contract address
//     matches (case-insensitive). Useful for focusing on one
//     specific contract in a multi-contract transaction.
//
//   // @filter target:   0x1234...
//     Only include steps where the call target matches.
//
//   // @filter frames:   1, 5, 10
//     Only include steps belonging to the listed frame IDs
//     (contextId values). Use the Call Tree to find frame IDs.
//
//   // @filter steps:    100000-200000
//     Only include steps whose global index is within [from, to]
//     (inclusive). Useful for narrowing down a long trace.
//     Separator can be a dash (-) or comma (,).
//
// Multiple directives can be combined; all conditions are AND-ed.
//
// Example:
//
//   // @filter opcodes:  SSTORE
//   // @filter contract: 0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48
//   // @filter steps:    0-500000
//
//   trace.map(s => ({
//     stepIndex: s.stepIndex,
//     slot:  s.stack[s.stack.length - 1],
//     value: s.stack[s.stack.length - 2],
//   }))
//
// ── Result Interactivity ────────────────────────────────────
//
// Any numeric value under the key "stepIndex" in the result
// is rendered as a clickable link. Clicking it seeks the
// debugger to that step.
//
// ── Keyboard Shortcuts ──────────────────────────────────────
//
//   Ctrl+Enter  Run the current script
//   Ctrl+S      Save the current script
//
// ── Tips ────────────────────────────────────────────────────
//
//   • For large transactions (700k+ steps), always use
//     @filter to reduce the injected step count.
//   • Access the stack top with: s.stack[s.stack.length - 1]
//   • Sort results: .sort((a, b) => b.gas - a.gas)
//   • Group by field: use a plain object as a map.
