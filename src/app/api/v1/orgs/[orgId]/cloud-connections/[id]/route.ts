import { z } from "zod";
import { orgRoute } from "@/server/http/route";
import { refreshCloud, disconnectCloud } from "@/server/services/cloud-service";
const params=z.object({id:z.uuid()});
export const maxDuration = 300;
export const POST = orgRoute({operation:"cloud.refresh",permission:"sync:trigger",params,rateLimit:"manualCostSync",rateLimitBy:"org"},async({access,params})=>({connection:await refreshCloud(access,params.id)}));
export const DELETE = orgRoute({operation:"cloud.disconnect",permission:"aws_accounts:disconnect",params,rateLimit:"api"},async({access,params})=>disconnectCloud(access,params.id));
