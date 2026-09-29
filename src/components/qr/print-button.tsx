"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton({ label = "Print" }: { label?: string }) {
  return (
    <Button onClick={() => window.print()} className="print:hidden">
      <PrinterIcon /> {label}
    </Button>
  );
}
