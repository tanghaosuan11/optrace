import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebugStore } from "@/store/debugStore";
import { emptyTxListRow, type TxListRow } from "@/lib/txFetcher";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface MultiTxListEditorProps {
  readOnly: boolean;
}

const inputCls = "font-mono text-xs h-7 px-2 py-0 min-w-0";

export function MultiTxListEditor({ readOnly }: MultiTxListEditorProps) {
  const txDataList = useDebugStore((s) => s.txDataList);
  const sync = useDebugStore.getState().sync;

  const setRow = (index: number, patch: Partial<TxListRow>) => {
    const next = txDataList.map((r, i) => (i === index ? { ...r, ...patch } : r));
    sync({ txDataList: next });
  };

  const addRow = () => {
    sync({ txDataList: [...txDataList, emptyTxListRow()] });
  };

  const removeRow = (index: number) => {
    if (txDataList.length <= 1) return;
    sync({ txDataList: txDataList.filter((_, i) => i !== index) });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="space-y-1.5 shrink-0">
        {/* <p className="text-xs font-medium text-muted-foreground">Debug By Data</p> */}
        <p className="text-xs text-muted-foreground leading-snug">
          {/* 至少一笔有效 <span className="font-mono">from</span>；多笔顺序执行。 */}
        </p>
      </div>
      <div className="max-h-[min(58vh,460px)] overflow-y-auto pr-0.5 flex flex-col gap-5">
        {txDataList.map((row, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 min-w-0 rounded-md border border-dashed p-2.5",
              "border-muted-foreground/35 bg-muted/15",
              "dark:border-muted-foreground/25 dark:bg-muted/10",
            )}
          >
            <div className="flex shrink-0 flex-col items-center gap-1 self-start pt-0.5">
              <span className="text-[10px] font-medium tabular-nums leading-none text-muted-foreground">
                {i + 1}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                disabled={readOnly || txDataList.length <= 1}
                onClick={() => removeRow(i)}
                title="Remove"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex gap-2">
                <Input
                  className={`${inputCls} flex-1`}
                  placeholder="from (0x…)"
                  value={row.from}
                  onChange={(e) => setRow(i, { from: e.target.value })}
                  readOnly={readOnly}
                  spellCheck={false}
                />
                <Input
                  className={`${inputCls} flex-1`}
                  placeholder="to (0x… / Create)"
                  value={row.to}
                  onChange={(e) => setRow(i, { to: e.target.value })}
                  readOnly={readOnly}
                  spellCheck={false}
                />
              </div>
              <div className="flex gap-2">
                <Input
                  className={`${inputCls} flex-1`}
                  placeholder="value (wei)"
                  value={row.value}
                  onChange={(e) => setRow(i, { value: e.target.value })}
                  readOnly={readOnly}
                />
                <Input
                  className={`${inputCls} flex-1`}
                  placeholder="gasPrice"
                  value={row.gasPrice}
                  onChange={(e) => setRow(i, { gasPrice: e.target.value })}
                  readOnly={readOnly}
                  title="gas_price"
                />
                <Input
                  className={`${inputCls} flex-1`}
                  placeholder="gasLimit"
                  value={row.gasLimit}
                  onChange={(e) => setRow(i, { gasLimit: e.target.value })}
                  readOnly={readOnly}
                  title="gas_limit"
                />
              </div>
              <Input
                className={`${inputCls} w-full`}
                placeholder="data (hex)"
                value={row.data}
                onChange={(e) => setRow(i, { data: e.target.value })}
                readOnly={readOnly}
                spellCheck={false}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mt-6">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1 w-fit"
          disabled={readOnly}
          onClick={addRow}
        >
          <Plus className="size-3.5" />
          Add tx
        </Button>
      </div>
    </div>
  );
}
