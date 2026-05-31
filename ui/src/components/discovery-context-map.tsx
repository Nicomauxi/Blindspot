"use client";

import dynamic from "next/dynamic";
import type { LocationDensityMapBaseProps } from "./location-density-map";

const DiscoveryContextMapBase = dynamic(
  () => import("./location-density-map").then((module) => module.LocationDensityMapBase),
  { ssr: false }
);

export type DiscoveryContextMapProps = Omit<LocationDensityMapBaseProps, "variant">;

export function DiscoveryContextMap(props: DiscoveryContextMapProps) {
  return <DiscoveryContextMapBase {...props} variant="discovery-context" />;
}
