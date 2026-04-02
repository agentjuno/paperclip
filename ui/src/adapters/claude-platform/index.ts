import type { UIAdapterModule } from "../types";
import { parseClaudeStdoutLine } from "@paperclipai/adapter-claude-local/ui";
import { ClaudePlatformConfigFields } from "./config-fields";
import { buildClaudeLocalConfig } from "@paperclipai/adapter-claude-local/ui";

export const claudePlatformUIAdapter: UIAdapterModule = {
  type: "claude_platform",
  label: "Claude Code (platform)",
  parseStdoutLine: parseClaudeStdoutLine,
  ConfigFields: ClaudePlatformConfigFields,
  buildAdapterConfig: buildClaudeLocalConfig,
};
