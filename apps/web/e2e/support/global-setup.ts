import { requireLocalStack, resetRateLimits, resetTestRoles } from "./auth";

export default function globalSetup() {
  requireLocalStack();
  resetRateLimits();
  resetTestRoles();
}
