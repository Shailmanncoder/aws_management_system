import type { ResourceType } from "./resource-types";

/** Where a resource of a given type is shown in the UI. */
export function resourceHref(type: ResourceType | string, id: string, resourceId: string): string {
  switch (type) {
    case "ec2:instance":
      return `/cloud/ec2/${id}`;
    case "s3:bucket":
      return `/cloud/s3/${id}`;
    case "lambda:function":
      return `/cloud/serverless/${id}`;
    case "rds:db-instance":
    case "rds:db-cluster":
    case "dynamodb:table":
      return `/cloud/databases?q=${encodeURIComponent(resourceId)}`;
    case "ecs:cluster":
    case "ecs:service":
    case "eks:cluster":
    case "ecr:repository":
      return `/cloud/containers?q=${encodeURIComponent(resourceId)}`;
    case "ec2:vpc":
      return `/cloud/network?vpc=${encodeURIComponent(resourceId)}`;
    default:
      return `/resources?q=${encodeURIComponent(resourceId)}`;
  }
}
