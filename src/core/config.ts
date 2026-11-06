import { z } from "zod";
export const Config = z
  .object({
    target_cpa: z.number().finite().positive().max(1e9).default(50),
    target_roas: z.number().finite().positive().max(1000).default(2),
    max_move_pct: z.number().min(0).max(0.2).default(0.2),
    daily_increase_cap_pct: z.number().min(0).max(0.2).default(0.2),
    min_confidence: z.number().min(0.2).max(1).default(0.2),
    confidence_spend_anchor: z.number().positive().max(1e9).default(700),
    protected_campaigns: z.array(z.string()).default([]),
    ceilings: z
      .record(z.string(), z.number().finite().nonnegative())
      .default({}),
    targets: z
      .record(
        z.string(),
        z.object({
          target_cpa: z.number().positive().max(1e9),
          target_roas: z.number().positive().max(1000),
        }),
      )
      .default({}),
    elasticities: z
      .object({
        meta: z.number().min(0.01).max(0.99).default(0.6),
        google: z.number().min(0.01).max(0.99).default(0.6),
      })
      .default({ meta: 0.6, google: 0.6 }),
    seed: z.number().int().min(0).max(4294967295).default(1),
  })
  .strict();
export type Config = z.infer<typeof Config>;
export const defaultConfig = (): Config => Config.parse({});
export function setConfig(
  config: Config,
  param: string,
  value: unknown,
): Config {
  if (!Object.hasOwn(defaultConfig(), param))
    throw Error("Unknown configuration parameter");
  return Config.parse({ ...config, [param]: value });
}
