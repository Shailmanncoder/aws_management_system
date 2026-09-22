import type { Metadata } from "next";
import { formatDate } from "@/lib/format";
import { RESOURCE_TYPES, type LambdaAttrs } from "@/lib/resource-types";
import { InventoryTablePage, Mono, Risk } from "../../_components/inventory-table-page";

export const metadata: Metadata = { title: "Serverless" };

const DEPRECATED = /^(python3\.[6-8]|python2|nodejs(8|10|12|14|16)\.|dotnetcore|ruby2|go1\.x|java8$)/;
const l = (a: unknown) => a as LambdaAttrs;

export default async function ServerlessPage({ searchParams }: PageProps<"/cloud/serverless">) {
  return (
    <InventoryTablePage
      title="Serverless"
      description="Lambda functions, API Gateway APIs and messaging. Function code and environment variable values are never read or stored."
      path="/cloud/serverless"
      searchParams={await searchParams}
      rowHref={(r) => (r.resourceType === RESOURCE_TYPES.LAMBDA_FUNCTION ? `/cloud/serverless/${r.id}` : null)}
      tabs={[
        {
          type: RESOURCE_TYPES.LAMBDA_FUNCTION,
          label: "Lambda functions",
          columns: [
            { header: "Runtime", cell: (r) => (l(r.attributes).runtime && DEPRECATED.test(l(r.attributes).runtime!) ? <Risk>{l(r.attributes).runtime} (deprecated)</Risk> : <Mono>{l(r.attributes).runtime}</Mono>) },
            { header: "Memory", cell: (r) => `${l(r.attributes).memoryMb ?? "—"} MB` },
            { header: "Timeout", cell: (r) => `${l(r.attributes).timeoutSec ?? "—"} s` },
            { header: "Arch", cell: (r) => l(r.attributes).architecture },
            { header: "Last modified", cell: (r) => (l(r.attributes).lastModified ? formatDate(l(r.attributes).lastModified!) : "—") },
            { header: "VPC", cell: (r) => <Mono>{l(r.attributes).vpcId}</Mono> },
            { header: "Layers", cell: (r) => l(r.attributes).layerCount },
          ],
        },
        { type: RESOURCE_TYPES.APIGW_REST_API, label: "REST APIs", columns: [{ header: "API ID", cell: (r) => <Mono>{r.resourceId}</Mono> }] },
        { type: RESOURCE_TYPES.APIGW_HTTP_API, label: "HTTP APIs", columns: [{ header: "API ID", cell: (r) => <Mono>{r.resourceId}</Mono> }, { header: "Endpoint", cell: (r) => <Mono>{String((r.attributes as { endpoint?: string }).endpoint ?? "—")}</Mono> }] },
        { type: RESOURCE_TYPES.SNS_TOPIC, label: "SNS topics", columns: [{ header: "ARN", cell: (r) => <Mono>{r.arn}</Mono> }] },
        { type: RESOURCE_TYPES.SQS_QUEUE, label: "SQS queues", columns: [{ header: "Encryption", cell: (r) => { const e = String((r.attributes as { encryption?: string }).encryption); return e === "none" ? <Risk>None</Risk> : e; } }] },
      ]}
    />
  );
}
