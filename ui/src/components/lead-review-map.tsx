"use client";

import dynamic from "next/dynamic";
import type { LocationDensityMapBaseProps } from "./location-density-map";

const LeadReviewMapBase = dynamic(
  () => import("./location-density-map").then((module) => module.LocationDensityMapBase),
  { ssr: false }
);

export type LeadReviewMapProps = Omit<LocationDensityMapBaseProps, "variant">;

export function LeadReviewMap(props: LeadReviewMapProps) {
  return <LeadReviewMapBase {...props} variant="lead-review" />;
}
