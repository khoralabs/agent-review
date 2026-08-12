import { toolkit } from "@khoralabs/agent-capabilities";

import { commitMessageInspectBashTool, inspectBashTool } from "./inspect-bash.ts";

export const reviewToolkit = toolkit([inspectBashTool], {
  name: "agent-review",
});

export const commitMessageToolkit = toolkit([commitMessageInspectBashTool], {
  name: "agent-review-commit-message",
});
