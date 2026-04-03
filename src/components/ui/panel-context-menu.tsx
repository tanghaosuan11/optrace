/**
 * PanelContextMenu — compact context menu for data panels (Stack / Memory / Storage).
 * Uses `bg-background` / `border-border` so it matches app chrome instead of `bg-popover`.
 */
import * as React from "react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

// Content: same surface tokens as cards / inspector (not default popover tint)
const PanelContextMenuContent = React.forwardRef<
  React.ElementRef<typeof ContextMenuContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenuContent>
>(({ className, ...props }, ref) => (
  <ContextMenuContent
    ref={ref}
    className={cn(
      "min-w-[8rem] border border-border bg-background p-0.5 text-foreground shadow-sm",
      className,
    )}
    {...props}
  />
));
PanelContextMenuContent.displayName = "PanelContextMenuContent";

// Item: compact type; highlight with muted (aligns with list rows / panels, not stark accent)
const PanelContextMenuItem = React.forwardRef<
  React.ElementRef<typeof ContextMenuItem>,
  React.ComponentPropsWithoutRef<typeof ContextMenuItem>
>(({ className, ...props }, ref) => (
  <ContextMenuItem
    ref={ref}
    className={cn(
      "px-2 py-1 text-[10px] leading-tight focus:bg-muted focus:text-foreground data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
      className,
    )}
    {...props}
  />
));
PanelContextMenuItem.displayName = "PanelContextMenuItem";

// Separator: tight for small menu
const PanelContextMenuSeparator = React.forwardRef<
  React.ElementRef<typeof ContextMenuSeparator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuSeparator>
>(({ className, ...props }, ref) => (
  <ContextMenuSeparator
    ref={ref}
    className={cn("my-0.5", className)}
    {...props}
  />
));
PanelContextMenuSeparator.displayName = "PanelContextMenuSeparator";

export {
  ContextMenu as PanelContextMenu,
  ContextMenuTrigger as PanelContextMenuTrigger,
  PanelContextMenuContent,
  PanelContextMenuItem,
  PanelContextMenuSeparator,
};
