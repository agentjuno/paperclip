import { PUBLIC_WEB_AGENT_ADAPTER_TYPES } from "@paperclipai/shared";

const PUBLIC_WEB_ADAPTER_TYPE_SET = new Set<string>(PUBLIC_WEB_AGENT_ADAPTER_TYPES);

export const publicWebAdapterTypes = [...PUBLIC_WEB_AGENT_ADAPTER_TYPES];

export function isPublicWebAdapterType(type: string) {
  return PUBLIC_WEB_ADAPTER_TYPE_SET.has(type);
}
