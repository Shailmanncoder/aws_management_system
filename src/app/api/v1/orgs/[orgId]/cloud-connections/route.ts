import { cloudInput, cloudProvider } from "@/lib/cloud";
import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { connectCloud, listCloudConnections } from "@/server/services/cloud-service";
export const maxDuration = 300;
export const POST = orgRoute({operation:"cloud.connect",permission:"aws_accounts:connect",body:cloudInput,rateLimit:"connectionValidate",rateLimitBy:"org"},async({access,body})=>({connection:await connectCloud(access,body)}));
export const GET = orgRoute({operation:"cloud.list",permission:"aws_accounts:read",query:z.object({provider:cloudProvider.optional()})},async({access,query})=>({connections:await listCloudConnections(access,query.provider)}));
