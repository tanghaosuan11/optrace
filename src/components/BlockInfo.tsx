import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowDownToLine, Loader2 } from "lucide-react";

interface BlockInfoProps {
  blockNumber?: bigint;
  timestamp?: bigint;
  gasLimit?: bigint;
  baseFeePerGas?: bigint;
  isLoading?: boolean;
  readOnly?: boolean;
  /** 无块数据时也展示可编辑表单（Debug By Data） */
  showEmpty?: boolean;
  onFieldChange?: (field: string, value: string) => void;
  /** 从 RPC 拉取 latest 块并写入表单（由父组件更新 store） */
  onFetchLatestBlock?: () => Promise<void>;
}

export function BlockInfo({
  blockNumber,
  timestamp,
  gasLimit,
  baseFeePerGas,
  isLoading,
  readOnly,
  showEmpty,
  onFieldChange,
  onFetchLatestBlock,
}: BlockInfoProps) {
  const [latestPending, setLatestPending] = useState(false);

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading block...</span>
        </div>
      </Card>
    );
  }

  const hasBlock = blockNumber !== undefined;
  if (!hasBlock && !showEmpty) {
    return (
      <Card className="p-6">
        <div className="text-center text-muted-foreground text-sm">
          Block info will appear here
        </div>
      </Card>
    );
  }

  const timeDisplay =
    timestamp !== undefined
      ? new Date(Number(timestamp) * 1000).toLocaleString()
      : "";

  const baseFeeDisplay =
    baseFeePerGas !== undefined
      ? (Number(baseFeePerGas) / 1e9).toFixed(2)
      : "";

  const handleLatestClick = async () => {
    if (!onFetchLatestBlock || readOnly) return;
    setLatestPending(true);
    try {
      await onFetchLatestBlock();
    } catch (e) {
      console.error("fetch latest block failed", e);
    } finally {
      setLatestPending(false);
    }
  };

  return (
    <Card className="p-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <h3 className="font-semibold text-sm">Block</h3>
          {onFetchLatestBlock ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              disabled={readOnly || latestPending}
              onClick={() => void handleLatestClick()}
              title="拉取最新块并填充"
            >
              {latestPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="size-3.5" />
              )}
            </Button>
          ) : null}
        </div>

        <div className="flex gap-2 items-center">
          <Label className="text-xs text-muted-foreground w-16 flex-shrink-0">Number</Label>
          <Input
            value={blockNumber !== undefined ? blockNumber.toString() : ""}
            onChange={(e) => onFieldChange?.("blockNumber", e.target.value)}
            readOnly={readOnly}
            placeholder="0"
            className="font-mono text-xs h-7 flex-1"
          />
        </div>

        <div className="flex gap-2 items-center">
          <Label className="text-xs text-muted-foreground w-16 flex-shrink-0">Time</Label>
          <Input
            value={timeDisplay}
            onChange={(e) => onFieldChange?.("timestamp", e.target.value)}
            readOnly={readOnly}
            placeholder="unix sec"
            className="font-mono text-xs h-7 flex-1"
          />
        </div>

        <div className="flex gap-2 items-center">
          <Label className="text-xs text-muted-foreground w-16 flex-shrink-0">GasLimit</Label>
          <Input
            value={gasLimit !== undefined ? gasLimit.toString() : ""}
            onChange={(e) => onFieldChange?.("gasLimit", e.target.value)}
            readOnly={readOnly}
            placeholder="0"
            className="font-mono text-xs h-7 flex-1"
          />
        </div>

        <div className="flex gap-2 items-center">
          <Label className="text-xs text-muted-foreground w-16 flex-shrink-0">BaseFee</Label>
          <Input
            value={baseFeeDisplay}
            onChange={(e) => onFieldChange?.("baseFeePerGas", e.target.value)}
            readOnly={readOnly}
            placeholder="Gwei"
            className="font-mono text-xs h-7 flex-1"
          />
          <span className="text-[10px] text-muted-foreground flex-shrink-0">Gwei</span>
        </div>
      </div>
    </Card>
  );
}
