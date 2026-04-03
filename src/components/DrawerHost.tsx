import { TestDialog } from "@/components/TestDialog";
import { GlobalLogDrawer } from "@/components/GlobalLogDrawer";
import { UtilitiesDrawer } from "@/components/UtilitiesDrawer";
import { AnalysisDrawer } from "@/components/AnalysisDrawer";
import { SymbolicSolveDrawer } from "@/components/SymbolicSolveDrawer";

interface DrawerHostProps {
  onSeekToWithHistory: (index: number) => void;
}

export function DrawerHost({ onSeekToWithHistory }: DrawerHostProps) {
  return (
    <>
      <TestDialog />
      <GlobalLogDrawer onSeekTo={onSeekToWithHistory} />
      <UtilitiesDrawer />
      <AnalysisDrawer />
      <SymbolicSolveDrawer />
    </>
  );
}
