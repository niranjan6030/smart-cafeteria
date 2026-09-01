import FalconVeg from "./FalconVeg";
import Fresheteria from "./Fresheteria";
import Mingos from "./Mingos";
import BreakTime from "./BreakTime";
import SurfTurf from "./SurfTurf";
import Bakery from "./Bakery";

// Single source of truth for stall name <-> URL slug <-> component. Hardcoded rather than a
// generic slugifier since "Surf & Turf" needs an explicit mapping anyway, and there are only 6.
export const STALL_ROUTES = [
  { name: "Falcon Veg", slug: "falcon-veg", Component: FalconVeg },
  { name: "Fresheteria", slug: "fresheteria", Component: Fresheteria },
  { name: "Mingos", slug: "mingos", Component: Mingos },
  { name: "Break Time", slug: "break-time", Component: BreakTime },
  { name: "Surf & Turf", slug: "surf-turf", Component: SurfTurf },
  { name: "Bakery", slug: "bakery", Component: Bakery },
];

export function stallRouteByName(name) {
  return STALL_ROUTES.find((route) => route.name === name) || null;
}

export function stallRouteBySlug(slug) {
  return STALL_ROUTES.find((route) => route.slug === slug) || null;
}
