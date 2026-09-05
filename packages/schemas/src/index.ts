import { z } from "zod";

export const chatRoles = ["system", "user", "assistant", "tool"] as const;

export const chatMessageSchema = z.object({
  role: z.enum(chatRoles),
  content: z.string().min(1).max(128000),
  name: z.string().max(64).optional(),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string().min(1).max(128),
  messages: z.array(chatMessageSchema).min(1).max(256),
  stream: z.boolean().optional().default(false),
  max_tokens: z.number().int().min(1).max(128000).optional(),
  temperature: z.number().min(0).max(2).optional().default(0.7),
  top_p: z.number().min(0).max(1).optional(),
  idempotency_key: z.string().max(128).optional(),
});

export type ChatCompletionRequest = z.infer<typeof chatCompletionRequestSchema>;

export const modelsResponseSchema = z.object({
  object: z.literal("list"),
  data: z.array(
    z.object({
      id: z.string(),
      object: z.literal("model"),
      owned_by: z.string(),
    }),
  ),
});

export const errorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().optional(),
  }),
});

export type ApiErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "authorization_error"
  | "rate_limit_error"
  | "provider_error";

export function errorBody(message: string, type: ApiErrorType, code?: string): { error: { message: string; type: string; code?: string } } {
  if (code) {
    return { error: { message, type, code } };
  }
  return { error: { message, type } };
}
