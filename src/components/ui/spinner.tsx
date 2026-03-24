import type { ComponentProps } from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

function Spinner({ className, ...props }: ComponentProps<typeof Loader2>) {
  return (
    <Loader2
      role="status"
      aria-label="Loading"
      className={cn("animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
