import { z } from "zod";

export const commitMessageOutputSchema = z.object({
  message: z.string().min(1),
});

export type CommitMessageOutput = z.infer<typeof commitMessageOutputSchema>;
