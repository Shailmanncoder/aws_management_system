import { z } from "zod";
import { uuidSchema } from "@/server/validation/common";

export const accountParams = z.strictObject({ accountId: uuidSchema });
