import { PUBLIC_WEB_AGENT_ADAPTER_TYPES } from "@paperclipai/shared";
import { unprocessable } from "../errors.js";

const PUBLIC_WEB_ADAPTER_TYPE_SET = new Set<string>(PUBLIC_WEB_AGENT_ADAPTER_TYPES);

export function isHostedWebProductMode() {
  return (
    process.env.PAPERCLIP_DEPLOYMENT_MODE === "authenticated" &&
    process.env.PAPERCLIP_DEPLOYMENT_EXPOSURE === "public"
  );
}

export function isPublicWebAdapterType(type: string) {
  return PUBLIC_WEB_ADAPTER_TYPE_SET.has(type);
}

export function getPublicWebAdapterError(type: string) {
  return `Adapter '${type}' is disabled in the hosted web product. Use a remote adapter and company-scoped BYOK secrets instead.`;
}

export function assertPublicWebAdapterType(type: string) {
  if (isHostedWebProductMode() && !isPublicWebAdapterType(type)) {
    throw unprocessable(getPublicWebAdapterError(type));
  }
}
