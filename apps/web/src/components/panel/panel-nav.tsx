"use client";

import { usePathname } from "next/navigation";
import { PanelLinks, type PanelLink } from "./panel-links";

export type { PanelLink };

/** Menú del panel que marca la página actual. */
export function PanelNav({ links }: { links: readonly PanelLink[] }) {
  return <PanelLinks links={links} pathname={usePathname()} />;
}
