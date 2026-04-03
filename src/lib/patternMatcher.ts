/**
 * 函数调用模式识别器
 * 支持通配符匹配、指令合并、多模式查找
 */

export interface OpcodeMatch {
  opcode: string;
  arg?: string;
}

export interface MatchResult {
  pc: number[];
  matches: OpcodeMatch[][];
}

/**
 * 规范化指令字符串
 * 例如: "PUSH2 0x1234" -> "PUSH20x1234"
 * 也支持模式: "PUSH4 0x*" -> "PUSH40x*"
 * 也支持混合模式: "PUSH4 0xaa613b29*" -> "PUSH40xaa613b29*"
 */
export function normalizeInstruction(instruction: string): string {
  const normalized = instruction.trim().toUpperCase();
  // 合并 PUSHX 和参数（支持十六进制值、通配符、混合模式）
  const pushMatch = normalized.match(/^(PUSH\d+)\s+(0X[0-9A-F*]*)$/);
  if (pushMatch) {
    return pushMatch[1] + pushMatch[2];
  }
  return normalized;
}

/**
 * 检查十六进制字符串是否匹配通配符
 * "*" 表示任意十六进制字符，"*8" 表示任意 8 个十六进制字符
 * 也支持混合模式，如 "aa613b29*" 表示以 aa613b29 开头后跟任意多个十六进制字符
 */
function matchHexPattern(pattern: string, actual: string): boolean {
  let patternLower = pattern.toLowerCase();
  let actualLower = actual.toLowerCase();

  // 去掉 "0x" 前缀
  if (patternLower.startsWith("0x")) {
    patternLower = patternLower.slice(2);
  }
  if (actualLower.startsWith("0x")) {
    actualLower = actualLower.slice(2);
  }

  // 处理 "*8" 这种形式 - 精确长度的十六进制字符
  const countMatch = patternLower.match(/^\*(\d+)$/);
  if (countMatch) {
    const expectedLength = parseInt(countMatch[1], 10);
    return actualLower.match(/^[0-9a-f]*$/) !== null && actualLower.length === expectedLength;
  }

  // 处理单个 "*" - 匹配 0 个或多个十六进制字符
  if (patternLower === "*") {
    return actualLower.match(/^[0-9a-f]*$/) !== null;
  }

  // 处理混合通配符模式 - 转换为正则表达式
  // 例如: "aa613b29*" -> /^aa613b29[0-9a-f]*$/
  const regexPattern = patternLower
    .replace(/\*/g, "[0-9a-f]*")  // 将 * 替换为 [0-9a-f]*
    .replace(/\[0-9a-f\]\*(\d+)/g, "[0-9a-f]{$1}");  // 处理 *N 形式

  try {
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(actualLower);
  } catch {
    // 正则表达式构建失败时进行精确匹配
    return patternLower === actualLower;
  }
}

/**
 * 检查单条指令是否匹配模式
 */
function matchInstruction(pattern: string, instruction: string): boolean {
  const normalizedPattern = normalizeInstruction(pattern);
  const normalizedInstr = normalizeInstruction(instruction);

  // 对于 PUSH 指令，需要特殊处理参数提取
  // 例如: "PUSH40x*" 应该分解为 opcode="PUSH4", arg="0x*"
  let patternOp = "", patternArg = "";
  let instrOp = "", instrArg = "";

  const pushPatternMatch = normalizedPattern.match(/^(PUSH\d+)(0x.*)$/i);
  if (pushPatternMatch) {
    patternOp = pushPatternMatch[1];
    patternArg = pushPatternMatch[2];
  } else {
    const patternMatch = normalizedPattern.match(/^([A-Z]+)(.*)$/);
    if (patternMatch) {
      patternOp = patternMatch[1];
      patternArg = patternMatch[2];
    } else {
      return false;
    }
  }

  const pushInstrMatch = normalizedInstr.match(/^(PUSH\d+)(0x.*)$/i);
  if (pushInstrMatch) {
    instrOp = pushInstrMatch[1];
    instrArg = pushInstrMatch[2];
  } else {
    const instrMatch = normalizedInstr.match(/^([A-Z]+)(.*)$/);
    if (instrMatch) {
      instrOp = instrMatch[1];
      instrArg = instrMatch[2];
    } else {
      return false;
    }
  }

  // Opcode 必须精确匹配
  if (patternOp !== instrOp) return false;

  // 如果模式有参数，进行参数匹配
  if (patternArg) {
    if (!instrArg) return false;
    return matchHexPattern(patternArg, instrArg);
  }

  // 模式无参数，指令也不应有参数
  return instrArg === "";
}

/**
 * 查找模式匹配
 * @param opcodes 指令序列，每个元素格式为 "OPCODE" 或 "OPCODE arg"
 * @param patterns 模式序列
 * @param findAll 是否找所有匹配，false 则只找第一个匹配
 * @returns 匹配结果，包含 pc 位置和匹配的指令序列
 */
export function findPatternMatches(
  opcodes: string[],
  patterns: string[],
  findAll: boolean = false
): MatchResult {
  const results: MatchResult = { pc: [], matches: [] };

  if (patterns.length === 0) return results;

  for (let i = 0; i <= opcodes.length - patterns.length; i++) {
    let matched = true;
    const matchedOps: OpcodeMatch[] = [];

    // 检查从位置 i 开始是否能匹配整个模式
    for (let j = 0; j < patterns.length; j++) {
      const ok = matchInstruction(patterns[j], opcodes[i + j]);
      if (!ok) {
        console.log(`Pattern "${patterns[j]}" did not match instruction "${opcodes[i + j]}"`);
        matched = false;
        break;
      } else {
        console.log(`Pattern "${patterns[j]}" matched instruction "${opcodes[i + j]}"`);
      }

      // 记录匹配的指令
      const normalized = normalizeInstruction(opcodes[i + j]);
      const opMatch = normalized.match(/^([A-Z\d]+)(.*)$/);
      if (opMatch) {
        matchedOps.push({
          opcode: opMatch[1],
          arg: opMatch[2] || undefined,
        });
      }
    }

    if (matched) {
      results.pc.push(i);
      results.matches.push(matchedOps);

      if (!findAll) {
        break;
      }
    }
  }

  return results;
}

/**
 * 识别 CALL 函数调用模式
 * 模式: [PUSH4 0x*, EQ, PUSH2 0x*, JUMPI] 或 [PUSH4 {selector}*, EQ, PUSH2 0x*, JUMPI]
 * @param opcodes 指令序列
 * @param selector 可选的函数选择器（如 "0xaa613b29"），如果提供则只寻找匹配该选择器的模式
 * 代表: 检查函数选择器，如果匹配则跳转
 */
export function findCallPatterns(opcodes: string[], selector?: string): MatchResult {
  const selectorPattern = selector ? `PUSH4 ${selector}*` : "PUSH4 0x*";
  const pattern = [
    selectorPattern,    // 函数选择器（可选指定）
    "EQ",              // 比较
    "PUSH2 0x*",       // 跳转目标
    "JUMPI",           // 条件跳转
  ];

  return findPatternMatches(opcodes, pattern, true);
}

/**
 * 识别 INTERNAL CALL 模式
 * 模式: [PUSH2 0x*, JUMP]
 * 代表: 直接跳转到内部函数
 */
export function findInternalCallPatterns(opcodes: string[]): MatchResult {
  const pattern = [
    "PUSH2 0x*",    // 内部跳转目标
    "JUMP",         // 无条件跳转
  ];

  return findPatternMatches(opcodes, pattern, true);
}

/**
 * 识别 RETURN 模式
 * 模式: [PUSH1 0x*, PUSH1 0x*, RETURN]
 */
export function findReturnPatterns(opcodes: string[]): MatchResult {
  const pattern = [
    "PUSH1 0x*",
    "PUSH1 0x*",
    "RETURN",
  ];

  return findPatternMatches(opcodes, pattern, true);
}
