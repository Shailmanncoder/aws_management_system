"use client";
import { Button } from "@/components/ui/button";
export function PrintSummary() { return <Button variant="outline" className="print:hidden" onClick={() => window.print()}>Print or save PDF</Button>; }
