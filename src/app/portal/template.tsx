/**
 * Each page arriving slides up and fades in, the way a screen in a phone app
 * does (.page-enter in globals.css, 220ms).
 *
 * A template rather than the layout because Next.js mounts a template afresh
 * on every navigation while a layout persists - so the animation plays once per
 * page and the header, tab bar and sidebar around it stay perfectly still.
 * Pure CSS: no client JavaScript, and prefers-reduced-motion switches it off.
 */
import { PortalRouteFrame } from "@/components/PortalRouteFrame";
export default function Template({ children }: { children: React.ReactNode }) {
  return <PortalRouteFrame>{children}</PortalRouteFrame>;
}
