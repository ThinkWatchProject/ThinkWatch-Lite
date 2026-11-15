import { createContext, useContext, useState, type ReactNode } from "react";

const PopupContainer = createContext<HTMLElement | null>(null);

/** Keep Base UI popups inside the Radix modal's pointer, focus and scroll scope. */
export function PopupScope({ children }: { children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return <PopupContainer.Provider value={container}>
    <div ref={setContainer} className="contents">{children}</div>
  </PopupContainer.Provider>;
}

export const usePopupContainer = () => useContext(PopupContainer);

/** Let the combobox consume the first Escape before the enclosing dialog. */
export function keepPopupEscape(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const dialog = target.closest('[role="dialog"], [role="alertdialog"]');
  if (!dialog?.querySelector('[data-slot="combobox-content"][data-open]')) return false;
  event.preventDefault();
  return true;
}
