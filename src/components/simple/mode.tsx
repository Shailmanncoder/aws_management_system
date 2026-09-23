"use client";
import { createContext, useContext, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
export const ExperienceContext = createContext(true);
export const useSimpleMode = () => useContext(ExperienceContext);
export function ModeSwitch() {
  const simple = useSimpleMode(), router = useRouter();
  const [pending, start] = useTransition();
  return <div className="space-y-2 border-t p-3"><p className="text-xs text-muted-foreground">{simple ? "Simple mode" : "Detailed mode"}</p><Button className="w-full border-white/20 bg-white/5 text-sidebar-foreground hover:bg-white/10 hover:text-white" size="sm" variant="outline" disabled={pending} onClick={() => { document.cookie = `stratus-experience=${simple ? "detailed" : "simple"}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`; start(() => router.refresh()); }}>{pending ? "Switching…" : simple ? "Switch to detailed mode" : "Switch to simple mode"}</Button></div>;
}
