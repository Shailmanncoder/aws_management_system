import "server-only";
import { ebsSnapshotsCollector, ebsVolumesCollector, ec2InstancesCollector, elasticIpsCollector } from "./ec2";
import { s3BucketsCollector } from "./s3";
import type { Collector } from "./types";
import { securityGroupsCollector, vpcCollector } from "./vpc";
import { EXTRA_COLLECTORS } from "./services";

/** Inventory collectors run by INVENTORY_SYNC. */
export const COLLECTORS: readonly Collector[] = [
  ec2InstancesCollector,
  ebsVolumesCollector,
  ebsSnapshotsCollector,
  elasticIpsCollector,
  vpcCollector,
  securityGroupsCollector,
  s3BucketsCollector,
  ...EXTRA_COLLECTORS,
];
