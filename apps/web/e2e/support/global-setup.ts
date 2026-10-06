import { requireLocalStack, resetRateLimits } from "./auth";

export default function globalSetup() {
  requireLocalStack();
  resetRateLimits();
}
