import { cn } from "@/lib/utils";
import Image from "next/image";

export function WolfLogo({ className, animated = false }: { className?: string; animated?: boolean }) {
  return <Image className={cn("wolf-logo", animated && "is-animated", className)} src="/favicon.svg" alt="לוגו זאב כחול" width={128} height={128} priority />;
}
