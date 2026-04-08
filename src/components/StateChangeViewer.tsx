import { useMemo, useState } from "react";
import { useDebugStore } from "@/store/debugStore";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { StateChangeEntry, StateChangeCategory, CallFrame } from "@/lib/types";

/** 从 activeTab ("frame-{tid}-{cid}") 解析 transactionId / contextId */
function parseActiveTab(tab: string): { tid: number; cid: number } {
  const m = tab.match(/^frame-(\d+)-(\d+)$/);
  return m ? { tid: parseInt(m[1]), cid: parseInt(m[2]) } : { tid: 0, cid: 1 };
}

// ---- helpers ----

function fullAddr(hex: string | undefined): string {
  if (!hex) return "—";
  return hex.startsWith("0x") ? hex : `0x${hex}`;
}

function shortAddr(hex: string | undefined): string {
  if (!hex) return "—";
  const h = fullAddr(hex);
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function fullU256(hex: string | undefined): string {
  if (!hex) return "0x0";
  const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
  const trimmed = raw.replace(/^0+/, "") || "0";
  return `0x${trimmed}`;
}

function isFrameReverted(frames: CallFrame[], tid: number, cid: number): boolean {
  const tidFrames = frames.filter(f => (f.transactionId ?? 0) === tid);
  const byCtx = new Map(tidFrames.map(f => [f.contextId, f]));
  const failedCtx = new Set(tidFrames.filter(f => f.success === false).map(f => f.contextId));
  let cur = byCtx.get(cid);
  while (cur) {
    if (failedCtx.has(cur.contextId)) return true;
    cur = cur.parentId != null ? byCtx.get(cur.parentId) : undefined;
  }
  return false;
}

// ---- collapsed summary (one-liner) ----

function summarize(entry: StateChangeEntry): string {
  switch (entry.kind) {
    case "AccountCreated":
      return `${shortAddr(entry.address)}${entry.isCreatedGlobally ? " (global)" : ""}`;
    case "AccountDestroyed":
      return `${shortAddr(entry.address)} → ${shortAddr(entry.target)} had ${fullU256(entry.hadBalance)}`;
    case "BalanceChange":
      return `${shortAddr(entry.address)} ${fullU256(entry.oldBalance)} → ${fullU256(entry.newBalance)}`;
    case "BalanceTransfer":
      return `${shortAddr(entry.from)} → ${shortAddr(entry.to)} Δ${fullU256(entry.balance)}`;
    case "NonceChange":
      return `${shortAddr(entry.address)} ${entry.previousNonce ?? 0} → ${entry.newNonce ?? "?"}` ;
    case "NonceBump":
      return `${shortAddr(entry.address)} ${entry.previousNonce ?? 0} → ${entry.newNonce ?? "?"}`;
  }
}

// ---- expanded detail fields ----

function expandedFields(entry: StateChangeEntry): Array<[string, string]> {
  switch (entry.kind) {
    case "AccountCreated":
      return [
        ["address", fullAddr(entry.address)],
        ["scope", entry.isCreatedGlobally ? "global" : "local"],
      ];
    case "AccountDestroyed":
      return [
        ["address",     fullAddr(entry.address)],
        ["target",      fullAddr(entry.target)],
        ["had balance", fullU256(entry.hadBalance)],
      ];
    case "BalanceChange":
      return [
        ["address",     fullAddr(entry.address)],
        ["old balance", fullU256(entry.oldBalance)],
        ["new balance", fullU256(entry.newBalance)],
      ];
    case "BalanceTransfer":
      return [
        ["from",   fullAddr(entry.from)],
        ["to",     fullAddr(entry.to)],
        ["amount", fullU256(entry.balance)],
      ];
    case "NonceChange":
      return [
        ["address",        fullAddr(entry.address)],
        ["previous nonce", String(entry.previousNonce ?? 0)],
        ["new nonce",      String(entry.newNonce ?? "?")],
      ];
    case "NonceBump":
      return [
        ["address",        fullAddr(entry.address)],
        ["previous nonce", String(entry.previousNonce ?? 0)],
        ["new nonce",      String(entry.newNonce ?? "?")],
      ];
  }
}

const CATEGORY_COLOR: Record<StateChangeCategory, string> = {
  account: "text-foreground/80",
  balance: "text-foreground/80",
  nonce: "text-foreground/80",
};

const CATEGORY_BG: Record<StateChangeCategory, string> = {
  account: "bg-muted/30 border border-border/40",
  balance: "bg-muted/30 border border-border/40",
  nonce: "bg-muted/30 border border-border/40",
};

type GroupedItem =
  | { type: "header"; category: StateChangeCategory; count: number }
  | { type: "entry"; entry: StateChangeEntry; reverted: boolean; key: string };

export function StateChangeViewer() {
  const stateChanges     = useDebugStore(s => s.stateChanges);
  const callFrames       = useDebugStore(s => s.callFrames);
  const activeTab        = useDebugStore(s => s.activeTab);
  const currentStepIndex = useDebugStore(s => s.currentStepIndex);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { tid, cid } = useMemo(() => parseActiveTab(activeTab), [activeTab]);

  const reverted = useMemo(
    () => isFrameReverted(callFrames, tid, cid),
    [callFrames, tid, cid]
  );

  const { items, counts } = useMemo(() => {
    const groups: Record<StateChangeCategory, StateChangeEntry[]> = { account: [], balance: [], nonce: [] };
    const visibleStepUpperBound = currentStepIndex + 1; // backend stepIndex is 1-based
    for (const e of stateChanges) {
      if (e.transactionId !== tid || e.frameId !== cid) continue;
      if (e.stepIndex > visibleStepUpperBound) continue;
      groups[e.category].push(e);
    }
    const counts: Record<StateChangeCategory, number> = {
      account: groups.account.length,
      balance: groups.balance.length,
      nonce:   groups.nonce.length,
    };
    const items: GroupedItem[] = [];
    for (const cat of ["account", "balance", "nonce"] as StateChangeCategory[]) {
      if (groups[cat].length === 0) continue;
      items.push({ type: "header", category: cat, count: groups[cat].length });
      groups[cat].forEach((entry, i) => {
        items.push({ type: "entry", entry, reverted, key: `${cat}-${i}` });
      });
    }
    return { items, counts };
  }, [stateChanges, tid, cid, currentStepIndex, reverted]);

  const total = items.filter(i => i.type === "entry").length;

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      <div className="text-xs font-medium px-2 py-1 border-b bg-muted/50 flex items-center gap-2 flex-shrink-0">
        <span>State Changes ({total})</span>
        {(["account", "balance", "nonce"] as StateChangeCategory[]).map(cat => (
          counts[cat] > 0 && (
            <span key={cat} className={`text-[10px] px-1.5 rounded font-mono font-normal ${CATEGORY_COLOR[cat]} ${CATEGORY_BG[cat]}`}>
              {cat} {counts[cat]}
            </span>
          )
        ))}
      </div>

      {total === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          No state changes recorded
        </div>
      ) : (
        <div className="flex-1 overflow-auto scrollbar-hidden">
          {items.map((item, idx) =>
            item.type === "header" ? (
              <div
                key={idx}
                className={`px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border-b ${CATEGORY_COLOR[item.category]} bg-muted/20`}
              >
                {item.category} · {item.count}
              </div>
            ) : (
              <StateChangeRow
                key={item.key}
                item={item}
                isOpen={expanded.has(item.key)}
                onToggle={() => toggle(item.key)}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

function StateChangeRow({
  item,
  isOpen,
  onToggle,
}: {
  item: { type: "entry"; entry: StateChangeEntry; reverted: boolean };
  isOpen: boolean;
  onToggle: () => void;
}) {
  const { entry, reverted } = item;
  const catColor = CATEGORY_COLOR[entry.category];
  const catBg    = CATEGORY_BG[entry.category];
  const fields   = isOpen ? expandedFields(entry) : null;

  return (
    <div
      className={`border-b text-[11px] font-mono ${reverted ? "opacity-50" : ""}`}
    >
      {/* collapsed header row */}
      <div
        className="pl-1.5 pr-2 py-1 flex items-center gap-1.5 cursor-pointer hover:bg-muted/25 select-none"
        onClick={onToggle}
      >
        <span className="flex-shrink-0 text-muted-foreground/50">
          {isOpen
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
        </span>
        <span className="flex-shrink-0 text-muted-foreground/60 w-[34px] text-right text-[10px] leading-4">
          #{entry.stepIndex}
        </span>
        <span className={`flex-shrink-0 text-[10px] px-1.5 rounded-md font-normal leading-4 ${catColor} ${catBg}`}>
          {entry.kind}
        </span>
        <span
          className={`flex-1 min-w-0 truncate leading-4 text-foreground/70 ${reverted ? "line-through decoration-red-400/60" : ""}`}
          title={summarize(entry)}
        >
          {summarize(entry)}
        </span>
      </div>

      {/* expanded details */}
      {isOpen && fields && (
        <div className="pl-6 pr-2 pb-2 pt-0.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
          {fields.map(([k, v]) => (
            <>
              <span key={`k-${k}`} className="text-muted-foreground whitespace-nowrap">{k}</span>
              <span
                key={`v-${k}`}
                className={`break-all text-foreground/90 ${reverted ? "line-through decoration-red-400/60" : ""}`}
              >
                {v}
              </span>
            </>
          ))}
        </div>
      )}
    </div>
  );
}
