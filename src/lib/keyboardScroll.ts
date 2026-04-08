import type { KeyboardScrollScope } from "@/store/debugStore";

export function scrollKeyboardDrawerScope(
  scope: KeyboardScrollScope,
  deltaTop: number,
  behavior: ScrollBehavior = "smooth",
): void {
  if (scope === "main") return;
  const nodes = document.querySelectorAll<HTMLElement>(
    `[data-keyboard-scroll-root="${scope}"]`,
  );
  nodes.forEach((el) => el.scrollBy({ top: deltaTop, behavior }));
}
