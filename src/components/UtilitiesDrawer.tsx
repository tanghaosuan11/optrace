import { useState } from "react";
import {
  keccak256, toBytes, isHex, isAddress, getAddress,
  pad, concat,
  decodeFunctionData, decodeAbiParameters,
  parseAbiParameters, parseAbi,
  formatUnits, parseUnits,
  createPublicClient, http,
} from "viem";
import { BottomSheetShell } from "@/components/ui/bottom-sheet-shell";
import { SheetClose } from "@/components/ui/sheet";
import { X, Pin, PinOff, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebugStore } from "@/store/debugStore";
import { useDrawerActions } from "@/hooks/useDrawerActions";
import { getSelectedRpc } from "@/lib/rpcConfig";

type Tool = "conv" | "keccak256" | "4byte" | "checksum" | "abi" | "slot";

const TOOLS: { id: Tool; label: string }[] = [
  { id: "conv",      label: "Conv"      },
  { id: "keccak256", label: "Keccak256" },
  { id: "4byte",     label: "4Byte"     },
  { id: "checksum",  label: "Checksum"  },
  { id: "abi",       label: "ABI"       },
  { id: "slot",      label: "SlotRead"  },
];

function parseNumber(val: string): bigint | null {
  const s = val.trim();
  if (!s) return null;
  try {
    if (s.startsWith("0x") || s.startsWith("0X")) return BigInt(s);
    if (/^[0-9a-fA-F]+$/.test(s) && /[a-fA-F]/.test(s)) return BigInt("0x" + s);
    return BigInt(s);
  } catch { return null; }
}

function Err({ msg }: { msg: string }) {
  return <p className="text-xs text-amber-500">{msg}</p>;
}
function ResultBox({ value }: { value: string }) {
  return <div className="text-xs font-mono px-2 py-1 bg-muted rounded select-all break-all">{value}</div>;
}

function BaseConvTool() {
  // 记录当前正在编辑的进制和原始输入，其他栏位从解析结果派生
  const [src, setSrc] = useState<{ base: number; raw: string } | null>(null);

  const parsed = (() => {
    if (!src?.raw.trim()) return null;
    try {
      const s = src.raw.trim();
      if (src.base === 2)  return BigInt("0b" + s.replace(/^0b/i, ""));
      if (src.base === 8)  return BigInt("0o" + s.replace(/^0o/i, ""));
      if (src.base === 16) return BigInt("0x" + s.replace(/^0x/i, ""));
      return BigInt(s);
    } catch { return null; }
  })();

  const val = (base: number) => {
    if (src?.base === base) return src.raw;
    if (parsed === null) return "";
    if (base === 2)  return parsed.toString(2);
    if (base === 8)  return "0o" + parsed.toString(8);
    if (base === 10) return parsed.toString(10);
    return "0x" + parsed.toString(16).toLowerCase();
  };

  const rows = [
    { base: 2,  ph: "1010" },
    { base: 8,  ph: "377"  },
    { base: 10, ph: "255"  },
    { base: 16, ph: "ff"   },
  ];

  return (
    <div className="space-y-1">
      {rows.map(({ base, ph }) => (
        <div key={base} className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-muted-foreground w-4 text-right shrink-0 select-none">{base}</span>
          <Input
            value={val(base)}
            onChange={(e) => setSrc({ base, raw: e.target.value })}
            onFocus={() => { if (src?.base !== base) setSrc({ base, raw: val(base) }); }}
            placeholder={ph}
            className="font-mono h-7 text-xs"
            autoFocus={base === 10}
          />
        </div>
      ))}
      {src?.raw.trim() && parsed === null && <Err msg="Invalid input" />}
    </div>
  );
}

function GweiTool() {
  const [input, setInput] = useState("");
  const [unit, setUnit] = useState<"wei" | "gwei" | "ether">("gwei");
  let wei: bigint | null = null, err = "";
  try {
    if (input.trim()) wei = parseUnits(input.trim(), unit === "wei" ? 0 : unit === "gwei" ? 9 : 18);
  } catch { err = "Invalid number"; }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="1.5" value={input} onChange={(e) => setInput(e.target.value)}
          className="font-mono h-7 text-xs flex-1" />
        <Select value={unit} onValueChange={(v) => setUnit(v as typeof unit)}>
          <SelectTrigger className="h-7 text-xs w-20 font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="wei" className="text-xs font-mono">wei</SelectItem>
            <SelectItem value="gwei" className="text-xs font-mono">gwei</SelectItem>
            <SelectItem value="ether" className="text-xs font-mono">ether</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {err ? <Err msg={err} /> : wei !== null && (
        <div className="space-y-0.5 text-xs font-mono">
          {[
            { label: "wei",   value: wei.toString() },
            { label: "gwei",  value: formatUnits(wei, 9) },
            { label: "ether", value: formatUnits(wei, 18) },
            { label: "hex",   value: "0x" + wei.toString(16).toLowerCase() },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className="text-muted-foreground shrink-0 w-8">{label}</span>
              <span className="select-all break-all">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Keccak256Tool() {
  const [input, setInput] = useState("");
  const [asHex, setAsHex] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const compute = () => {
    setError(""); setResult("");
    const s = input.trim(); if (!s) return;
    try {
      const bytes = asHex
        ? (isHex(s) ? toBytes(s as `0x${string}`) : (() => { throw new Error("Invalid hex"); })())
        : new TextEncoder().encode(s);
      setResult(keccak256(bytes));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <Input placeholder={asHex ? "0xdeadbeef..." : "transfer(address,uint256)"} value={input}
          onChange={(e) => { setInput(e.target.value); setResult(""); setError(""); }}
          className="font-mono h-7 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && compute()} autoFocus />
        <label className="flex items-center gap-1 cursor-pointer select-none shrink-0">
          <input type="checkbox" checked={asHex}
            onChange={(e) => { setAsHex(e.target.checked); setResult(""); setError(""); }}
            className="h-3 w-3 accent-primary" />
          <span className="text-[11px] text-muted-foreground">hex</span>
        </label>
        <Button size="sm" className="h-7 px-3 text-xs shrink-0" onClick={compute}>Hash</Button>
      </div>
      {error && <Err msg={error} />}
      {result && (
        <div className="space-y-0.5 text-xs font-mono">
          <ResultBox value={result} />
          <div className="px-1 text-muted-foreground">4-byte: <span className="text-foreground select-all">{result.slice(0, 10)}</span></div>
        </div>
      )}
    </div>
  );
}

function FourByteTool() {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const handleLookup = async () => {
    const selector = input.trim().replace(/^0x/i, "");
    if (selector.length !== 8 || !/^[0-9a-fA-F]{8}$/.test(selector)) { setError("Need 8 hex chars"); return; }
    setLoading(true); setError(""); setResults([]);
    try {
      const res = await fetch(`https://www.4byte.directory/api/v1/signatures/?hex_signature=0x${selector}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const r: string[] = (json.results ?? []).map((x: { text_signature: string }) => x.text_signature);
      setResults(r.length ? r : ["No matches found"]);
    } catch (e) {
      setError("Lookup failed: " + (e instanceof Error ? e.message : String(e)));
    } finally { setLoading(false); }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input placeholder="a9059cbb  or  0xa9059cbb" value={input}
          onChange={(e) => { setInput(e.target.value); setError(""); setResults([]); }}
          className="font-mono h-7 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && handleLookup()} autoFocus />
        <Button size="sm" className="h-7 px-3 text-xs" onClick={handleLookup} disabled={loading}>
          {loading ? "..." : "Lookup"}
        </Button>
      </div>
      {error && <Err msg={error} />}
      {results.length > 0 && (
        <div className="space-y-1 overflow-auto max-h-[90px]">
          {results.map((sig, i) => <div key={i} className="text-xs font-mono px-2 py-1 bg-muted rounded select-all">{sig}</div>)}
        </div>
      )}
    </div>
  );
}

function ChecksumTool() {
  const [input, setInput] = useState("");
  let result = "", err = "";
  const s = input.trim();
  if (s) { try { result = getAddress(s); } catch { err = "Invalid address"; } }
  return (
    <div className="space-y-2">
      <Input placeholder="0xabc...  (any case)" value={input}
        onChange={(e) => setInput(e.target.value)} className="font-mono h-7 text-xs" autoFocus />
      {err && <Err msg={err} />}
      {result && (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs font-mono items-start">
          <span className="text-muted-foreground pt-0.5">EIP-55</span>
          <div className="flex items-center gap-2">
            <span className="select-all break-all">{result}</span>
            {result === s && <span className="text-emerald-400 shrink-0 text-[10px]">✓</span>}
          </div>
          <span className="text-muted-foreground pt-0.5">lower</span>
          <span className="select-all break-all text-muted-foreground">{result.toLowerCase()}</span>
        </div>
      )}
    </div>
  );
}

function AbiTool() {
  const [sig, setSig] = useState("");
  const [data, setData] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const run = () => {
    setError(""); setResult("");
    const d = data.trim(); if (!d || !isHex(d)) { setError("Need hex data"); return; }
    try {
      if (sig.trim() && d.length >= 10) {
        const fnSig = sig.trim();
        const abiItem = `function ${fnSig}` as const;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const abi = parseAbi([abiItem as any]);
        const decoded = decodeFunctionData({ abi, data: d as `0x${string}` });
        setResult(JSON.stringify(decoded.args, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      } else {
        const params = sig.trim() ? parseAbiParameters(sig.trim()) : parseAbiParameters("bytes");
        const decoded = decodeAbiParameters(params, d as `0x${string}`);
        setResult(JSON.stringify(decoded, (_k, v) => typeof v === "bigint" ? v.toString() : v, 2));
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <div className="space-y-2">
      <Input placeholder="transfer(address,uint256)  or  address,uint256  (leave empty = raw)" value={sig}
        onChange={(e) => { setSig(e.target.value); setResult(""); setError(""); }}
        className="font-mono h-7 text-xs" autoFocus />
      <div className="flex gap-2">
        <Input placeholder="0x calldata hex..." value={data}
          onChange={(e) => { setData(e.target.value); setResult(""); setError(""); }}
          className="font-mono h-7 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && run()} />
        <Button size="sm" className="h-7 px-3 text-xs shrink-0" onClick={run}>Decode</Button>
      </div>
      {error && <Err msg={error} />}
      {result && (
        <pre className="text-xs font-mono bg-muted rounded px-2 py-1 overflow-auto max-h-[80px] select-all whitespace-pre-wrap break-all">{result}</pre>
      )}
    </div>
  );
}

function SlotTool() {
  const [kind, setKind] = useState<"plain" | "mapping" | "array">("mapping");
  const [baseSlot, setBaseSlot] = useState("0");
  const [mapKey, setMapKey] = useState("");
  const [arrIdx, setArrIdx] = useState("0");
  const [computedSlot, setComputedSlot] = useState("");
  const [address, setAddress] = useState("");
  const [fetchResult, setFetchResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const computeSlot = (): string | null => {
    try {
      const slotN = parseNumber(baseSlot);
      if (slotN === null) { setError("Invalid base slot"); return null; }
      const slotPadded = pad(`0x${slotN.toString(16)}` as `0x${string}`, { size: 32 });
      if (kind === "plain") return `0x${slotN.toString(16).padStart(64, "0")}`;
      if (kind === "mapping") {
        const k = mapKey.trim(); if (!k) { setError("Key required"); return null; }
        const keyPadded = isAddress(k)
          ? pad(k as `0x${string}`, { size: 32 })
          : (() => { const kn = parseNumber(k); if (kn === null) throw new Error("Invalid key"); return pad(`0x${kn.toString(16)}` as `0x${string}`, { size: 32 }); })();
        return keccak256(concat([keyPadded, slotPadded]));
      }
      if (kind === "array") {
        const base = BigInt(keccak256(slotPadded));
        const idxN = parseNumber(arrIdx); if (idxN === null) { setError("Invalid index"); return null; }
        return `0x${(base + idxN).toString(16).padStart(64, "0")}`;
      }
      return null;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
  };

  const handleCalc = () => {
    setError(""); setFetchResult(""); setComputedSlot("");
    const s = computeSlot(); if (s) setComputedSlot(s);
  };

  const handleFetch = async () => {
    setError(""); setFetchResult("");
    let slot = computedSlot;
    if (!slot) { const s = computeSlot(); if (!s) return; slot = s; setComputedSlot(s); }
    const addr = address.trim();
    if (!addr || !isAddress(addr)) { setError("Valid contract address required"); return; }
    setLoading(true);
    try {
      const client = createPublicClient({ transport: http(getSelectedRpc()) });
      const value = await client.getStorageAt({ address: addr as `0x${string}`, slot: slot as `0x${string}` });
      setFetchResult(value ?? "0x" + "0".repeat(64));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 flex-wrap">
        <Select value={kind} onValueChange={(v) => { setKind(v as typeof kind); setComputedSlot(""); setError(""); }}>
          <SelectTrigger className="h-7 text-xs w-24 font-mono shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="mapping" className="text-xs font-mono">mapping</SelectItem>
            <SelectItem value="array" className="text-xs font-mono">array</SelectItem>
            <SelectItem value="plain" className="text-xs font-mono">plain</SelectItem>
          </SelectContent>
        </Select>
        <Input placeholder="Base slot (0 or 0x0)" value={baseSlot}
          onChange={(e) => { setBaseSlot(e.target.value); setComputedSlot(""); setError(""); }}
          className="font-mono h-7 text-xs w-32" />
        {kind === "mapping" && (
          <Input placeholder="Key (address or uint)" value={mapKey}
            onChange={(e) => { setMapKey(e.target.value); setComputedSlot(""); setError(""); }}
            className="font-mono h-7 text-xs flex-1 min-w-[120px]" />
        )}
        {kind === "array" && (
          <Input placeholder="Index" value={arrIdx}
            onChange={(e) => { setArrIdx(e.target.value); setComputedSlot(""); setError(""); }}
            className="font-mono h-7 text-xs w-20" />
        )}
        <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleCalc}>Calc</Button>
      </div>
      {computedSlot && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">slot</span>
          <ResultBox value={computedSlot} />
        </div>
      )}
      <div className="flex gap-1.5">
        <Input placeholder="Contract address (for getStorageAt)" value={address}
          onChange={(e) => { setAddress(e.target.value); setFetchResult(""); setError(""); }}
          className="font-mono h-7 text-xs flex-1" />
        <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleFetch} disabled={loading}>
          {loading ? "..." : "Read"}
        </Button>
      </div>
      {error && <Err msg={error} />}
      {fetchResult && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">value</span>
          <ResultBox value={fetchResult} />
        </div>
      )}
    </div>
  );
}

function TimestampTool() {
  const [tsInput, setTsInput] = useState("");
  const [tz, setTz] = useState<"local" | "utc">("local");
  const [blockInput, setBlockInput] = useState("");
  const [blockTs, setBlockTs] = useState<number | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockError, setBlockError] = useState("");

  const ts = tsInput.trim() ? Number(tsInput.trim()) : null;
  const tsDate = ts !== null && !isNaN(ts) ? new Date(ts * 1000) : null;

  const fmtDate = (d: Date) => tz === "utc"
    ? [d.toISOString(), d.toUTCString()]
    : [d.toISOString(), d.toLocaleString()];

  const fmtBlockResult = (t: number) => {
    const d = new Date(t * 1000);
    const [iso, human] = fmtDate(d);
    return `${t}  ·  ${iso}  ·  ${human}`;
  };

  const fetchBlock = async () => {
    setBlockError(""); setBlockTs(null);
    const b = blockInput.trim(); if (!b) return;
    setBlockLoading(true);
    try {
      const client = createPublicClient({ transport: http(getSelectedRpc()) });
      const block = await client.getBlock(b === "latest" ? {} : { blockNumber: BigInt(b) });
      setBlockTs(Number(block.timestamp));
    } catch (e) { setBlockError(e instanceof Error ? e.message : String(e)); }
    finally { setBlockLoading(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 items-center">
        <Input placeholder="Unix timestamp" value={tsInput}
          onChange={(e) => setTsInput(e.target.value)} className="font-mono h-7 text-xs flex-1" />
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0"
          onClick={() => setTsInput(String(Math.floor(Date.now() / 1000)))}>Now</Button>
        <Select value={tz} onValueChange={(v) => setTz(v as "local" | "utc")}>
          <SelectTrigger className="h-7 text-xs w-20 font-mono shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="local" className="text-xs font-mono">Local</SelectItem>
            <SelectItem value="utc"   className="text-xs font-mono">UTC</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {tsDate && (
        <div className="space-y-0.5">
          {fmtDate(tsDate).map((v, i) => <ResultBox key={i} value={v} />)}
        </div>
      )}
      <div className="flex gap-1.5 items-center border-t pt-1.5">
        <Input placeholder="Block number or 'latest'" value={blockInput}
          onChange={(e) => { setBlockInput(e.target.value); setBlockTs(null); setBlockError(""); }}
          className="font-mono h-7 text-xs flex-1"
          onKeyDown={(e) => e.key === "Enter" && fetchBlock()} />
        <Button size="sm" className="h-7 px-2 text-xs shrink-0" onClick={fetchBlock} disabled={blockLoading}>
          {blockLoading ? "..." : "Fetch"}
        </Button>
      </div>
      {blockError && <Err msg={blockError} />}
      {blockTs !== null && <ResultBox value={fmtBlockResult(blockTs)} />}
    </div>
  );
}

export function UtilitiesDrawer() {
  const isOpen = useDebugStore((s) => s.isUtilitiesOpen);
  const [activeTool, setActiveTool] = useState<Tool>("conv");
  const [pinned, setPinned] = useState(false);
  const { closeUtilities: close } = useDrawerActions();

  return (
    <BottomSheetShell
      open={isOpen}
      onOpenChange={(o) => { if (!o && !pinned) close(); }}
      sheetTitle="Utilities"
      defaultHeightPx={320}
      minHeightPx={200}
    >
        {/* Header + tabs — 与 Call Tree / Event Logs 同一套尺寸（11px、h-5 控件、h-3 图标） */}
        <div className="flex flex-nowrap items-center gap-x-1.5 border-b border-border bg-muted/60 px-2 py-1 text-[11px] shrink-0">
          <div className="flex shrink-0 items-center gap-1.5">
            <Wrench className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="shrink-0 font-semibold tracking-wide text-foreground">Utilities</span>
          </div>
          <div className="flex min-h-5 min-w-0 flex-1 items-center gap-1 overflow-x-auto px-0.5 py-px scrollbar-hidden">
            {TOOLS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTool(id)}
                className={`inline-flex h-5 shrink-0 items-center justify-center rounded px-2 text-[11px] font-medium leading-tight transition-colors ${
                  activeTool === id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={`h-5 w-5 shrink-0 rounded-md p-0 [&_svg]:size-3 ${pinned ? "text-primary" : "text-muted-foreground"}`}
              title={pinned ? "Unpin drawer" : "Pin drawer (ignore click-outside close)"}
              onClick={() => setPinned((p) => !p)}
            >
              {pinned ? <Pin /> : <PinOff />}
            </Button>
            <SheetClose className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm p-0 opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary">
              <X className="h-3 w-3" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </div>
        </div>
        {/* Content */}
        {activeTool === "conv" ? (
          <div className="flex-1 grid grid-cols-3 divide-x overflow-hidden">
            <div className="overflow-auto px-3 pt-1.5 pb-2"><BaseConvTool /></div>
            <div className="overflow-auto px-3 pt-1.5 pb-2"><GweiTool /></div>
            <div className="overflow-auto px-3 pt-1.5 pb-2"><TimestampTool /></div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto px-3 pt-1.5 pb-2">
            {activeTool === "keccak256" && <Keccak256Tool />}
            {activeTool === "4byte"     && <FourByteTool />}
            {activeTool === "checksum"  && <ChecksumTool />}
            {activeTool === "abi"       && <AbiTool />}
            {activeTool === "slot"      && <SlotTool />}
          </div>
        )}
    </BottomSheetShell>
  );
}
