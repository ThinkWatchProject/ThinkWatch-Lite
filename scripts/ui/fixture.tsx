import { useState } from "react";
import { createRoot } from "react-dom/client";
import "@/index.css";
import { Button } from "@/ui/button";
import { Label } from "@/ui/label";
import { SelectField, SelectOption, SelectOptionGroup } from "@/ui/select-field";
import { Segmented } from "@/ui/segmented";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/ui/dialog";
import { Sheet, SheetContent, SheetTitle, SheetDescription, SheetTrigger } from "@/ui/sheet";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogTrigger } from "@/ui/alert-dialog";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem } from "@/ui/combobox";

const items = Array.from({ length: 80 }, (_, i) => `Choice ${String(i).padStart(2, "0")}`);
function Choices() {
  const [value, setValue] = useState<string | null>(items[0]!);
  return <><Label htmlFor="search">Searchable</Label><Combobox items={items} value={value} onValueChange={setValue}>
    <ComboboxInput id="search" /><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox></>;
}
function Fixture() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [extra, setExtra] = useState(false);
  const [segment, setSegment] = useState("");
  const [count, setCount] = useState(0);
  return <main style={{ padding: 32, display: "grid", gap: 16 }}>
    <form onSubmit={(event) => { event.preventDefault(); setSaved(String(new FormData(event.currentTarget).get("choice"))); }}>
      <Label htmlFor="select">Fixed choices</Label>
      <SelectField id="select" name="choice" value={value} onValueChange={(next) => { if (next === "create") setExtra(true); else setValue(next); }}>
        <SelectOption value="">Automatic</SelectOption><SelectOption value="disabled" disabled>Unavailable</SelectOption>
        <SelectOptionGroup label="Group"><SelectOption value="one">One</SelectOption><SelectOption value="value:one">Value with prefix</SelectOption>{extra && <SelectOption value="extra">Extra</SelectOption>}</SelectOptionGroup>
        <SelectOption value="create">Create…</SelectOption>
      </SelectField>
      <Button type="submit">Submit</Button><Button type="button" onClick={() => setValue("")}>Reset choice</Button>
      <output data-testid="saved">{saved === null ? "unset" : JSON.stringify(saved)}</output>
    </form>
    <SelectField aria-label="Disabled" disabled value="" onValueChange={() => { throw Error("Disabled selection changed"); }}><SelectOption value="">Automatic</SelectOption></SelectField>
    <Segmented value={segment} label="Mode" options={[{ id: "", label: "Default" }, { id: "custom", label: "Custom" }, { id: "off", label: "Disabled mode", disabled: true }]} onChange={(next) => { setSegment(next); setCount((c) => c + 1); }} />
    <output data-testid="changes">{count}</output>
    <Dialog><DialogTrigger asChild><Button>Dialog</Button></DialogTrigger><DialogContent><DialogTitle>Dialog choices</DialogTitle><DialogDescription>Modal popup regression</DialogDescription><Choices /></DialogContent></Dialog>
    <Sheet><SheetTrigger asChild><Button>Sheet</Button></SheetTrigger><SheetContent><SheetTitle>Sheet choices</SheetTitle><SheetDescription>Modal popup regression</SheetDescription><Choices /></SheetContent></Sheet>
    <AlertDialog><AlertDialogTrigger asChild><Button>Alert</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogTitle>Alert choices</AlertDialogTitle><AlertDialogDescription>Modal popup regression</AlertDialogDescription><Choices /></AlertDialogContent></AlertDialog>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
