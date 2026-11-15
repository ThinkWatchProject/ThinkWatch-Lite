import type { ComponentProps, ReactNode } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./select";

// Encode every value, including empty, so Radix's empty placeholder is never
// confused with a real “all/default/automatic” option. No sentinel can collide.
const encode = (value: string | number) => `value:${value}`;

/** A complete shadcn Select for a form field or a compact table/toolbar cell. */
export function SelectField({ value, onValueChange, children, disabled, name, ...props }: Omit<ComponentProps<typeof SelectTrigger>, "value" | "onChange" | "children"> & {
  value: string | number;
  onValueChange: (value: string) => void;
  children: ReactNode;
  name?: string;
}) {
  return <Select value={encode(value)} onValueChange={(next) => onValueChange(next.slice(6))} disabled={disabled}>
    <SelectTrigger {...props}><SelectValue /></SelectTrigger>
    <SelectContent position="popper" align="start"><SelectGroup>{children}</SelectGroup></SelectContent>
    {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
  </Select>;
}

export function SelectOption({ value, ...props }: Omit<ComponentProps<typeof SelectItem>, "value"> & { value: string | number }) {
  return <SelectItem {...props} value={encode(value)} data-choice-value={value} />;
}

export function SelectOptionGroup({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <SelectGroup><SelectLabel>{label}</SelectLabel>{children}</SelectGroup>;
}
