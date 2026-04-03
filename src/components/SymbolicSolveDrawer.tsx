import { useState, useCallback, useMemo } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/store/debugStore";
import { useDrawerActions } from "@/hooks/useDrawerActions";
import { Plus, Trash2, Play, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import {
  symbolicSolve,
  patchCalldataWithResults,
  fmtSymInputValue,
  type SymConfig,
  type SymGoal,
  type SolverResult,
  type SymInput,
} from "@/lib/symbolic";

interface SymVar {
  id: string;
  offset: string; // 用户填写的十进制或十六进制偏移
  name: string;   // 变量名（如 amount, recipient）
}

export function SymbolicSolveDrawer() {
  const isOpen = useDebugStore((s) => s.isSymbolicSolveOpen);
  const { closeSymbolicSolve } = useDrawerActions();
  const sessionId = useDebugStore((s) => s.sessionId);
  const currentStepIndex = useDebugStore((s) => s.currentStepIndex);
  const txData = useDebugStore((s) => s.txData);
  const txSlots = useDebugStore((s) => s.txSlots);
  const txDataList = useDebugStore((s) => s.txDataList);
  const txBoundaries = useDebugStore((s) => s.txBoundaries);

  const [calldataHex, setCalldataHex] = useState(
    () => txData?.data ?? ""
  );
  const [symVars, setSymVars] = useState<SymVar[]>([
    { id: "v0", offset: "4", name: "cd_4" },
  ]);
  const [targetStep, setTargetStep] = useState(() => String(currentStepIndex >= 0 ? currentStepIndex : ""));
  const [goal, setGoal] = useState<"TakeJump" | "SkipJump">("TakeJump");
  const [z3Path, setZ3Path] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [result, setResult] = useState<SolverResult | null>(null);
  const [solving, setSolving] = useState(false);
  const [patched, setPatched] = useState<string | null>(null);
  const [solvedTxIndex, setSolvedTxIndex] = useState<number | null>(null);

  const addVar = useCallback(() => {
    setSymVars((vs) => [
      ...vs,
      { id: `v${Date.now()}`, offset: "", name: "" },
    ]);
  }, []);

  const removeVar = useCallback((id: string) => {
    setSymVars((vs) => vs.filter((v) => v.id !== id));
  }, []);

  const updateVar = useCallback((id: string, field: keyof Omit<SymVar, "id">, val: string) => {
    setSymVars((vs) => vs.map((v) => (v.id === id ? { ...v, [field]: val } : v)));
  }, []);

  const parseOffset = (s: string): number | null => {
    const trim = s.trim();
    try {
      const n = trim.startsWith("0x") || trim.startsWith("0X")
        ? parseInt(trim, 16)
        : parseInt(trim, 10);
      return isNaN(n) || n < 0 ? null : n;
    } catch {
      return null;
    }
  };

  const txIndexForStep = useCallback((step: number): number => {
    if (!txBoundaries?.length) return 0;
    let idx = 0;
    for (let i = 0; i < txBoundaries.length; i++) {
      if (step >= txBoundaries[i]) idx = i + 1;
    }
    return idx;
  }, [txBoundaries]);

  const targetTxIndex = useMemo(() => {
    const step = parseInt(targetStep.trim(), 10);
    if (isNaN(step) || step < 0) return null;
    return txIndexForStep(step);
  }, [targetStep, txIndexForStep]);

  const solve = useCallback(async () => {
    // 验证
    const step = parseInt(targetStep.trim(), 10);
    if (isNaN(step) || step < 0) {
      toast.error("请填写有效的目标步骤（全局 step 索引）");
      return;
    }
    const rawCalldata = calldataHex.trim() || "0x";
    const symbols: [number, string][] = [];
    for (const v of symVars) {
      const off = parseOffset(v.offset);
      if (off === null) {
        toast.error(`变量 "${v.name}" 的偏移无效`);
        return;
      }
      const name = v.name.trim() || `cd_${off}`;
      symbols.push([off, name]);
    }
    if (symbols.length === 0) {
      toast.error("请至少添加一个符号变量");
      return;
    }

    const symConfig: SymConfig = { calldata_symbols: symbols };
    const symGoal: SymGoal = { type: goal };

    const calldataByTx: [number, string][] = [];
    for (let i = 0; i < txSlots.length; i++) {
      const data = txSlots[i]?.txData?.data;
      if (typeof data === "string" && data.trim().length > 0) {
        calldataByTx.push([i, data]);
      }
    }
    if (calldataByTx.length === 0) {
      for (let i = 0; i < txDataList.length; i++) {
        const data = txDataList[i]?.data;
        if (typeof data === "string" && data.trim().length > 0) {
          calldataByTx.push([i, data]);
        }
      }
    }

    setSolving(true);
    setResult(null);
    setPatched(null);
    setSolvedTxIndex(null);
    try {
      const res = await symbolicSolve({
        calldata_hex: rawCalldata,
        calldata_by_tx: calldataByTx.length > 0 ? calldataByTx : undefined,
        sym_config: symConfig,
        target_step: step,
        goal: symGoal,
        z3_path: z3Path.trim() || null,
        session_id: sessionId,
      });
      setResult(res);
      if ("target_transaction_id" in res && typeof res.target_transaction_id === "number") {
        setSolvedTxIndex(res.target_transaction_id);
      }
      if (res.status === "Sat") {
        const solvedTx = res.target_transaction_id;
        const txCalldata = calldataByTx.find(([txId]) => txId === solvedTx)?.[1] ?? rawCalldata;
        const patchedHex = patchCalldataWithResults(txCalldata, res.inputs);
        setPatched(patchedHex);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({ status: "Error", message: msg });
    } finally {
      setSolving(false);
    }
  }, [calldataHex, symVars, targetStep, goal, z3Path, sessionId, txSlots, txDataList]);

  const copyPatched = useCallback(() => {
    if (!patched) return;
    navigator.clipboard.writeText(patched).then(() => toast.success("已复制修改后的 calldata"));
  }, [patched]);

  return (
    <Sheet open={isOpen} onOpenChange={(o) => !o && closeSymbolicSolve()}>
      <SheetContent side="right" className="w-[480px] max-w-full flex flex-col gap-0 p-0">
        <SheetTitle className="px-4 py-3 border-b text-sm font-semibold flex items-center gap-2">
          <span>符号求解 (Z3)</span>
          <span className="text-xs text-muted-foreground font-normal ml-auto" title="EXP/KECCAK 等操作用无解释函数（UF）近似，约束只取 target 步骤之前的 prefix，结果可能与真实 EVM 有偏差">
            近似求解模式 ⓘ
          </span>
        </SheetTitle>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

          {/* Calldata */}
          <section className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">原始 Calldata（十六进制）</label>
            <Input
              value={calldataHex}
              onChange={(e) => setCalldataHex(e.target.value)}
              placeholder="0xa9059cbb..."
              className="font-mono text-xs h-7"
              spellCheck={false}
            />
          </section>

          {/* 符号变量 */}
          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-muted-foreground font-medium">符号变量（CALLDATALOAD 偏移）</label>
              <Button variant="ghost" size="sm" className="h-5 px-1.5 text-xs gap-1" onClick={addVar}>
                <Plus className="h-3 w-3" /> 添加
              </Button>
            </div>
            <div className="space-y-1">
              {symVars.map((v) => (
                <div key={v.id} className="flex items-center gap-1.5">
                  <Input
                    value={v.offset}
                    onChange={(e) => updateVar(v.id, "offset", e.target.value)}
                    placeholder="偏移 (如 4)"
                    className="font-mono text-xs h-6 w-20 shrink-0"
                    title="CALLDATALOAD 字节偏移，如 4 表示第二个 word（跳过 selector）"
                  />
                  <span className="text-xs text-muted-foreground shrink-0">→</span>
                  <Input
                    value={v.name}
                    onChange={(e) => updateVar(v.id, "name", e.target.value)}
                    placeholder="变量名"
                    className="text-xs h-6 flex-1"
                    title="变量名，可随意填写，用于结果中识别"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => removeVar(v.id)}
                    disabled={symVars.length <= 1}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          {/* 目标步骤 + 目标 */}
          <section className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground font-medium">目标 JUMPI 步骤</label>
                  {targetTxIndex != null && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Tx {targetTxIndex + 1}
                    </span>
                  )}
                </div>
                <Input
                  value={targetStep}
                  onChange={(e) => setTargetStep(e.target.value)}
                  placeholder={`当前: ${currentStepIndex}`}
                  className="font-mono text-xs h-7"
                  title="目标 JUMPI 的全局 step 索引（在 OpcodeViewer 里右键 JUMPI 行可查看）"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">目标</label>
                <div className="flex gap-1.5">
                  {(["TakeJump", "SkipJump"] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGoal(g)}
                      className={`h-7 px-2 rounded text-xs border transition-colors ${
                        goal === g
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-transparent border-border text-muted-foreground hover:border-foreground"
                      }`}
                    >
                      {g === "TakeJump" ? "跳转" : "不跳"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 高级选项（Z3 路径） */}
          <section>
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              高级选项
            </button>
            {showAdvanced && (
              <div className="mt-2 space-y-1">
                <label className="text-xs text-muted-foreground">Z3 可执行路径（留空使用 PATH）</label>
                <Input
                  value={z3Path}
                  onChange={(e) => setZ3Path(e.target.value)}
                  placeholder="/usr/local/bin/z3"
                  className="font-mono text-xs h-7"
                />
              </div>
            )}
          </section>

          {/* 求解按钮 */}
          <Button
            onClick={solve}
            disabled={solving}
            className="w-full h-8 gap-2 text-xs"
          >
            <Play className="h-3.5 w-3.5" />
            {solving ? "求解中…" : "调用 Z3 求解"}
          </Button>

          {/* 结果区 */}
          {result && (
            <ResultPanel
              result={result}
              patched={patched}
              solvedTxIndex={solvedTxIndex}
              onCopyPatched={copyPatched}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ResultPanel({
  result,
  patched,
  solvedTxIndex,
  onCopyPatched,
}: {
  result: SolverResult;
  patched: string | null;
  solvedTxIndex: number | null;
  onCopyPatched: () => void;
}) {
  if (result.status === "Unsat") {
    return (
      <div className="rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">
        <p className="font-semibold">UNSAT — 不可满足</p>
        <p className="mt-0.5 text-muted-foreground">约束矛盾，不存在满足条件的 calldata 输入。</p>
      </div>
    );
  }

  if (result.status === "Unknown") {
    return (
      <div className="rounded border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
        <p className="font-semibold">UNKNOWN — Z3 无法确定</p>
        <p className="mt-0.5 text-muted-foreground">{result.reason}</p>
      </div>
    );
  }

  if (result.status === "Error") {
    return (
      <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        <p className="font-semibold">错误</p>
        <p className="mt-0.5 break-all">{result.message}</p>
        {result.message.includes("Z3") && (
          <p className="mt-1 text-muted-foreground">
            提示：确保已安装 Z3（<code>brew install z3</code> 或官网下载），且在 PATH 中可访问。
          </p>
        )}
      </div>
    );
  }

  // SAT
  return (
    <div className="space-y-3">
      <div className="rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
        <p className="font-semibold">SAT — 找到满足条件的输入！</p>
        {solvedTxIndex != null && (
          <p className="mt-0.5 text-muted-foreground">目标交易: Tx {solvedTxIndex + 1}</p>
        )}
      </div>

      {/* 变量赋值表 */}
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground font-medium">求解结果</p>
        <div className="rounded border divide-y text-xs font-mono">
          {result.inputs.map((inp) => (
            <InputRow key={inp.name} inp={inp} />
          ))}
          {result.inputs.length === 0 && (
            <p className="px-3 py-2 text-muted-foreground">（无符号变量参与约束）</p>
          )}
        </div>
      </div>

      {/* 修改后的 calldata */}
      {patched && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground font-medium">修改后的 Calldata</p>
          <div className="flex items-start gap-2">
            <div className="flex-1 rounded border bg-muted px-2 py-1.5 text-xs font-mono break-all select-all leading-relaxed">
              {patched}
            </div>
            <Button variant="outline" size="sm" className="h-7 px-2 shrink-0" onClick={onCopyPatched} title="复制">
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            可将此 calldata 粘贴到 Fork 模式的 What-if 窗口进行验证。
          </p>
        </div>
      )}
    </div>
  );
}

function InputRow({ inp }: { inp: SymInput }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(inp.value_hex).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50">
      <span className="text-muted-foreground w-20 shrink-0 truncate" title={inp.name}>
        {inp.name}
      </span>
      {inp.calldata_offset != null && (
        <span className="text-muted-foreground shrink-0 text-[10px]">
          @{inp.calldata_offset}
        </span>
      )}
      <span className="flex-1 truncate text-foreground" title={inp.value_hex}>
        {fmtSymInputValue(inp)}
      </span>
      <button
        onClick={copy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors text-[10px]"
        title="复制完整 hex"
      >
        {copied ? "✓" : "copy"}
      </button>
    </div>
  );
}
